jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));
jest.mock('../src/services/admin-audit.service', () => ({ recordAdminAudit: jest.fn() }));
jest.mock('../src/services/transaction-notification.service', () => ({
    queueTransferNotifications: jest.fn(),
    dispatchTransactionNotifications: jest.fn()
}));
jest.mock('../src/config/db', () => {
    const state = {
        account: {
            id: '30000000-0000-4000-8000-000000000003',
            accountNumber: '1234567890123456',
            userId: '20000000-0000-4000-8000-000000000002',
            currency: 'INR',
            status: 'ACTIVE',
            user: { id: '20000000-0000-4000-8000-000000000002', email: 'customer@example.com', name: 'Customer', status: 'ACTIVE' }
        },
        idempotency: new Map(),
        ledger: [],
        transfers: []
    };
    const prisma = {
        user: { findUnique: jest.fn(async ({ where }) => ({
            id: where.id,
            name: where.id === adminId ? 'Admin' : 'Customer',
            email: where.id === adminId ? 'admin@example.com' : 'customer@example.com',
            status: 'ACTIVE',
            isAdmin: where.id === '10000000-0000-4000-8000-000000000001'
        })) },
        account: { findUnique: jest.fn(async () => state.account) },
        transfer: { create: jest.fn(async ({ data }) => ({ ...data, id: `transfer-${state.transfers.length + 1}` })) },
        ledgerEntry: { create: jest.fn(async ({ data }) => { state.ledger.push(data); return data; }) },
        idempotencyKey: {
            findUnique: jest.fn(async ({ where }) => state.idempotency.get(where.userId_key.key) || null),
            create: jest.fn(async ({ data }) => { state.idempotency.set(data.key, { ...data, transfer: state.transfers.at(-1) }); return data; })
        },
        $queryRaw: jest.fn(async () => [{ id: state.account.id }]),
        $transaction: jest.fn(async operation => operation(prisma)),
        __state: state
    };
    return { prisma };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { prisma } = require('../src/config/db');
const { dispatchTransactionNotifications } = require('../src/services/transaction-notification.service');

const adminId = '10000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000002';

describe('admin funding operations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = 'funding-test-secret';
        process.env.ADMIN_USER_ID = adminId;
        prisma.__state.idempotency.clear();
        prisma.__state.ledger.length = 0;
        prisma.__state.transfers.length = 0;
        prisma.__state.account.status = 'ACTIVE';
        jwt.verify.mockImplementation(token => ({ sub: token === 'admin-token' ? adminId : customerId }));
        prisma.transfer.create.mockImplementation(async ({ data }) => {
            const transfer = { ...data, id: `transfer-${prisma.__state.transfers.length + 1}`, amountMinor: BigInt(data.amountMinor) };
            prisma.__state.transfers.push(transfer);
            return transfer;
        });
        prisma.idempotencyKey.create.mockImplementation(async ({ data }) => {
            prisma.__state.idempotency.set(data.key, { ...data, transfer: prisma.__state.transfers.at(-1) });
            return data;
        });
    });

    afterAll(() => {
        delete process.env.JWT_SECRET;
        delete process.env.ADMIN_USER_ID;
    });

    it('credits a zero-balance customer account without debiting an admin account', async () => {
        const response = await request(app).post('/admin/funding').set('Authorization', 'Bearer admin-token')
            .set('Idempotency-Key', 'funding-1')
            .send({ accountId: prisma.__state.account.id, amountMinor: '12500', currency: 'INR', reason: 'Customer remediation' });

        expect(response.status).toBe(201);
        expect(prisma.__state.ledger).toHaveLength(1);
        expect(prisma.__state.ledger[0]).toMatchObject({ accountId: prisma.__state.account.id, entryType: 'CREDIT', amountMinor: 12500n, currency: 'INR' });
        expect(prisma.__state.ledger[0].accountId).not.toBe(adminId);
        expect(dispatchTransactionNotifications).toHaveBeenCalledWith(response.body.transfer.id);
    });

    it('rejects ordinary customers and invalid funding requests', async () => {
        const forbidden = await request(app).post('/admin/funding').set('Authorization', 'Bearer customer-token')
            .set('Idempotency-Key', 'funding-customer').send({ accountId: prisma.__state.account.id, amountMinor: '100', currency: 'INR', reason: 'Nope' });
        expect(forbidden.status).toBe(403);

        const invalid = await request(app).post('/admin/funding').set('Authorization', 'Bearer admin-token')
            .set('Idempotency-Key', 'funding-invalid').send({ accountId: prisma.__state.account.id, amountMinor: '0', currency: 'USD', reason: '' });
        expect(invalid.status).toBe(400);
        expect(prisma.__state.ledger).toHaveLength(0);
    });

    it('replays an idempotent request without creating a second credit', async () => {
        const body = { accountId: prisma.__state.account.id, amountMinor: '500', currency: 'INR', reason: 'Approved adjustment' };
        const first = await request(app).post('/admin/funding').set('Authorization', 'Bearer admin-token').set('Idempotency-Key', 'funding-replay').send(body);
        const second = await request(app).post('/admin/funding').set('Authorization', 'Bearer admin-token').set('Idempotency-Key', 'funding-replay').send(body);

        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(prisma.__state.transfers).toHaveLength(1);
        expect(prisma.__state.ledger).toHaveLength(1);
    });

    it('returns privacy-limited recipient details and marks ineligible accounts', async () => {
        const valid = await request(app).get(`/api/accounts/recipient/${prisma.__state.account.id}`)
            .set('Authorization', 'Bearer customer-token');
        expect(valid.status).toBe(200);
        expect(valid.body.recipient).toMatchObject({
            accountNumber: prisma.__state.account.accountNumber,
            holderName: 'Customer',
            eligible: true
        });
        expect(valid.body.recipient).not.toHaveProperty('email');

        prisma.__state.account.status = 'FROZEN';
        const frozen = await request(app).get(`/api/accounts/recipient/${prisma.__state.account.id}`)
            .set('Authorization', 'Bearer customer-token');
        expect(frozen.status).toBe(200);
        expect(frozen.body.recipient.eligible).toBe(false);
    });
});
