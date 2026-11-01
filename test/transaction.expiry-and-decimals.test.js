const { decimalToMinorUnits } = require('../src/controllers/transaction.controller');
const { expireStaleReviewTransfers } = require('../src/services/transfer-expiry.service');

jest.mock('../src/config/db', () => ({ prisma: {} }));
jest.mock('../src/services/transaction-notification.service', () => ({
    queueTransferFailureNotification: jest.fn().mockResolvedValue(undefined)
}));

describe('transaction amount parsing', () => {
    test.each([
        ['10.50', 1050n],
        ['5.50', 550n],
        ['100.25', 10025n],
        ['10', 1000n]
    ])('converts %s to paise', (amount, expected) => {
        expect(decimalToMinorUnits(amount)).toBe(expected);
    });

    test.each(['.', '', '10.', '1.234', '1.2.3', '-1.00', '0.00'])(
        'rejects invalid amount %s',
        amount => expect(decimalToMinorUnits(amount)).toBeNull()
    );
});

describe('stale review expiry', () => {
    test('fails only still-review transfers and records the timeout reason', async () => {
        const client = {
            transfer: {
                findMany: jest.fn().mockResolvedValue([{ id: 'review-1' }, { id: 'review-2' }]),
                updateMany: jest.fn()
                    .mockResolvedValueOnce({ count: 1 })
                    .mockResolvedValueOnce({ count: 0 }),
                findUnique: jest.fn().mockResolvedValue({
                    id: 'review-1',
                    senderAccount: { user: { emailVerifiedAt: new Date() } }
                })
            }
        };

        await expect(expireStaleReviewTransfers(client, new Date('2026-01-01T02:00:00.000Z')))
            .resolves.toEqual({ expired: 1 });
        expect(client.transfer.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 'review-1', status: { in: ['PENDING', 'REVIEW'] } }),
            data: { status: 'FAILED', failureReason: 'Risk review timed out after 60 minutes' }
        }));
    });
});
