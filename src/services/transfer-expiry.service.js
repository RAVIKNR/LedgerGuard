const { prisma } = require('../config/db');
const { queueTransferFailureNotification } = require('./transaction-notification.service');

const REVIEW_EXPIRY_MS = 60 * 60 * 1000;

async function expireStaleReviewTransfers(client = prisma, now = new Date()) {
    const cutoff = new Date(now.getTime() - REVIEW_EXPIRY_MS);
    const staleTransfers = await client.transfer.findMany({
        where: { status: { in: ['PENDING', 'REVIEW'] }, createdAt: { lt: cutoff } },
        select: { id: true }
    });
    let expired = 0;

    for (const staleTransfer of staleTransfers) {
        const result = await client.transfer.updateMany({
            where: { id: staleTransfer.id, status: { in: ['PENDING', 'REVIEW'] }, createdAt: { lt: cutoff } },
            data: { status: 'FAILED', failureReason: 'Risk review timed out after 60 minutes' }
        });
        if (!result.count) continue;

        const transfer = await client.transfer.findUnique({
            where: { id: staleTransfer.id },
            include: { senderAccount: { include: { user: true } } }
        });
        if (transfer) await queueTransferFailureNotification(client, transfer);
        expired += 1;
    }

    return { expired };
}

module.exports = { REVIEW_EXPIRY_MS, expireStaleReviewTransfers };
