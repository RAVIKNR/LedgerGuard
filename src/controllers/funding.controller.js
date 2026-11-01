const { prisma } = require('../config/db');
const { recordAdminAudit } = require('../services/admin-audit.service');
const { dispatchTransactionNotifications, queueTransferNotifications } = require('../services/transaction-notification.service');
const crypto = require('crypto');
const { normalizeInr } = require('../config/currency');
const { DEMO_RECIPIENT_ACCOUNT_ID } = require('../config/demo');
const { createAccountWithNumber } = require('../services/account-number.service');

const INITIAL_DEMO_FUNDING_KEY = 'INITIAL_DEMO_FUNDING:v1';
const INITIAL_DEMO_FUNDING_MINOR = 1000000n;

function hasCompleteProfile(user) {
    return typeof user.phone === 'string' && /^\+[1-9]\d{7,14}$/.test(user.phone.trim()) &&
        [user.name, user.addressLine, user.city, user.region, user.postalCode, user.country]
        .every(value => typeof value === 'string' && value.trim().length > 0);
}

async function fundInitialDemoAccount(req, res) {
    const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${req.user.id}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true, name: true, email: true, status: true,
                phone: true, addressLine: true, city: true, region: true, postalCode: true, country: true
            }
        });
        if (!user || user.status !== 'ACTIVE' || !hasCompleteProfile(user)) {
            const error = new Error('Complete your banking profile before receiving demo funding');
            error.statusCode = 409;
            error.code = 'PROFILE_INCOMPLETE';
            throw error;
        }

        const challenge = await tx.emailOtpChallenge.findUnique({
            where: { userId: user.id },
            select: { email: true, status: true, verifiedAt: true }
        });
        if (!challenge || challenge.email !== user.email || challenge.status !== 'VERIFIED' || !challenge.verifiedAt) {
            const error = new Error('Verify your email before receiving demo funding');
            error.statusCode = 409;
            error.code = 'EMAIL_VERIFICATION_REQUIRED';
            throw error;
        }

        let account = await tx.account.findUnique({
            where: { userId_currency: { userId: user.id, currency: 'INR' } }
        });
        if (!account) {
            account = await createAccountWithNumber(tx, { userId: user.id, currency: 'INR' });
        }
        if (account.status !== 'ACTIVE') {
            const error = new Error('Your INR demo account is not active');
            error.statusCode = 409;
            error.code = 'ACCOUNT_NOT_ELIGIBLE';
            throw error;
        }

        const existing = await tx.idempotencyKey.findUnique({
            where: { userId_key: { userId: user.id, key: INITIAL_DEMO_FUNDING_KEY } },
            include: { transfer: true }
        });
        if (existing) {
            if (existing.requestHash !== 'INITIAL_DEMO_FUNDING') {
                const error = new Error('Initial demo funding record is inconsistent');
                error.statusCode = 409;
                throw error;
            }
            const entries = await tx.ledgerEntry.findMany({
                where: { accountId: account.id },
                select: { entryType: true, amountMinor: true }
            });
            const balanceMinor = entries.reduce((balance, entry) => entry.entryType === 'CREDIT'
                ? balance + entry.amountMinor
                : balance - entry.amountMinor, 0n);
                const demoRecipient = await tx.account.findUnique({
                    where: { id: DEMO_RECIPIENT_ACCOUNT_ID },
                    select: { accountNumber: true, status: true, currency: true, user: { select: { status: true } } }
                });
                return { account, transfer: existing.transfer, balanceMinor, replayed: true, demoRecipient };
        }

        const transfer = await tx.transfer.create({
            data: {
                receiverAccountId: account.id,
                amountMinor: INITIAL_DEMO_FUNDING_MINOR,
                currency: 'INR',
                status: 'COMPLETED',
                reference: 'INITIAL_DEMO_FUNDING'
            }
        });
        await tx.ledgerEntry.create({
            data: {
                transferId: transfer.id,
                accountId: account.id,
                entryType: 'CREDIT',
                amountMinor: INITIAL_DEMO_FUNDING_MINOR,
                currency: 'INR'
            }
        });
        await tx.idempotencyKey.create({
            data: {
                userId: user.id,
                accountId: account.id,
                transferId: transfer.id,
                key: INITIAL_DEMO_FUNDING_KEY,
                requestHash: 'INITIAL_DEMO_FUNDING',
                responseStatus: 201,
                responseBody: { transferId: transfer.id, amountMinor: INITIAL_DEMO_FUNDING_MINOR.toString() }
            }
        });
        await recordAdminAudit(tx, {
            actorId: user.id,
            action: 'INITIAL_DEMO_FUNDING',
            targetType: 'ACCOUNT',
            targetId: account.id,
            reason: 'One-time simulated funding after profile and email setup',
            metadata: { transferId: transfer.id, amountMinor: INITIAL_DEMO_FUNDING_MINOR.toString(), currency: 'INR' }
        });
        await queueTransferNotifications(tx, {
            ...transfer,
            receiverAccount: { user }
        });
        const demoRecipient = await tx.account.findUnique({
            where: { id: DEMO_RECIPIENT_ACCOUNT_ID },
            select: { accountNumber: true, status: true, currency: true, user: { select: { status: true } } }
        });
        return { account, transfer, balanceMinor: INITIAL_DEMO_FUNDING_MINOR, replayed: false, demoRecipient };
    });

    if (
        !result.demoRecipient ||
        result.demoRecipient.status !== 'ACTIVE' ||
        result.demoRecipient.currency.trim() !== 'INR' ||
        result.demoRecipient.user.status !== 'ACTIVE'
    ) {
        const error = new Error('The LedgerGuard demo recipient is unavailable');
        error.statusCode = 503;
        throw error;
    }

    res.status(result.replayed ? 200 : 201).json({
        funded: !result.replayed,
        accountId: result.account.id,
        transferId: result.transfer.id,
        amountMinor: INITIAL_DEMO_FUNDING_MINOR.toString(),
        currency: 'INR',
        balanceMinor: result.balanceMinor.toString(),
        recipientAccountNumber: result.demoRecipient.accountNumber
    });
    if (!result.replayed) void dispatchTransactionNotifications(result.transfer.id);
}

async function fundAccount(req, res) {
    const { accountId, amountMinor, currency } = req.body;
    const idempotencyKey = req.get('Idempotency-Key');

    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!accountId || !amountMinor || !currency || !idempotencyKey) {
        return res.status(400).json({
            error: { message: 'accountId, amountMinor, currency, and Idempotency-Key are required' }
        });
    }

    let amount;
    try {
        amount = BigInt(amountMinor);
    } catch {
        return res.status(400).json({ error: { message: 'amountMinor must be an integer' } });
    }

    if (amount <= 0n) {
        return res.status(400).json({ error: { message: 'amountMinor must be positive' } });
    }

    const normalizedCurrency = normalizeInr(currency);
    if (!normalizedCurrency) {
        return res.status(400).json({ error: { message: 'Only INR funding is supported' } });
    }
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({
        accountId, amountMinor: amount.toString(), currency: normalizedCurrency, reason: reason || 'No reason provided'
    })).digest('hex');
    const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.idempotencyKey.findUnique({
            where: { userId_key: { userId: req.user.id, key: idempotencyKey } },
            include: { transfer: true }
        });
        if (existing) {
            if (existing.requestHash !== requestHash || !existing.transfer) {
                const error = new Error('Idempotency key was already used for a different request');
                error.statusCode = 409;
                throw error;
            }
            return { ...existing.transfer, replayed: true };
        }
        const accounts = await tx.$queryRaw`
            SELECT id
            FROM "accounts"
            WHERE id = ${accountId}::uuid
            FOR UPDATE
        `;

        if (accounts.length === 0) {
            const error = new Error('Account not found');
            error.statusCode = 404;
            throw error;
        }

        const account = await tx.account.findUnique({
            where: { id: accountId },
            include: { user: { select: { id: true, email: true, name: true, status: true, emailVerifiedAt: true } } }
        });
        if (
            account.status !== 'ACTIVE' ||
            account.currency.trim() !== normalizedCurrency ||
            account.user.status !== 'ACTIVE'
        ) {
            const error = new Error('Account is not active or currency does not match');
            error.statusCode = 409;
            throw error;
        }

        const created = await tx.transfer.create({
            data: {
                receiverAccountId: accountId,
                amountMinor: amount,
                currency: normalizedCurrency,
                status: 'COMPLETED',
                reference: 'ADMIN_FUNDING'
            }
        });

        await tx.ledgerEntry.create({
            data: {
                transferId: created.id,
                accountId,
                entryType: 'CREDIT',
                amountMinor: amount,
                currency: normalizedCurrency
            }
        });
        await queueTransferNotifications(tx, {
            ...created,
            receiverAccount: { user: account.user }
        });
        await recordAdminAudit(tx, {
            actorId: req.user.id,
            action: 'ACCOUNT_FUNDED',
            targetType: 'ACCOUNT',
            targetId: accountId,
            reason: reason || 'No reason provided',
            metadata: {
                transferId: created.id,
                amountMinor: amount.toString(),
                currency: normalizedCurrency
            }
        });
        await tx.idempotencyKey.create({
            data: {
                userId: req.user.id,
                accountId,
                transferId: created.id,
                key: idempotencyKey,
                requestHash,
                responseStatus: 201,
                responseBody: { transferId: created.id }
            }
        });
        return { ...created, replayed: false };
    });

    res.status(result.replayed ? 200 : 201).json({
        transfer: {
            id: result.id,
            receiverAccountId: result.receiverAccountId,
            amountMinor: result.amountMinor.toString(),
            currency: result.currency.trim(),
            status: result.status
        }
    });
    if (!result.replayed) void dispatchTransactionNotifications(result.id);
}

module.exports = { fundAccount, fundInitialDemoAccount };
