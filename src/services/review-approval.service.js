const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/db');
const { recordAdminAudit } = require('./admin-audit.service');
const { settleReviewedTransfer } = require('./transfer-settlement.service');
const {
    queueTransferDecisionNotification,
    dispatchTransactionNotifications,
    queueTransferNotifications
} = require('./transaction-notification.service');
const { queueFrequencyAlertIfNeeded } = require('./transaction-frequency.service');
const { dispatchSecurityNotification } = require('./security-notification.service');

const AUTO_APPROVE_ENABLED = process.env.AUTO_APPROVE_REVIEW_ENABLED === 'true';

async function autoApproveExpiredReviews(client = prisma, now = new Date()) {
    if (!AUTO_APPROVE_ENABLED) return { approved: 0 };
    const systemActorId = process.env.SYSTEM_USER_ID;
    if (!systemActorId) throw new Error('SYSTEM_USER_ID is required when automatic review approval is enabled');

    const candidates = await client.transfer.findMany({
        where: { status: 'REVIEW', reviewDeadlineAt: { lte: now } },
        select: { id: true },
        orderBy: { reviewDeadlineAt: 'asc' },
        take: 100
    });
    let approved = 0;
    for (const candidate of candidates) {
        try {
            const result = await client.$transaction(async tx => {
                const transfer = await settleReviewedTransfer(tx, candidate.id, now);
                await queueTransferNotifications(tx, transfer);
                await tx.riskAssessment.update({
                    where: { transferId: candidate.id },
                    data: { decision: 'APPROVED' }
                });
                await recordAdminAudit(tx, {
                    actorId: systemActorId,
                    action: 'SYSTEM_AUTO_APPROVED',
                    targetType: 'TRANSFER',
                    targetId: candidate.id,
                    reason: 'Review deadline expired',
                    metadata: { previousStatus: 'REVIEW', status: 'COMPLETED', decidedAt: now.toISOString() }
                });
                await queueTransferDecisionNotification(tx, transfer, 'APPROVED');
                const frequencyNotificationId = await queueFrequencyAlertIfNeeded(tx, transfer, now);
                return { transfer, frequencyNotificationId };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            approved += 1;
            void dispatchTransactionNotifications(result.transfer.id);
            if (result.frequencyNotificationId) void dispatchSecurityNotification(result.frequencyNotificationId);
        } catch (error) {
            if (error?.code === 'P2034' || error?.statusCode === 409) continue;
            throw error;
        }
    }
    return { approved };
}

module.exports = { AUTO_APPROVE_ENABLED, autoApproveExpiredReviews };
