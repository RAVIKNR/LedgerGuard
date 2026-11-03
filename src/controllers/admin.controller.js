const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/db');
const { recordAdminAudit, sanitizeAuditReason } = require('../services/admin-audit.service');
const { queueSecurityNotification, dispatchSecurityNotification } = require('../services/security-notification.service');
const {
    queueTransferFailureNotification,
    queueTransferDecisionNotification,
    dispatchTransactionNotifications
} = require('../services/transaction-notification.service');
const { settleReviewedTransfer } = require('../services/transfer-settlement.service');

const USER_SELECT = {
    id: true,
    name: true,
    email: true,
    status: true,
    emailVerifiedAt: true,
    createdAt: true,
    updatedAt: true
};
const ADMIN_ROLE_SELECT = {
    id: true,
    name: true,
    email: true,
    status: true,
    emailVerifiedAt: true,
    createdAt: true,
    isAdmin: true
};

function pagination(req) {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    return { page, pageSize, skip: (page - 1) * pageSize };
}

function paginationResponse(page, pageSize, total) {
    return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

function invalidTransition(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

function auditReason(req) {
    return typeof req.body.reason === 'string' ? req.body.reason.trim() : null;
}

function dateRange(from, to) {
    const range = {};
    if (from) range.gte = new Date(from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        range.lt = new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000);
    } else if (to) {
        range.lte = new Date(to);
    }
    return range;
}

function serializeTransfer(transfer) {
    return {
        id: transfer.id,
        senderAccountId: transfer.senderAccountId,
        receiverAccountId: transfer.receiverAccountId,
        senderAccountNumber: transfer.senderAccount?.accountNumber || null,
        receiverAccountNumber: transfer.receiverAccount?.accountNumber || null,
        amountMinor: transfer.amountMinor.toString(),
        currency: transfer.currency.trim(),
        status: transfer.status,
        createdAt: transfer.createdAt.toISOString(),
        risk: transfer.riskAssessment ? {
            score: transfer.riskAssessment.score,
            level: transfer.riskAssessment.level,
            decision: transfer.riskAssessment.decision,
            reasons: transfer.riskAssessment.reasons
        } : null
    };
}

async function listFlaggedTransfers(req, res) {
    const transfers = await prisma.transfer.findMany({
        where: { status: 'REVIEW' },
        include: {
            riskAssessment: true,
            senderAccount: { select: { accountNumber: true } },
            receiverAccount: { select: { accountNumber: true } }
        },
        orderBy: { createdAt: 'asc' },
        take: 100
    });
    res.json({ transfers: transfers.map(serializeTransfer) });
}

async function getOverview(req, res) {
    const [totalUsers, totalAccounts, totalTransfers, pendingTransfers] = await Promise.all([
        prisma.user.count(),
        prisma.account.count(),
        prisma.transfer.count(),
        prisma.transfer.count({ where: { status: 'PENDING' } })
    ]);

    res.json({
        overview: { totalUsers, totalAccounts, totalTransfers, pendingTransfers }
    });
}

async function decideTransfer(req, res) {
    const decision = typeof req.body.decision === 'string'
        ? req.body.decision.trim().toUpperCase()
        : '';
    const notes = typeof req.body.notes === 'string' ? sanitizeAuditReason(req.body.notes.trim()) : undefined;

    if (!['APPROVE', 'DECLINE'].includes(decision)) {
        return res.status(400).json({ error: { message: 'decision must be APPROVE or DECLINE' } });
    }

    const result = await prisma.$transaction(async (tx) => {
        const transfer = await tx.transfer.findUnique({
            where: { id: req.params.transferId },
            include: { riskAssessment: true, senderAccount: { include: { user: true } } }
        });
        if (!transfer) {
            const error = new Error('Transfer not found');
            error.statusCode = 404;
            throw error;
        }
        if (transfer.status !== 'REVIEW' || !transfer.riskAssessment) {
            const error = new Error('Only transfers awaiting review can be decided');
            error.statusCode = 409;
            throw error;
        }

        let decidedTransfer = transfer;
        if (decision === 'APPROVE') {
            decidedTransfer = await settleReviewedTransfer(tx, transfer.id);
        } else {
            await tx.$queryRaw`SELECT id FROM "transfers" WHERE id = ${transfer.id}::uuid FOR UPDATE`;
            const current = await tx.transfer.findUnique({ where: { id: transfer.id }, select: { status: true } });
            if (!current || current.status !== 'REVIEW') throw invalidTransition('Transfer has already been resolved');
            await tx.transfer.update({
                where: { id: transfer.id },
                data: { status: 'FAILED', failureReason: notes || 'Transfer declined during review' }
            });
            await queueTransferFailureNotification(tx, {
                ...transfer,
                status: 'FAILED',
                failureReason: notes || 'Transfer declined during review'
            });
            decidedTransfer = {
                ...transfer,
                status: 'FAILED',
                failureReason: notes || 'Transfer declined during review'
            };
        }

        await tx.riskAssessment.update({
            where: { transferId: transfer.id },
            data: { decision: decision === 'APPROVE' ? 'APPROVED' : 'DECLINED' }
        });
        const recorded = await tx.adminDecision.create({
            data: {
                transferId: transfer.id,
                adminUserId: req.user.id,
                decision,
                notes
            }
        });
        await recordAdminAudit(tx, {
            actorId: req.user.id,
            action: `TRANSFER_${decision}`,
            targetType: 'TRANSFER',
            targetId: transfer.id,
            reason: notes || null,
            metadata: {
                previousStatus: 'REVIEW',
                status: decision === 'APPROVE' ? 'COMPLETED' : 'FAILED',
                amountMinor: transfer.amountMinor.toString(),
                currency: transfer.currency.trim()
            }
        });
        await queueTransferDecisionNotification(tx, decidedTransfer, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED');
        return { transferId: transfer.id, decision: recorded.decision, decidedAt: recorded.createdAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.status(200).json({ decision: result });
    void dispatchTransactionNotifications(result.transferId);
}

async function listUsers(req, res) {
    const { page, pageSize, skip } = pagination(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = req.query.status;
    const where = {
        ...(status ? { status } : {}),
        ...(search ? {
            OR: [
                { id: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ]
        } : {})
    };
    const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
            where,
            select: USER_SELECT,
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize
        }),
        prisma.user.count({ where })
    ]);
    res.json({ users, pagination: paginationResponse(page, pageSize, total) });
}

async function listAdministrators(req, res) {
    const bootstrapAdminId = process.env.ADMIN_USER_ID || null;
    const administrators = await prisma.user.findMany({
        where: {
            OR: [
                { isAdmin: true },
                ...(bootstrapAdminId ? [{ id: bootstrapAdminId }] : [])
            ]
        },
        select: ADMIN_ROLE_SELECT,
        orderBy: [{ isAdmin: 'desc' }, { createdAt: 'asc' }]
    });
    res.json({
        administrators: administrators.map(user => ({
            ...user,
            isAdmin: user.isAdmin || user.id === bootstrapAdminId,
            bootstrapAdmin: user.id === bootstrapAdminId
        }))
    });
}

async function listEligibleAdminUsers(req, res) {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const users = await prisma.user.findMany({
        where: {
            status: 'ACTIVE',
            emailVerifiedAt: { not: null },
            isAdmin: false,
            ...(process.env.ADMIN_USER_ID ? { id: { not: process.env.ADMIN_USER_ID } } : {}),
            ...(search ? {
                OR: [
                    { id: { contains: search, mode: 'insensitive' } },
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } }
                ]
            } : {})
        },
        select: ADMIN_ROLE_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 50
    });
    res.json({ users });
}

async function updateAdminRole(req, res) {
    const { userId } = req.params;
    const { action } = req.body;
    const reason = auditReason(req);
    const bootstrapAdminId = process.env.ADMIN_USER_ID || null;

    if (userId === req.user.id) {
        return res.status(409).json({ error: { message: 'Administrators cannot change their own administrator role' } });
    }

    try {
        const result = await prisma.$transaction(async tx => {
            await tx.$queryRaw`
                SELECT id FROM "users"
                WHERE is_admin = TRUE
                    OR id = ${bootstrapAdminId}::uuid
                    OR id = ${req.user.id}::uuid
                    OR id = ${userId}::uuid
                ORDER BY id
                FOR UPDATE
            `;

            const actor = await tx.user.findUnique({
                where: { id: req.user.id },
                select: { id: true, status: true, isAdmin: true }
            });
            if (!actor || actor.status !== 'ACTIVE' || (actor.id !== bootstrapAdminId && !actor.isAdmin)) {
                return { error: { statusCode: 403, message: 'Administrator access is no longer active' } };
            }

            const target = await tx.user.findUnique({
                where: { id: userId },
                select: ADMIN_ROLE_SELECT
            });
            if (!target) return { error: { statusCode: 404, message: 'User not found' } };

            const promote = action === 'PROMOTE';
            const previousIsAdmin = target.isAdmin;
            if (promote) {
                if (target.status !== 'ACTIVE' || !target.emailVerifiedAt) {
                    return { error: { statusCode: 409, message: 'Only active users with verified email addresses can become administrators' } };
                }
                if (target.isAdmin || target.id === bootstrapAdminId) {
                    return { error: { statusCode: 409, message: 'This user is already an administrator' } };
                }
            } else {
                if (target.id === bootstrapAdminId) {
                    return { error: { statusCode: 409, message: 'The configured bootstrap administrator cannot be demoted' } };
                }
                if (!target.isAdmin) {
                    return { error: { statusCode: 409, message: 'This user is not a secondary administrator' } };
                }
                if (target.status === 'ACTIVE') {
                    const activeAdministrators = await tx.user.count({
                        where: {
                            status: 'ACTIVE',
                            OR: [
                                { isAdmin: true },
                                ...(bootstrapAdminId ? [{ id: bootstrapAdminId }] : [])
                            ]
                        }
                    });
                    if (activeAdministrators <= 1) {
                        return { error: { statusCode: 409, message: 'The last active administrator cannot be demoted' } };
                    }
                }
            }

            const changed = await tx.user.updateMany({
                where: { id: userId, isAdmin: previousIsAdmin },
                data: { isAdmin: promote }
            });
            if (changed.count !== 1) {
                throw invalidTransition('Administrator role changed concurrently; refresh and try again');
            }
            const updatedUser = await tx.user.findUnique({
                where: { id: userId },
                select: ADMIN_ROLE_SELECT
            });
            await recordAdminAudit(tx, {
                actorId: req.user.id,
                action: promote ? 'ADMIN_PROMOTED' : 'ADMIN_DEMOTED',
                targetType: 'USER',
                targetId: userId,
                reason,
                metadata: {
                    outcome: 'SUCCESS',
                    previousIsAdmin,
                    isAdmin: promote,
                    status: updatedUser.status
                }
            });
            return { user: updatedUser };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        if (result.error) {
            return res.status(result.error.statusCode).json({ error: { message: result.error.message } });
        }
        return res.json(result);
    } catch (error) {
        if (error.code === 'P2034') {
            return res.status(409).json({ error: { message: 'Administrator roles changed concurrently; refresh and try again' } });
        }
        throw error;
    }
}

async function updateUserStatus(req, res) {
    const { userId } = req.params;
    const { status } = req.body;
    const reason = auditReason(req);
    if (userId === req.user.id && status === 'SUSPENDED') {
        return res.status(409).json({ error: { message: 'Administrators cannot suspend their own account' } });
    }

    const result = await prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
        if (!user) return { error: { statusCode: 404, message: 'User not found' } };
        const expectedStatus = status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
        if (user.status !== expectedStatus) {
            return { error: { statusCode: 409, message: `Cannot change user status from ${user.status} to ${status}` } };
        }
        const changed = await tx.user.updateMany({
            where: { id: userId, status: expectedStatus },
            data: { status }
        });
        if (changed.count !== 1) throw invalidTransition('User status changed concurrently; refresh and try again');
        const updatedUser = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
        await recordAdminAudit(tx, {
            actorId: req.user.id,
            action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
            targetType: 'USER',
            targetId: userId,
            reason,
            metadata: { previousStatus: expectedStatus, status }
        });
        let notificationId;
        if (status === 'SUSPENDED' || await tx.account.count({ where: { userId, status: 'FROZEN' } }) === 0) {
            const notification = await queueSecurityNotification(tx, {
                userId,
                eventType: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
                previousStatus: expectedStatus,
                resultingStatus: status,
                reason,
                occurredAt: updatedUser.updatedAt
            });
            notificationId = notification.id;
        }
        return { user: updatedUser, notificationId };
    });
    if (result.error) return res.status(result.error.statusCode).json({ error: { message: result.error.message } });
    if (result.notificationId) void dispatchSecurityNotification(result.notificationId);
    return res.json(result);
}

async function listAccounts(req, res) {
    const { page, pageSize, skip } = pagination(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = req.query.status;
    const where = {
        ...(status ? { status } : {}),
        ...(search ? {
            OR: [
                { accountNumber: { contains: search } },
                { currency: { contains: search, mode: 'insensitive' } },
                { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
                { user: { is: { name: { contains: search, mode: 'insensitive' } } } }
            ]
        } : {})
    };
    const [accounts, total] = await prisma.$transaction([
        prisma.account.findMany({
            where,
            select: {
                id: true,
                userId: true,
                accountNumber: true,
                currency: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                user: { select: { name: true, email: true } },
                ledgerEntries: { select: { entryType: true, amountMinor: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize
        }),
        prisma.account.count({ where })
    ]);
    res.json({
        accounts: accounts.map(account => {
            const balanceMinor = (account.ledgerEntries || []).reduce((balance, entry) =>
                entry.entryType === 'CREDIT' ? balance + entry.amountMinor : balance - entry.amountMinor, 0n);
            const { ledgerEntries, ...safeAccount } = account;
            return {
                ...safeAccount,
                currency: account.currency.trim(),
                balanceMinor: balanceMinor.toString(),
                eligibleForFinancialOperations: account.currency.trim() === 'INR'
            };
        }),
        pagination: paginationResponse(page, pageSize, total)
    });
}

async function listRecipientAccounts(req, res) {
    const page = Number(req.query.page || 1);
    const pageSize = Math.min(Number(req.query.pageSize || 20), 50);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const accountNumberSearch = /^\d{16}$/.test(search)
        ? search
        : null;
    const where = {
        currency: 'INR',
        status: 'ACTIVE',
        user: { is: { status: 'ACTIVE', emailVerifiedAt: { not: null } } },
        ...(search ? {
            OR: [
                ...(accountNumberSearch ? [{ accountNumber: accountNumberSearch }] : []),
                { user: { is: { name: { contains: search, mode: 'insensitive' } } } }
            ]
        } : {})
    };
    const [accounts, total] = await prisma.$transaction([
        prisma.account.findMany({
            where,
            select: { id: true, accountNumber: true, user: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        }),
        prisma.account.count({ where })
    ]);
    res.json({
        accounts: accounts.map(account => ({
            accountId: account.id,
            accountNumber: account.accountNumber,
            holderName: account.user.name
        })),
        pagination: paginationResponse(page, pageSize, total)
    });
}

async function updateAccountStatus(req, res) {
    const { accountId } = req.params;
    const { status } = req.body;
    const reason = auditReason(req);
    const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "accounts" WHERE id = ${accountId}::uuid FOR UPDATE`;
        const account = await tx.account.findUnique({
            where: { id: accountId },
            select: { id: true, userId: true, status: true, currency: true, user: { select: { id: true, status: true } } }
        });
        if (!account) return { error: { statusCode: 404, message: 'Account not found' } };
        const expectedStatus = status === 'FROZEN' ? 'ACTIVE' : 'FROZEN';
        if (account.status !== expectedStatus) {
            return { error: { statusCode: 409, message: `Cannot change account status from ${account.status} to ${status}` } };
        }
        const changed = await tx.account.updateMany({
            where: { id: accountId, status: expectedStatus },
            data: { status }
        });
        if (changed.count !== 1) throw invalidTransition('Account status changed concurrently; refresh and try again');
        const updatedAccount = await tx.account.findUnique({
            where: { id: accountId },
            select: {
                id: true,
                userId: true,
                status: true,
                currency: true,
                createdAt: true,
                updatedAt: true
            }
        });
        await recordAdminAudit(tx, {
            actorId: req.user.id,
            action: status === 'FROZEN' ? 'ACCOUNT_FROZEN' : 'ACCOUNT_UNFROZEN',
            targetType: 'ACCOUNT',
            targetId: accountId,
            reason,
            metadata: { previousStatus: expectedStatus, status, currency: account.currency.trim() }
        });
        let notificationId;
        if (status === 'FROZEN' || account.user.status === 'ACTIVE') {
            const notification = await queueSecurityNotification(tx, {
                userId: account.user.id,
                accountId,
                eventType: status === 'FROZEN' ? 'ACCOUNT_FROZEN' : 'ACCOUNT_UNFROZEN',
                previousStatus: expectedStatus,
                resultingStatus: status,
                reason,
                occurredAt: updatedAccount.updatedAt
            });
            notificationId = notification.id;
        }
        return {
            account: { ...updatedAccount, currency: updatedAccount.currency.trim() },
            notificationId
        };
    });
    if (result.error) return res.status(result.error.statusCode).json({ error: { message: result.error.message } });
    if (result.notificationId) void dispatchSecurityNotification(result.notificationId);
    return res.json(result);
}

async function listTransactions(req, res) {
    const { page, pageSize, skip } = pagination(req);
    const { status, accountId, riskLevel, riskDecision } = req.query;
    const createdAt = dateRange(req.query.from, req.query.to);
    const where = {
        ...(status ? { status } : {}),
        ...(accountId ? { OR: [{ senderAccountId: accountId }, { receiverAccountId: accountId }] } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
        ...(riskLevel || riskDecision ? {
            riskAssessment: {
                is: {
                    ...(riskLevel ? { level: riskLevel } : {}),
                    ...(riskDecision ? { decision: riskDecision } : {})
                }
            }
        } : {})
    };
    const [transfers, total] = await prisma.$transaction([
        prisma.transfer.findMany({
            where,
            include: {
                riskAssessment: true,
                senderAccount: { select: { accountNumber: true } },
                receiverAccount: { select: { accountNumber: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize
        }),
        prisma.transfer.count({ where })
    ]);
    res.json({
        transfers: transfers.map(serializeTransfer),
        pagination: paginationResponse(page, pageSize, total)
    });
}

async function listAdminAudit(req, res) {
    const { page, pageSize, skip } = pagination(req);
    const createdAt = dateRange(req.query.from, req.query.to);
    const where = {
        ...(req.query.action ? { action: req.query.action } : {}),
        ...(req.query.actorId ? { actorId: req.query.actorId } : {}),
        ...(req.query.targetType ? { targetType: req.query.targetType } : {}),
        ...(req.query.targetId ? { targetId: req.query.targetId } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {})
    };
    const [events, total] = await prisma.$transaction([
        prisma.adminAuditLog.findMany({
            where,
            include: { actor: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize
        }),
        prisma.adminAuditLog.count({ where })
    ]);
    res.json({ events, pagination: paginationResponse(page, pageSize, total) });
}

module.exports = {
    getOverview,
    listFlaggedTransfers,
    decideTransfer,
    listUsers,
    listAdministrators,
    listEligibleAdminUsers,
    updateAdminRole,
    updateUserStatus,
    listAccounts,
    listRecipientAccounts,
    updateAccountStatus,
    listTransactions,
    listAdminAudit
};
