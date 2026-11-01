const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { prisma } = require('../config/db');
const { runReconciliation } = require('../services/reconciliation.service');
const { assessTransfer } = require('../services/risk.service');
const { expireStaleReviewTransfers } = require('../services/transfer-expiry.service');

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

const expiryTimer = setInterval(() => {
    expireStaleReviewTransfers().catch(error => console.error(JSON.stringify({
        event: 'transfer_review_expiry_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError'
    })));
}, 60 * 1000);
void expireStaleReviewTransfers().catch(error => console.error(JSON.stringify({
    event: 'transfer_review_expiry_startup_failed',
    errorName: error instanceof Error ? error.name : 'UnknownError'
})));

function shutdown() {
    clearInterval(expiryTimer);
    return Promise.all([
        reconciliationWorker.close(),
        riskWorker.close(),
        connection.quit(),
        prisma.$disconnect()
    ]);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
