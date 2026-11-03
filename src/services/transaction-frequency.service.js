const { queueSecurityNotification } = require('./security-notification.service');

async function queueFrequencyAlertIfNeeded(tx, transfer, occurredAt = new Date()) {
    if (!transfer.senderAccountId) return null;

    const successfulOutgoingCount = await tx.transfer.count({
        where: {
            senderAccountId: transfer.senderAccountId,
            status: 'COMPLETED',
            createdAt: { gte: new Date(occurredAt.getTime() - 24 * 60 * 60 * 1000) }
        }
    });
    if (successfulOutgoingCount !== 10) return null;

    const recentAlert = await tx.securityNotification.findFirst({
        where: {
            accountId: transfer.senderAccountId,
            eventType: 'FREQUENCY_ALERT',
            occurredAt: { gte: new Date(occurredAt.getTime() - 24 * 60 * 60 * 1000) }
        },
        select: { id: true }
    });
    if (recentAlert) return null;

    const sender = transfer.senderAccount?.user
        ? { id: transfer.senderAccount.user.id }
        : await tx.account.findUnique({
            where: { id: transfer.senderAccountId },
            select: { userId: true }
        });
    if (!sender) return null;

    const notification = await queueSecurityNotification(tx, {
        userId: sender.id || sender.userId,
        accountId: transfer.senderAccountId,
        eventType: 'FREQUENCY_ALERT',
        previousStatus: 'ACTIVE',
        resultingStatus: 'ACTIVE',
        reason: 'Ten successful outgoing transfers were recorded within 24 hours.',
        occurredAt
    });
    return notification.id;
}

module.exports = { queueFrequencyAlertIfNeeded };
