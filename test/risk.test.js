const { classify, assessTransfer } = require('../src/services/risk.service');

describe('risk engine', () => {
    it('classifies explainable scores', () => {
        expect(classify(10)).toEqual({ level: 'LOW', decision: 'APPROVED' });
        expect(classify(35)).toEqual({ level: 'MEDIUM', decision: 'APPROVED' });
        expect(classify(60)).toEqual({ level: 'HIGH', decision: 'REVIEW' });
    });

    it('does not apply the frequency penalty below ten attempts', async () => {
        const tx = {
            transfer: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn()
                    .mockResolvedValueOnce(9)
                    .mockResolvedValueOnce(0)
                    .mockResolvedValueOnce(1)
            }
        };
        const result = await assessTransfer(tx, {
            senderAccountId: 'sender',
            receiverAccountId: 'receiver',
            amountMinor: 1000n,
            currency: 'INR'
        });
        expect(result.reasons).not.toContain('Ten or more transfers were attempted in the last 24 hours');
        expect(tx.transfer.count.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
    });

    it('applies exactly one frequency penalty at ten attempts in the rolling window', async () => {
        const tx = {
            transfer: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn()
                    .mockResolvedValueOnce(10)
                    .mockResolvedValueOnce(0)
                    .mockResolvedValueOnce(1)
            }
        };
        const result = await assessTransfer(tx, {
            senderAccountId: 'sender',
            receiverAccountId: 'receiver',
            amountMinor: 1000n,
            currency: 'INR'
        });
        expect(result.reasons.filter(reason => reason.includes('transfers were attempted'))).toHaveLength(1);
        expect(result.score).toBe(25);
    });
});
