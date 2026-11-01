jest.mock('../src/config/db', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            update: jest.fn()
        }
    }
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { prisma } = require('../src/config/db');
const app = require('../src/app');

const user = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Current User',
    email: 'current@example.com',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    phone: null,
    addressLine: null,
    city: null,
    region: null,
    postalCode: null,
    country: null
};

function authHeader() {
    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
    return { Authorization: `Bearer ${token}` };
}

function validProfile(overrides = {}) {
    return {
        name: 'Updated User',
        phone: '+14155552671',
        addressLine: '1 Ledger Street',
        city: 'San Francisco',
        region: 'CA',
        postalCode: '94105',
        country: 'us',
        ...overrides
    };
}

describe('authenticated banking profile', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = 'test-profile-jwt-secret';
        prisma.user.findUnique.mockResolvedValue(user);
    });

    it('returns only the authenticated user profile fields', async () => {
        const response = await request(app).get('/api/users/me').set(authHeader());
        expect(response.status).toBe(200);
        expect(response.body.user.profile).toEqual({
            phone: null,
            addressLine: null,
            city: null,
            region: null,
            postalCode: null,
            country: null
        });
        expect(response.body.user).not.toHaveProperty('passwordHash');
    });

    it('updates the authenticated profile and normalizes country code', async () => {
        prisma.user.update.mockImplementation(async ({ data }) => ({
            ...user,
            ...data,
            country: data.country
        }));
        const response = await request(app)
            .patch('/api/users/me')
            .set(authHeader())
            .send({ ...validProfile(), id: '20000000-0000-4000-8000-000000000002', role: 'ADMIN', isAdmin: true });

        expect(response.status).toBe(200);
        expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: user.id },
            data: expect.objectContaining({
                name: 'Updated User',
                phone: '+14155552671',
                addressLine: '1 Ledger Street',
                country: 'US'
            })
        }));
        expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('isAdmin');
        expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('role');
        expect(response.body.user.profile.country).toBe('US');
        expect(response.body).not.toHaveProperty('user.passwordHash');
    });

    it('requires a phone number and rejects an invalid supplied number', async () => {
        prisma.user.update.mockImplementation(async ({ data }) => ({ ...user, ...data }));
        const withoutPhone = await request(app)
            .patch('/api/users/me')
            .set(authHeader())
            .send(validProfile({ phone: undefined }));
        const invalid = await request(app)
            .patch('/api/users/me')
            .set(authHeader())
            .send(validProfile({ phone: '555-1234' }));

        expect(withoutPhone.status).toBe(400);
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(invalid.status).toBe(400);
    });

    it('rejects unauthenticated updates', async () => {
        const response = await request(app).patch('/api/users/me').send(validProfile());
        expect(response.status).toBe(401);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });
});
