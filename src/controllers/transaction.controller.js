const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/db');
const { assessTransfer } = require('../services/risk.service');
const { dispatchTransactionNotifications, queueTransferNotifications, queueTransferFailureNotification } = require('../services/transaction-notification.service');

function transferResponse(transfer) {
    const response = {
        id: transfer.id,
        reference: transfer.reference || (transfer.status === 'FAILED' ? null : transfer.id),
        senderAccountId: transfer.senderAccountId,
        receiverAccountId: transfer.receiverAccountId,
        senderAccountNumber: transfer.senderAccount?.accountNumber || null,
        receiverAccountNumber: transfer.receiverAccount?.accountNumber || null,
        amountMinor: transfer.amountMinor.toString(),
        currency: transfer.currency.trim(),
        status: transfer.status,
        failureReason: transfer.failureReason || null,
        availableBalanceMinor: transfer.availableBalanceMinor === null || transfer.availableBalanceMinor === undefined
            ? null
            : transfer.availableBalanceMinor.toString(),
        createdAt: transfer.createdAt.toISOString()
    };

    if (transfer.riskAssessment) {
        response.risk = {
            score: transfer.riskAssessment.score,
            level: transfer.riskAssessment.level,
            decision: transfer.riskAssessment.decision,
            reasons: transfer.riskAssessment.reasons
        };
    }

    return response;
}

function getTransferInput(body) {
    return {
        receiverAccountId: body.receiverAccountId || body.toAccount,
        amountMinor: body.amountMinor,
        amount: body.amount,
        currency: typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : undefined,
    };
}

function decimalToMinorUnits(value) {
    if (typeof value !== 'string' || !/^(?:\d+)(?:\.\d{1,2})?$/.test(value.trim())) return null;
    const [whole, fraction = ''] = value.trim().split('.');
    const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return minor > 0n ? minor : null;
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function transactionController(req, res) {
    const input = getTransferInput(req.body);
    const idempotencyKey = req.get('Idempotency-Key');

    if (!input.receiverAccountId || (!input.amountMinor && !input.amount) || !input.currency || !idempotencyKey) {
        return res.status(400).json({ error: { message: 'receiverAccountId, amountMinor, currency, and Idempotency-Key are required' } });
    }
    if (input.currency !== 'INR') {
        return res.status(400).json({ error: { message: 'Only INR transfers are supported' } });
    }

    let amountMinor = input.amount ? decimalToMinorUnits(input.amount) : null;
    if (!amountMinor && input.amountMinor !== undefined) {
        try { amountMinor = BigInt(input.amountMinor); } catch { amountMinor = null; }
    }
    if (amountMinor === null || amountMinor <= 0n) {
        return res.status(400).json({ error: { message: 'Amount must be a positive INR amount with at most two decimal places' } });
    }

    const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({
            receiverAccountId: input.receiverAccountId,
            amountMinor: amountMinor.toString(),
            currency: input.currency
        }))
        .digest('hex');

    try {
        const result = await prisma.$transaction(async (tx) => {
            const existingKey = await tx.idempotencyKey.findUnique({
                where: {
                    userId_key: { userId: req.user.id, key: idempotencyKey }
                },
                include: {
                    transfer: {
                        include: {
                            riskAssessment: true,
                            senderAccount: { select: { accountNumber: true } },
                            receiverAccount: { select: { accountNumber: true } }
                        }
                    }
                }
            });

            if (existingKey) {
                if (existingKey.requestHash !== requestHash) {
                    const error = new Error('Idempotency key was already used for a different request');
                    error.statusCode = 409;
                    throw error;
                }

                return {
                    transfer: existingKey.transfer,
                    replayed: true
                };
            }

            const senderAccount = await tx.account.findFirst({
                where: { userId: req.user.id, currency: 'INR' },
                select: { id: true }
            });
            if (!senderAccount) {
                const error = new Error('An active INR source account is required to start a transfer');
                error.statusCode = 400;
                error.code = 'SOURCE_ACCOUNT_REQUIRED';
                throw error;
            }

            let senderAccountId = senderAccount.id;
            let receiverAccountId = input.receiverAccountId;
            if (!isUuid(receiverAccountId)) {
                const account = await tx.account.findUnique({ where: { accountNumber: receiverAccountId } });
                if (!account) {
                    const error = new Error('Recipient account was not found');
                    error.statusCode = 404;
                    throw error;
                }
                receiverAccountId = account.id;
            }

            if (senderAccountId === receiverAccountId) {
                const error = new Error('Sender and receiver accounts must be different');
                error.statusCode = 400;
                throw error;
            }

            const firstId = senderAccountId < receiverAccountId
                ? senderAccountId
                : receiverAccountId;
            const secondId = firstId === senderAccountId
                ? receiverAccountId
                : senderAccountId;

            await tx.$queryRaw`
                SELECT id
                FROM "accounts"
                WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
                ORDER BY id
                FOR UPDATE
            `;

            const accounts = await tx.account.findMany({
                where: { id: { in: [senderAccountId, receiverAccountId] } },
                include: { user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } } }
            });
            const sender = accounts.find((account) => account.id === senderAccountId);
            const receiver = accounts.find((account) => account.id === receiverAccountId);

            if (!sender || !receiver) {
                const error = new Error('Sender or receiver account was not found');
                error.statusCode = 404;
                throw error;
            }

            if (sender.userId !== req.user.id) {
                const error = new Error('You do not own the sender account');
                error.statusCode = 403;
                throw error;
            }

            const rejectTransfer = async (reason, code = 'TRANSFER_REJECTED', availableBalanceMinor = null) => {
                const failedTransfer = await tx.transfer.create({
                    data: {
                        senderAccountId: sender.id,
                        receiverAccountId: receiver.id,
                        amountMinor,
                        currency: input.currency,
                        status: 'FAILED',
                        failureReason: reason,
                        availableBalanceMinor
                    },
                    include: { senderAccount: { include: { user: true } }, receiverAccount: true }
                });
                await tx.idempotencyKey.create({
                    data: {
                        userId: req.user.id,
                        accountId: sender.id,
                        transferId: failedTransfer.id,
                        key: idempotencyKey,
                        requestHash,
                        responseStatus: 409,
                        responseBody: transferResponse(failedTransfer)
                    }
                });
                await queueTransferFailureNotification(tx, failedTransfer);
                return {
                    transfer: failedTransfer,
                    replayed: false,
                    statusCode: 409,
                    failure: {
                        code,
                        message: reason,
                        details: {
                            ...(availableBalanceMinor === null ? {} : { availableBalanceMinor: availableBalanceMinor.toString() }),
                            requiredAmountMinor: amountMinor.toString(),
                            currency: input.currency
                        }
                    }
                };
            };

            const senderUser = await tx.user.findUnique({
                where: { id: sender.userId },
                select: {
                    name: true, addressLine: true, city: true, region: true, postalCode: true, country: true,
                    email: true, emailOtpChallenge: { select: { email: true, status: true, verifiedAt: true } }
                }
            });
            const profileComplete = senderUser && [
                senderUser.name, senderUser.addressLine, senderUser.city,
                senderUser.region, senderUser.postalCode, senderUser.country
            ].every(value => typeof value === 'string' && value.trim().length > 0);
            if (!profileComplete) {
                return rejectTransfer('Complete your banking profile before starting a transfer', 'PROFILE_INCOMPLETE');
            }
            if (
                !senderUser.emailOtpChallenge ||
                senderUser.emailOtpChallenge.email !== senderUser.email ||
                senderUser.emailOtpChallenge.status !== 'VERIFIED' ||
                !senderUser.emailOtpChallenge.verifiedAt
            ) {
                return rejectTransfer('Verify your email before starting a transfer', 'EMAIL_VERIFICATION_REQUIRED');
            }

            if (sender.status !== 'ACTIVE' || receiver.status !== 'ACTIVE') {
                return rejectTransfer('Both accounts must be active');
            }

            if (sender.currency.trim() !== input.currency || receiver.currency.trim() !== input.currency) {
                return rejectTransfer('Transfer currency must match both account currencies', 'CURRENCY_MISMATCH');
            }

            const balanceRows = await tx.$queryRaw`
                SELECT COALESCE(SUM(
                    CASE WHEN entry_type = 'CREDIT' THEN amount_minor ELSE -amount_minor END
                ), 0)::bigint AS balance
                FROM "ledger_entries"
                WHERE account_id = ${sender.id}::uuid
            `;
            const balanceMinor = BigInt(balanceRows[0].balance);

            if (balanceMinor < amountMinor) {
                return rejectTransfer('Insufficient Funds', 'INSUFFICIENT_FUNDS', balanceMinor);
            }

            const transfer = await tx.transfer.create({
                data: {
                    senderAccountId: sender.id,
                    receiverAccountId: receiver.id,
                    amountMinor,
                    currency: input.currency,
                    status: 'PENDING'
                }
            });

            const risk = await assessTransfer(tx, {
                senderAccountId: sender.id,
                receiverAccountId: receiver.id,
                amountMinor,
                currency: input.currency
            });
            await tx.riskAssessment.create({
                data: {
                    transferId: transfer.id,
                    score: risk.score,
                    level: risk.level,
                    decision: risk.decision,
                    reasons: risk.reasons
                }
            });

            if (risk.level === 'HIGH') {
                const heldTransfer = await tx.transfer.update({
                    where: { id: transfer.id },
                    data: { status: 'REVIEW' },
                    include: { riskAssessment: true }
                });
                const response = transferResponse(heldTransfer);
                await tx.idempotencyKey.create({
                    data: {
                        userId: req.user.id,
                        accountId: sender.id,
                        transferId: transfer.id,
                        key: idempotencyKey,
                        requestHash,
                        responseStatus: 202,
                        responseBody: response
                    }
                });
                return { transfer: heldTransfer, replayed: false, statusCode: 202 };
            }

            await tx.ledgerEntry.createMany({
                data: [
                    { transferId: transfer.id, accountId: sender.id, entryType: 'DEBIT', amountMinor, currency: input.currency },
                    { transferId: transfer.id, accountId: receiver.id, entryType: 'CREDIT', amountMinor, currency: input.currency }
                ]
            });
            const completedTransfer = await tx.transfer.update({
                where: { id: transfer.id },
                data: { status: 'COMPLETED' },
                include: {
                    riskAssessment: true,
                    senderAccount: { include: { user: { select: { id: true, email: true, name: true } } } },
                    receiverAccount: { include: { user: { select: { id: true, email: true, name: true } } } }
                }
            });
            await queueTransferNotifications(tx, completedTransfer);

            const response = transferResponse(completedTransfer);
            await tx.idempotencyKey.create({
                data: {
                    userId: req.user.id,
                    accountId: sender.id,
                    transferId: completedTransfer.id,
                    key: idempotencyKey,
                    requestHash,
                    responseStatus: 201,
                    responseBody: response
                }
            });

            return { transfer: completedTransfer, replayed: false, statusCode: 201 };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });

        if (result.failure) {
            res.status(result.replayed ? 200 : result.statusCode).json({
                error: result.failure,
                transfer: transferResponse(result.transfer),
                replayed: result.replayed
            });
            if (!result.replayed) void dispatchTransactionNotifications(result.transfer.id);
            return;
        }
        res.status(result.replayed ? 200 : result.statusCode).json({
            transfer: transferResponse(result.transfer),
            replayed: result.replayed
        });
        if (result.transfer.status === 'COMPLETED') {
            void dispatchTransactionNotifications(result.transfer.id);
        }
    } catch (error) {
        if (error.code === 'P2002') {
            const existingKey = await prisma.idempotencyKey.findUnique({
                where: {
                    userId_key: { userId: req.user.id, key: idempotencyKey }
                },
                include: {
                    transfer: {
                        include: {
                            riskAssessment: true,
                            senderAccount: { select: { accountNumber: true } },
                            receiverAccount: { select: { accountNumber: true } }
                        }
                    }
                }
            });

            if (existingKey && existingKey.requestHash === requestHash && existingKey.transfer) {
                return res.status(existingKey.responseStatus || 200).json({
                    transfer: transferResponse(existingKey.transfer),
                    replayed: true
                });
            }

            return res.status(409).json({
                error: { message: 'Idempotency key is already in use for a different request' }
            });
        }
        throw error;
    }
}

async function getTransferStatus(req, res) {
    const idempotencyKey = req.get('Idempotency-Key');
    const existingKey = await prisma.idempotencyKey.findUnique({
        where: {
            userId_key: { userId: req.user.id, key: idempotencyKey }
        },
        include: {
            transfer: {
                include: {
                    riskAssessment: true,
                    senderAccount: { select: { accountNumber: true } },
                    receiverAccount: { select: { accountNumber: true } }
                }
            }
        }
    });

    if (!existingKey?.transfer) {
        return res.status(404).json({ error: { message: 'No transfer is recorded for this request key' } });
    }

    return res.json({
        transfer: transferResponse(existingKey.transfer),
        replayed: true
    });
}

module.exports = { transactionController, getTransferStatus, decimalToMinorUnits };
