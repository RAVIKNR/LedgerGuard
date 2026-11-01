const { prisma } = require('../config/db');
const { sendSecurityNotificationEmail } = require('./email.services');

function maskAccountId(accountId) {
    return `acct-****-${String(accountId).slice(-4)}`;
}

async function queueSecurityNotification(tx, data) {
    return tx.securityNotification.create({
        data: {
            userId: data.userId,
            accountId: data.accountId || null,
            eventType: data.eventType,
            previousStatus: data.previousStatus,
            resultingStatus: data.resultingStatus,
            reason: data.reason || null,
            occurredAt: data.occurredAt ?? new Date()
        }
    });
}

function safeErrorMessage(error) {
    return error instanceof Error ? error.message.slice(0, 255) : 'Notification delivery failed';
}

async function dispatchSecurityNotification(id) {
    try {
        const notification = await prisma.securityNotification.findUnique({
            where: { id },
            include: { user: { select: { email: true, name: true } } }
        });
        if (!notification) return;
        const claimed = await prisma.securityNotification.updateMany({
            where: { id, status: 'PENDING' },
            data: { status: 'SENDING', attempts: { increment: 1 }, lastError: null }
        });
        if (claimed.count !== 1) return;
        try {
            await sendSecurityNotificationEmail({
                ...notification,
                recipientEmail: notification.user.email,
                recipientName: notification.user.name
            });
            await prisma.securityNotification.updateMany({
                where: { id, status: 'SENDING' },
                data: { status: 'SENT', sentAt: new Date(), lastError: null }
            });
        } catch (error) {
            await prisma.securityNotification.updateMany({
                where: { id, status: 'SENDING' },
                data: { status: 'PENDING', lastError: safeErrorMessage(error) }
            });
            console.error(JSON.stringify({
                event: 'security_notification_failed',
                notificationType: notification.eventType,
                attempts: notification.attempts + 1,
                errorName: error instanceof Error ? error.name : 'UnknownError'
            }));
        }
    } catch (error) {
        console.error(JSON.stringify({
            event: 'security_notification_dispatch_failed',
            errorName: error instanceof Error ? error.name : 'UnknownError'
        }));
    }
}

module.exports = { maskAccountId, queueSecurityNotification, dispatchSecurityNotification };
