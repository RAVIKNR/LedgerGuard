const { Queue } = require('bullmq');
const IORedis = require('ioredis');

function createConnection() {
    if (!process.env.REDIS_URL) {
        const error = new Error('REDIS_URL is required for background jobs');
        error.statusCode = 503;
        throw error;
    }
    return new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
}

let connection;
let reconciliationQueue;
let riskQueue;
let reviewQueue;
let notificationQueue;

function getQueues() {
    if (!connection) {
        connection = createConnection();
        reconciliationQueue = new Queue('ledgerguard-reconciliation', { connection });
        riskQueue = new Queue('ledgerguard-risk', { connection });
        reviewQueue = new Queue('ledgerguard-review', { connection });
        notificationQueue = new Queue('ledgerguard-notifications', { connection });
    }
    return { reconciliationQueue, riskQueue, reviewQueue, notificationQueue };
}

module.exports = { getQueues };
