jest.mock('jsonwebtoken', () => ({
    verify: jest.fn(() => ({ sub: '10000000-0000-4000-8000-000000000001' }))
}));

jest.mock('../src/config/db', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        emailOtpChallenge: { findUnique: jest.fn() },
        account: { findMany: jest.fn(), create: jest.fn() }
    }
}));

const request = require('supertest');
const { prisma } = require('../src/config/db');
const app = require('../src/app');

const authenticatedUserId = '10000000-0000-4000-8000-000000000001';
const verifiedChallenge = {
    email: 'owner@example.com',
    status: 'VERIFIED',
    verifiedAt: new Date('2026-01-01T00:00:00.000Z')
};

function user(overrides = {}) {
    return {
        id: authenticatedUserId,
        name: 'Account Owner',
        email: 'owner@example.com',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        phone: '+919876543210',
        addressLine: '1 Ledger Street',
        city: 'San Francisco',
        region: 'CA',
        postalCode: '94105',
        country: 'US',
        ...overrides
    };
}

describe('authenticated currency accounts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.user.findUnique.mockResolvedValue(user());
        prisma.emailOtpChallenge.findUnique.mockResolvedValue(verifiedChallenge);
    });

    it('returns only accounts belonging to the authenticated user', async () => {
        prisma.account.findMany.mockResolvedValue([{
            id: '20000000-0000-4000-8000-000000000001',
            userId: authenticatedUserId,
            currency: 'INR ',
            status: 'ACTIVE',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z')
        }]);

        const response = await request(app).get('/api/accounts').set('Authorization', 'Bearer test');
        expect(response.status).toBe(200);
        expect(response.body.accounts).toHaveLength(1);
        expect(response.body.accounts[0]).toMatchObject({ userId: authenticatedUserId, currency: 'INR' });
        expect(prisma.account.findMany).toHaveBeenCalledWith({ where: { userId: authenticatedUserId } });
    });

    it('requires a complete banking profile including a phone number before account creation', async () => {
        prisma.user.findUnique.mockResolvedValueOnce(user({ city: null }));
        const incomplete = await request(app).post('/api/accounts').set('Authorization', 'Bearer test').send({ currency: 'INR' });
        expect(incomplete.status).toBe(400);

        prisma.account.create.mockResolvedValue({
            id: '20000000-0000-4000-8000-000000000002',
            userId: authenticatedUserId,
            currency: 'INR ',
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        const created = await request(app).post('/api/accounts').set('Authorization', 'Bearer test').send({ currency: 'inr' });
        expect(created.status).toBe(201);
        expect(prisma.account.create).toHaveBeenCalledWith({
            data: {
                userId: authenticatedUserId,
                currency: 'INR',
                accountNumber: expect.stringMatching(/^\d{16}$/)
            }
        });
    });

    it('requires email verification from the registered email before account creation', async () => {
        prisma.emailOtpChallenge.findUnique.mockResolvedValue({
            email: 'different@example.com',
            status: 'VERIFIED',
            verifiedAt: new Date()
        });
        const response = await request(app).post('/api/accounts').set('Authorization', 'Bearer test').send({ currency: 'INR' });
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
        expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('rejects unsupported currency codes and reports duplicate account conflicts', async () => {
        const invalid = await request(app).post('/api/accounts').set('Authorization', 'Bearer test').send({ currency: 'ZZZ' });
        expect(invalid.status).toBe(400);
        expect(prisma.account.create).not.toHaveBeenCalled();

        prisma.account.create.mockRejectedValue({ code: 'P2002' });
        const unsupported = await request(app).post('/api/accounts').set('Authorization', 'Bearer test').send({ currency: 'USD' });
        expect(unsupported.status).toBe(400);
        prisma.account.create.mockRejectedValue({ code: 'P2002' });
        const duplicate = await request(app).post('/api/accounts').set('Authorization', 'Bearer test').send({ currency: 'INR' });
        expect(duplicate.status).toBe(409);
    });
});
