const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { prisma } = require('../config/db');
const { runReconciliation } = require('../services/reconciliation.service');
const { assessTransfer } = require('../services/risk.service');
const { autoApproveExpiredReviews, AUTO_APPROVE_ENABLED } = require('../services/review-approval.service');
const { dispatchPendingTransactionNotifications } = require('../services/transaction-notification.service');

if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required to start the job worker');
}

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const reconciliationWorker = new Worker('ledgerguard-reconciliation', async () => {
    return runReconciliation();
}, { connection });

const riskWorker = new Worker('ledgerguard-risk', async (job) => {
    return prisma.$transaction(async (tx) => {
        const transfer = await tx.transfer.findUnique({
            where: { id: job.data.transferId },
            include: { riskAssessment: true }
        });
        if (!transfer || !transfer.riskAssessment || !transfer.senderAccountId) {
            throw new Error('Transfer is not eligible for risk reassessment');
        }
        const risk = await assessTransfer(tx, {
            senderAccountId: transfer.senderAccountId,
            receiverAccountId: transfer.receiverAccountId,
            amountMinor: transfer.amountMinor,
            currency: transfer.currency
        });
        await tx.riskAssessment.update({
            where: { transferId: transfer.id },
            data: { score: risk.score, level: risk.level, reasons: risk.reasons }
        });
        return { transferId: transfer.id, score: risk.score, level: risk.level };
    });
}, { connection });

const reviewWorker = new Worker('ledgerguard-review', async () => {
    return autoApproveExpiredReviews();
}, { connection });

const notificationWorker = new Worker('ledgerguard-notifications', async () => {
    return dispatchPendingTransactionNotifications();
}, { connection });

void autoApproveExpiredReviews().catch(error => console.error(JSON.stringify({
    event: 'transfer_review_auto_approval_startup_failed',
    errorName: error instanceof Error ? error.name : 'UnknownError'
})));

if (AUTO_APPROVE_ENABLED) {
    const { Queue } = require('bullmq');
    const reviewQueue = new Queue('ledgerguard-review', { connection });
    void reviewQueue.add('approve-expired-reviews', {}, {
        repeat: { every: 60 * 1000 },
        jobId: 'approve-expired-reviews',
        removeOnComplete: 100,
        removeOnFail: 100
    }).then(() => reviewQueue.close());
}

const { Queue } = require('bullmq');
const notificationQueue = new Queue('ledgerguard-notifications', { connection });
void notificationQueue.add('dispatch-pending-notifications', {}, {
    repeat: { every: 60 * 1000 },
    jobId: 'dispatch-pending-notifications',
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 100
}).then(() => notificationQueue.close());

function shutdown() {
    return Promise.all([
        reconciliationWorker.close(),
        riskWorker.close(),
        reviewWorker.close(),
        notificationWorker.close(),
        connection.quit(),
        prisma.$disconnect()
    ]);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
