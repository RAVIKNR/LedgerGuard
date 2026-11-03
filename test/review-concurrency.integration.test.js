const { PrismaClient, Prisma } = require('@prisma/client');
process.env.AUTO_APPROVE_REVIEW_ENABLED = 'true';
jest.mock('../src/services/transaction-notification.service', () => ({
    ...jest.requireActual('../src/services/transaction-notification.service'),
    dispatchTransactionNotifications: jest.fn().mockResolvedValue(undefined)
}));
const { settleReviewedTransfer } = require('../src/services/transfer-settlement.service');
const { autoApproveExpiredReviews } = require('../src/services/review-approval.service');

const databaseIsSafe = process.env.RUN_DB_TESTS === '1' &&
    /ledgerguard_test([?]|$)/.test(process.env.DATABASE_URL || '');
const describeDatabase = databaseIsSafe ? describe : describe.skip;

describeDatabase('review settlement PostgreSQL concurrency', () => {
    const prisma = new PrismaClient();
    const ids = [];
    let sender;
    let receiver;
    let transfer;

    beforeAll(async () => {
        const senderUser = await prisma.user.create({
            data: { email: `concurrency-sender-${Date.now()}@example.test`, name: 'Concurrency Sender' }
        });
        const receiverUser = await prisma.user.create({
            data: { email: `concurrency-receiver-${Date.now()}@example.test`, name: 'Concurrency Receiver' }
        });
        const systemUser = await prisma.user.create({
            data: { email: `concurrency-system-${Date.now()}@example.test`, name: 'System Approver' }
        });
        ids.push(senderUser.id, receiverUser.id, systemUser.id);
        process.env.SYSTEM_USER_ID = systemUser.id;
        sender = await prisma.account.create({
            data: { accountNumber: `${Date.now()}001`, userId: senderUser.id, currency: 'INR' }
        });
        receiver = await prisma.account.create({
            data: { accountNumber: `${Date.now()}002`, userId: receiverUser.id, currency: 'INR' }
        });
        await prisma.$transaction(async tx => {
            const funding = await tx.transfer.create({
                    data: {
                        senderAccountId: null,
                        receiverAccountId: receiver.id,
                        amountMinor: 10000n,
                        currency: 'INR',
                        status: 'COMPLETED'
                    }
            });
            await tx.ledgerEntry.create({
                data: {
                    transferId: funding.id,
                    accountId: sender.id,
                    entryType: 'CREDIT',
                    amountMinor: 10000n,
                    currency: 'INR'
                }
            });
        });
        transfer = await prisma.transfer.create({
            data: {
                senderAccountId: sender.id,
                receiverAccountId: receiver.id,
                amountMinor: 2500n,
                currency: 'INR',
                status: 'REVIEW',
                reviewDeadlineAt: new Date(Date.now() - 1000)
            }
        });
        await prisma.riskAssessment.create({
            data: {
                transferId: transfer.id,
                score: 60,
                level: 'HIGH',
                decision: 'REVIEW',
                reasons: ['integration test']
            }
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('allows only one of concurrent approval requests to settle', async () => {
        const results = await Promise.allSettled([
            prisma.$transaction(tx => settleReviewedTransfer(tx, transfer.id), {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable
            }),
            prisma.$transaction(tx => settleReviewedTransfer(tx, transfer.id), {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable
            })
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const entries = await prisma.ledgerEntry.findMany({ where: { transferId: transfer.id } });
        expect(entries).toHaveLength(2);
        expect(await prisma.transfer.findUnique({ where: { id: transfer.id }, select: { status: true } }))
            .toEqual({ status: 'COMPLETED' });
    });

    it('does not settle after a concurrent rejection wins', async () => {
        const review = await prisma.transfer.create({
            data: {
                senderAccountId: sender.id,
                receiverAccountId: receiver.id,
                amountMinor: 1500n,
                currency: 'INR',
                status: 'REVIEW'
            }
        });
        await prisma.riskAssessment.create({
            data: { transferId: review.id, score: 60, level: 'HIGH', decision: 'REVIEW', reasons: ['race'] }
        });
        let releaseRejection;
        const rejectionReady = new Promise(resolve => {
            releaseRejection = resolve;
        });
        const rejectionStarted = new Promise(resolve => {
            review.rejectionStarted = resolve;
        });
        const rejection = prisma.$transaction(async tx => {
                await tx.$queryRaw`SELECT id FROM "transfers" WHERE id = ${review.id}::uuid FOR UPDATE`;
                review.rejectionStarted();
                await rejectionReady;
                const rejected = await tx.transfer.updateMany({
                    where: { id: review.id, status: 'REVIEW' },
                    data: { status: 'FAILED', failureReason: 'Rejected in race test' }
                });
                if (rejected.count !== 1) throw new Error('Review was already resolved');
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        await rejectionStarted;
        const approval = prisma.$transaction(tx => settleReviewedTransfer(tx, review.id), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
        releaseRejection();
        const results = await Promise.allSettled([approval, rejection]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const final = await prisma.transfer.findUnique({ where: { id: review.id }, select: { status: true } });
        expect(final.status).toBe('FAILED');
        expect(await prisma.ledgerEntry.count({ where: { transferId: review.id } })).toBe(0);
        await prisma.riskAssessment.delete({ where: { transferId: review.id } });
        await prisma.transfer.delete({ where: { id: review.id } });
    });

    it('auto-approves an expired review exactly once when explicitly enabled', async () => {
        const autoReview = await prisma.transfer.create({
            data: {
                senderAccountId: sender.id,
                receiverAccountId: receiver.id,
                amountMinor: 1200n,
                currency: 'INR',
                status: 'REVIEW',
                reviewDeadlineAt: new Date(Date.now() - 1000)
            }
        });
        await prisma.riskAssessment.create({
            data: { transferId: autoReview.id, score: 60, level: 'HIGH', decision: 'REVIEW', reasons: ['auto'] }
        });
        await expect(autoApproveExpiredReviews(prisma, new Date())).resolves.toEqual({ approved: 1 });
        expect(await prisma.ledgerEntry.count({ where: { transferId: autoReview.id } })).toBe(2);
        await expect(autoApproveExpiredReviews(prisma, new Date())).resolves.toEqual({ approved: 0 });
    });
});
