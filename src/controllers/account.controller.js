const { prisma } = require('../config/db');
const { normalizeInr } = require('../config/currency');
const { sendAccountCreatedEmail } = require('../services/email.services');
const { createAccountWithNumber } = require('../services/account-number.service');

function serializeAccount(account, holderName) {
    return {
        id: account.id,
        userId: account.userId,
        currency: account.currency.trim(),
        status: account.status,
        holderName: account.user?.name || holderName || null,
        accountNumber: account.accountNumber,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt
    };
}

function hasCompleteProfile(user) {
    const phoneIsValid = typeof user.phone === 'string' && /^\+[1-9]\d{7,14}$/.test(user.phone.trim());
    return phoneIsValid && [
        user.name, user.addressLine, user.city, user.region, user.postalCode, user.country
    ].every((value) => typeof value === 'string' && value.trim().length > 0);
}

async function ensureInrAccount(user) {
    const existing = await prisma.account.findFirst({
        where: { userId: user.id, currency: 'INR' },
        include: { user: { select: { name: true } } }
    });
    if (existing) return existing;
    if (!hasCompleteProfile(user)) return null;
    const challenge = await prisma.emailOtpChallenge.findUnique({
        where: { userId: user.id },
        select: { email: true, status: true, verifiedAt: true }
    });
    if (!challenge || challenge.email !== user.email || challenge.status !== 'VERIFIED' || !challenge.verifiedAt) return null;
    try {
        return await createAccountWithNumber(prisma, {
            userId: user.id,
            currency: 'INR'
        }, {
            include: { user: { select: { name: true } } }
        });
    } catch (error) {
        if (error.code !== 'P2002') throw error;
        return prisma.account.findFirst({
            where: { userId: user.id, currency: 'INR' },
            include: { user: { select: { name: true } } }
        });
    }
}

function serializeTransfer(transfer, accountId) {
    const isOutgoing = transfer.senderAccountId === accountId;
    return {
        id: transfer.id,
        reference: transfer.reference,
        direction: isOutgoing ? 'OUTGOING' : 'INCOMING',
        senderAccountId: transfer.senderAccountId,
        receiverAccountId: transfer.receiverAccountId,
        senderAccountNumber: transfer.senderAccount?.accountNumber || null,
        receiverAccountNumber: transfer.receiverAccount?.accountNumber || null,
        amountMinor: transfer.amountMinor.toString(),
        currency: transfer.currency.trim(),
        status: transfer.status,
        createdAt: transfer.createdAt,
        updatedAt: transfer.updatedAt,
        failureReason: transfer.failureReason || null,
        availableBalanceMinor: transfer.availableBalanceMinor === null || transfer.availableBalanceMinor === undefined
            ? null
            : transfer.availableBalanceMinor.toString(),
        risk: transfer.riskAssessment ? {
            level: transfer.riskAssessment.level,
            decision: transfer.riskAssessment.decision
        } : null
    };
}

async function createAccount(req, res) {
    const currency = normalizeInr(req.body.currency || 'INR');
    if (!currency) {
        return res.status(400).json({ error: { message: 'Only INR accounts are supported' } });
    }

    const profileComplete = hasCompleteProfile(req.user);

    if (!profileComplete) {
        return res.status(400).json({ error: { message: 'Complete your banking profile before creating an account' } });
    }
    const emailChallenge = await prisma.emailOtpChallenge.findUnique({
        where: { userId: req.user.id },
        select: { email: true, status: true, verifiedAt: true }
    });
    if (
        !emailChallenge ||
        emailChallenge.email !== req.user.email ||
        emailChallenge.status !== 'VERIFIED' ||
        !emailChallenge.verifiedAt
    ) {
        return res.status(403).json({ error: { code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Verify your email address before creating a currency account.' } });
    }

    try {
        const account = await createAccountWithNumber(prisma, {
            userId: req.user.id,
            currency
        });

        res.status(201).json({ account: serializeAccount(account) });
        void sendAccountCreatedEmail({
            email: req.user.email,
            name: req.user.name,
            accountId: account.accountNumber,
            occurredAt: account.createdAt
        }).catch(error => console.error(JSON.stringify({
            event: 'account_created_email_failed',
            errorName: error instanceof Error ? error.name : 'UnknownError'
        })));
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: { message: 'Account already exists for this currency' } });
        }
        throw error;
    }
}

async function getRecipientAccount(req, res) {
    const account = await prisma.account.findUnique({
        where: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)
            ? { id: req.params.id }
            : { accountNumber: req.params.id },
        select: {
    id: true,
    accountNumber: true,
    currency: true,
    status: true,
    user: { select: { name: true, status: true } }
}
    });
    if (!account) {
        return res.status(404).json({ error: { code: 'RECIPIENT_NOT_FOUND', message: 'Recipient account not found' } });
    }
    const eligible = account.currency.trim() === 'INR' &&
        account.status === 'ACTIVE' &&
        account.user.status === 'ACTIVE';
    res.json({
        recipient: {
            accountId: account.id,
            accountNumber: account.accountNumber,
            holderName: account.user.name,
            status: account.status,
            currency: account.currency.trim(),
            eligible
        }
    });
}

async function getAccount(req, res) {
    const account = await prisma.account.findFirst({
        where: { id: req.params.id, userId: req.user.id }
    });

    if (!account) {
        return res.status(404).json({ error: { message: 'Account not found' } });
    }

    if (account.currency.trim() !== 'INR') {
        return res.status(410).json({ error: { code: 'LEGACY_CURRENCY', message: 'This legacy account is not an active INR financial account' } });
    }

    res.json({ account: serializeAccount(account) });
}

async function getBalance(req, res) {
    const accountId = req.params.id || req.params.accountId;
    const account = await prisma.account.findFirst({
        where: { id: accountId, userId: req.user.id },
        include: { ledgerEntries: { select: { entryType: true, amountMinor: true } } }
    });

    if (!account) {
        return res.status(404).json({ error: { message: 'Account not found' } });
    }
    if (account.currency.trim() !== 'INR') {
        return res.status(410).json({ error: { code: 'LEGACY_CURRENCY', message: 'This legacy account has no supported INR balance' } });
    }

    const balanceMinor = account.ledgerEntries.reduce((balance, entry) => {
        return entry.entryType === 'CREDIT'
            ? balance + entry.amountMinor
            : balance - entry.amountMinor;
    }, 0n);

    res.json({
        accountId: account.id,
        accountNumber: account.accountNumber,
        currency: account.currency.trim(),
        status: account.status,
        balanceMinor: balanceMinor.toString()
    });
}

async function getAccountTransfers(req, res) {
    const account = await prisma.account.findFirst({
        where: { id: req.params.id, userId: req.user.id },
        select: { id: true }
    });

    if (!account) {
        return res.status(404).json({ error: { message: 'Account not found' } });
    }

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 20, 1), 100);
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : undefined;
    const direction = typeof req.query.direction === 'string' ? req.query.direction.trim().toUpperCase() : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (req.query.page !== undefined && (!/^\d+$/.test(String(req.query.page)) || Number(req.query.page) < 1) ||
        req.query.pageSize !== undefined && (!/^\d+$/.test(String(req.query.pageSize)) || Number(req.query.pageSize) < 1 || Number(req.query.pageSize) > 100)) {
        return res.status(400).json({ error: { message: 'Invalid pagination parameters' } });
    }
    if (status && !['PENDING', 'PROCESSING', 'COMPLETED', 'REVIEW', 'FAILED', 'REVERSED'].includes(status)) {
        return res.status(400).json({ error: { message: 'Invalid transfer status' } });
    }
    if (direction && !['INCOMING', 'OUTGOING'].includes(direction)) {
        return res.status(400).json({ error: { message: 'Invalid transfer direction' } });
    }
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
        return res.status(400).json({ error: { message: 'Invalid date filter' } });
    }
    const searchFilters = search
        ? [{ reference: { contains: search, mode: 'insensitive' } }]
        : [];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) {
        searchFilters.push({ id: search });
    }
    const accountScope = direction === 'OUTGOING'
        ? { senderAccountId: account.id }
        : direction === 'INCOMING'
            ? { receiverAccountId: account.id }
            : { OR: [{ senderAccountId: account.id }, { receiverAccountId: account.id }] };
    const where = {
        AND: [
            accountScope,
            ...(status ? [{ status }] : []),
            ...((from || to) ? [{ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }] : []),
            ...(searchFilters.length ? [{ OR: searchFilters }] : [])
        ]
    };

    const [transfers, total] = await prisma.$transaction([
        prisma.transfer.findMany({
            where,
            include: {
                riskAssessment: { select: { level: true, decision: true } },
                senderAccount: { select: { accountNumber: true } },
                receiverAccount: { select: { accountNumber: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        }),
        prisma.transfer.count({ where })
    ]);

    res.json({
        transfers: transfers.map((transfer) => serializeTransfer(transfer, account.id)),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
}

async function getTransferDetail(req, res) {
    const transfer = await prisma.transfer.findFirst({
        where: {
            id: req.params.transferId,
            OR: [
                { senderAccount: { userId: req.user.id } },
                { receiverAccount: { userId: req.user.id } }
            ]
        },
        include: {
            senderAccount: { select: { userId: true, accountNumber: true } },
            receiverAccount: { select: { accountNumber: true } },
            riskAssessment: { select: { level: true, decision: true, score: true, reasons: true } },
            ledgerEntries: { select: { id: true, accountId: true, entryType: true, amountMinor: true, currency: true, createdAt: true } }
        }
    });

    if (!transfer) {
        return res.status(404).json({ error: { message: 'Transfer not found' } });
    }

    const accountId = transfer.senderAccount?.userId === req.user.id
        ? transfer.senderAccountId
        : transfer.receiverAccountId;
    res.json({
        transfer: {
            ...serializeTransfer(transfer, accountId),
            risk: transfer.riskAssessment,
            ledgerEntries: transfer.ledgerEntries.map((entry) => ({
                ...entry,
                amountMinor: entry.amountMinor.toString(),
                currency: entry.currency.trim()
            }))
        }
    });
}

module.exports = {
    createAccount,
    getAccount,
    getBalance,
    getAccountTransfers,
    getTransferDetail,
    getAccounts: async (req, res) => {
        const accounts = await prisma.account.findMany({ where: { userId: req.user.id } });
        let inrAccounts = accounts.filter(account => account.currency.trim() === 'INR');
        if (!inrAccounts.length) {
            const ensured = await ensureInrAccount(req.user);
            if (ensured) inrAccounts = [ensured];
        }
        res.json({ accounts: inrAccounts.map(account => serializeAccount(account, req.user.name)) });
    },
    getRecipientAccount
};
