const { Prisma } = require('@prisma/client');

function conflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

async function settleReviewedTransfer(tx, transferId, now = new Date()) {
    await tx.$queryRaw`SELECT id FROM "transfers" WHERE id = ${transferId}::uuid FOR UPDATE`;
    const transfer = await tx.transfer.findUnique({
        where: { id: transferId },
        include: { riskAssessment: true }
    });
    if (!transfer || transfer.status !== 'REVIEW' || !transfer.riskAssessment) {
        throw conflict('Only transfers awaiting review can be approved');
    }
    if (!transfer.senderAccountId) {
        throw conflict('A reviewed transfer must have a sender account');
    }

    await tx.$queryRaw`
        SELECT id FROM "accounts"
        WHERE id IN (${transfer.senderAccountId}::uuid, ${transfer.receiverAccountId}::uuid)
        ORDER BY id FOR UPDATE
    `;
    const accounts = await tx.account.findMany({
        where: { id: { in: [transfer.senderAccountId, transfer.receiverAccountId] } },
        select: { id: true, status: true }
    });
    if (accounts.length !== 2 || accounts.some(account => account.status !== 'ACTIVE')) {
        throw conflict('Both accounts must be active to approve this transfer');
    }

    const balanceRows = await tx.$queryRaw`
        SELECT COALESCE(SUM(
            CASE WHEN entry_type = 'CREDIT' THEN amount_minor ELSE -amount_minor END
        ), 0)::bigint AS balance
        FROM "ledger_entries"
        WHERE account_id = ${transfer.senderAccountId}::uuid
    `;
    if (BigInt(balanceRows[0].balance) < transfer.amountMinor) {
        throw conflict('Insufficient funds to approve this transfer');
    }

    await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: 'PROCESSING', updatedAt: now }
    });

    await tx.ledgerEntry.createMany({
        data: [
            { transferId: transfer.id, accountId: transfer.senderAccountId, entryType: 'DEBIT', amountMinor: transfer.amountMinor, currency: transfer.currency },
            { transferId: transfer.id, accountId: transfer.receiverAccountId, entryType: 'CREDIT', amountMinor: transfer.amountMinor, currency: transfer.currency }
        ]
    });
    return tx.transfer.update({
        where: { id: transfer.id },
        data: { status: 'COMPLETED' },
        include: {
            riskAssessment: true,
            senderAccount: { include: { user: true } },
            receiverAccount: { include: { user: true } }
        }
    });
}

module.exports = { settleReviewedTransfer, Prisma };
