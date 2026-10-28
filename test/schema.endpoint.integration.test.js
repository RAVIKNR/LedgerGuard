const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

jest.mock('../src/services/email.services', () => {
    const actual = jest.requireActual('../src/services/email.services');

    return {
        ...actual,
        sendLoginConfirmationEmail: jest.fn().mockResolvedValue(undefined),
        sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
        sendAccountCreatedEmail: jest.fn().mockResolvedValue(undefined)
    };
});

const app = require('../src/app');
const databaseIsSafe = process.env.RUN_DB_TESTS === '1' &&
    /ledgerguard_test([?]|$)/.test(process.env.DATABASE_URL || '');
const describeDatabase = databaseIsSafe ? describe : describe.skip;
const prisma = new PrismaClient();

describeDatabase('authenticated endpoint schema compatibility', () => {
    let user;
    let token;

    beforeAll(async () => {
        const email = `schema-check-${Date.now()}@example.test`;
        const registration = await request(app).post('/auth/register').send({
            name: 'Schema Check User',
            email,
            password: 'test-password-123'
        },30000);
        console.log(
  'Registration response:',
  registration.status,
  registration.body
);
expect(registration.status).toBe(201);
        user = registration.body.user;

        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerifiedAt: new Date(),
                phone: '+919876543210',
                addressLine: '1 Ledger Street',
                city: 'Mumbai',
                region: 'MH',
                postalCode: '400001',
                country: 'IN'
            }
        });
        await prisma.emailOtpChallenge.create({
            data: {
                userId: user.id,
                email,
                status: 'VERIFIED',
                windowStartedAt: new Date(),
                sendsInWindow: 1,
                sentAt: new Date(),
                expiresAt: new Date(Date.now() + 300000),
                resendAfterAt: new Date(),
                verificationAttempts: 0,
                verifiedAt: new Date()
            }
        });

        const login = await request(app).post('/auth/login').send({
            email,
            password: 'test-password-123'
        });
        expect(login.status).toBe(200);
        token = login.body.token;
    });

    afterAll(async () => {
        if (user?.id) {
            await prisma.account.deleteMany({ where: { userId: user.id } });
            await prisma.user.delete({ where: { id: user.id } });
        }
        await prisma.$disconnect();
    });

    it('serves account and email OTP status requests after authentication', async () => {
        const accounts = await request(app)
            .get('/api/accounts')
            .set('Authorization', 'Bearer ' + token);
        const otpStatus = await request(app)
            .get('/api/users/me/email-otp/status')
            .set('Authorization', 'Bearer ' + token);

        expect(accounts.status).toBe(200);
        expect(otpStatus.status).toBe(200);
        expect(otpStatus.body).toEqual(expect.objectContaining({
            email: user.email,
            status: 'VERIFIED',
            verified: true
        }));
    });
});
