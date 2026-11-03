jest.mock('../src/config/db', () => ({
    prisma: {
        user: { findUnique: jest.fn(), update: jest.fn() },
        emailOtpChallenge: {
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn()
        },
        account: { create: jest.fn() }
    }
}));

jest.mock('../src/services/email-otp.service', () => ({
    EmailOtpConfigurationError: class EmailOtpConfigurationError extends Error {
        constructor(settings) {
            super('Email OTP configuration is incomplete');
            this.settings = settings;
        }
    },
    EmailOtpDeliveryError: class EmailOtpDeliveryError extends Error {},
    assertEmailOtpConfiguration: jest.fn(),
    sendEmailOtp: jest.fn()
}));
jest.mock('../src/services/email.services', () => ({
    ...jest.requireActual('../src/services/email.services'),
    sendAccountCreatedEmail: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { prisma } = require('../src/config/db');
const emailOtpService = require('../src/services/email-otp.service');
const app = require('../src/app');

const userId = '10000000-0000-4000-8000-000000000001';
const email = 'current@example.com';
let user;
let challenge;
let deliveredOtp;

function authHeader() {
    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET);
    return { Authorization: `Bearer ${token}` };
}

function validProfile(overrides = {}) {
    return {
        name: 'Current User',
        phone: '+919876543210',
        addressLine: '1 Ledger Street',
        city: 'Mumbai',
        region: 'MH',
        postalCode: '400001',
        country: 'IN',
        ...overrides
    };
}

function applyUpdate(target, data) {
    for (const [key, value] of Object.entries(data)) {
        target[key] = value && typeof value === 'object' && 'increment' in value
            ? target[key] + value.increment
            : value;
    }
}

describe('authenticated email OTP verification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = 'test-email-otp-secret';
        process.env.EMAIL_OTP_EXPIRY_SECONDS = '300';
        process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS = '60';
        emailOtpService.assertEmailOtpConfiguration.mockImplementation(() => undefined);
        user = {
            id: userId,
            name: 'Current User',
            email,
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
        challenge = null;
        deliveredOtp = null;
        prisma.user.findUnique.mockImplementation(async () => ({ ...user }));
        prisma.emailOtpChallenge.findUnique.mockImplementation(async () => challenge && { ...challenge });
        prisma.emailOtpChallenge.create.mockImplementation(async ({ data }) => {
            challenge = { ...data, id: '30000000-0000-4000-8000-000000000001', createdAt: new Date(), updatedAt: new Date() };
            return { ...challenge };
        });
        prisma.emailOtpChallenge.update.mockImplementation(async ({ where, data }) => {
            if (where.id && challenge.id !== where.id) throw new Error('challenge not found');
            applyUpdate(challenge, data);
            return { ...challenge };
        });
        prisma.emailOtpChallenge.updateMany.mockImplementation(async ({ where, data }) => {
            if (!challenge || (where.id && challenge.id !== where.id) || (where.status && challenge.status !== where.status)) {
                return { count: 0 };
            }
            if (where.email && challenge.email !== where.email) return { count: 0 };
            if (where.resendAfterAt?.lte && challenge.resendAfterAt > where.resendAfterAt.lte) return { count: 0 };
            if (where.expiresAt?.gt && challenge.expiresAt <= where.expiresAt.gt) return { count: 0 };
            if (where.expiresAt?.lte && challenge.expiresAt > where.expiresAt.lte) return { count: 0 };
            if (where.verificationAttempts?.lt !== undefined && challenge.verificationAttempts >= where.verificationAttempts.lt) return { count: 0 };
            if (where.otpHash && challenge.otpHash !== where.otpHash) return { count: 0 };
            if (where.sendsInWindow !== undefined && challenge.sendsInWindow !== where.sendsInWindow) return { count: 0 };
            if (where.sendHistory?.equals && (
                challenge.sendHistory.length !== where.sendHistory.equals.length ||
                challenge.sendHistory.some((date, index) => date.getTime() !== where.sendHistory.equals[index].getTime())
            )) return { count: 0 };
            applyUpdate(challenge, data);
            return { count: 1 };
        });
        prisma.account.create.mockResolvedValue({
            id: '20000000-0000-4000-8000-000000000001',
            userId,
            currency: 'INR',
            status: 'ACTIVE',
            createdAt: new Date()
        });
        emailOtpService.sendEmailOtp.mockImplementation(async (recipient, otp) => {
            expect(recipient).toBe(email);
            deliveredOtp = otp;
        });
    });

    async function sendCode(body = {}) {
        return request(app).post('/api/users/me/email-otp/send').set(authHeader()).send(body);
    }

    async function verifyCode(otp = deliveredOtp, body = {}) {
        return request(app).post('/api/users/me/email-otp/verify').set(authHeader()).send({ ...body, otp });
    }

    it('sends a random code to the authenticated registered email and stores only its hash', async () => {
        const response = await sendCode({ email: 'attacker@example.com' });

        expect(response.status).toBe(200);
        expect(response.body.email).toBe(email);
        expect(response.body).not.toHaveProperty('otp');
        expect(response.body).not.toHaveProperty('otpHash');
        expect(challenge.email).toBe(email);
        expect(challenge.otpHash).toEqual(expect.any(String));
        expect(challenge.otpHash).not.toBe(deliveredOtp);
        expect(challenge.status).toBe('SENT');
        expect(emailOtpService.sendEmailOtp).toHaveBeenCalledWith(email, deliveredOtp);
        expect(deliveredOtp).toMatch(/^\d{6}$/);
    });

    it('returns actionable configuration errors before consuming a send or cooldown', async () => {
        emailOtpService.assertEmailOtpConfiguration.mockImplementationOnce(() => {
            throw new emailOtpService.EmailOtpConfigurationError(['SMTP_PASS']);
        });

        const response = await sendCode();

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
        expect(response.body.error.message).toContain('SMTP_PASS');
        expect(prisma.emailOtpChallenge.findUnique).not.toHaveBeenCalled();
        expect(prisma.emailOtpChallenge.create).not.toHaveBeenCalled();
        expect(emailOtpService.sendEmailOtp).not.toHaveBeenCalled();
    });

    it('does not consume quota or cooldown when delivery-time configuration validation fails', async () => {
        emailOtpService.sendEmailOtp.mockRejectedValueOnce(
            new emailOtpService.EmailOtpConfigurationError(['SMTP_PASS'])
        );

        const response = await sendCode();

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
        expect(challenge.status).toBe('DELIVERY_FAILED');
        expect(challenge.sendsInWindow).toBe(0);
        expect(challenge.sendHistory).toEqual([]);
        expect(challenge.resendAfterAt.getTime()).toBeLessThanOrEqual(Date.now());

        const retry = await sendCode();
        expect(retry.status).toBe(200);
        expect(challenge.sendsInWindow).toBe(1);
    });

    it('rejects unauthenticated requests and does not send email', async () => {
        const response = await request(app).post('/api/users/me/email-otp/send');

        expect(response.status).toBe(401);
        expect(emailOtpService.sendEmailOtp).not.toHaveBeenCalled();
    });

    it('enforces resend cooldown and permits resend after the cooldown', async () => {
        await sendCode();
        const earlyResend = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());
        expect(earlyResend.status).toBe(429);
        expect(earlyResend.body.error.code).toBe('OTP_COOLDOWN');
        expect(earlyResend.body.retryAfterSeconds).toBeGreaterThan(0);
        expect(earlyResend.body.retryAt).toBe(challenge.resendAfterAt.toISOString());
        expect(earlyResend.headers['retry-after']).toBeDefined();
        expect(emailOtpService.sendEmailOtp).toHaveBeenCalledTimes(1);

        challenge.resendAfterAt = new Date(Date.now() - 1000);
        const resend = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());
        expect(resend.status).toBe(200);
        expect(emailOtpService.sendEmailOtp).toHaveBeenCalledTimes(2);
        expect(challenge.sendsInWindow).toBe(2);
    });

    it('returns a retry time when the five-send daily limit is reached', async () => {
        await sendCode();
        challenge.sendsInWindow = 5;
        challenge.sendHistory = Array.from({ length: 5 }, (_, index) =>
            new Date(Date.now() - (23 * 60 * 60 * 1000) + index)
        );
        challenge.windowStartedAt = challenge.sendHistory[0];
        challenge.resendAfterAt = new Date(Date.now() - 1000);

        const response = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());

        expect(response.status).toBe(429);
        expect(response.body.error.code).toBe('OTP_SEND_LIMIT');
        expect(response.body.retryAfterSeconds).toBeGreaterThan(0);
        expect(response.body.retryAfterSeconds).toBeLessThanOrEqual(3600);
        expect(response.headers['retry-after']).toBeDefined();
        expect(new Date(response.body.retryAt).getTime()).toBe(challenge.sendHistory[0].getTime() + 86400000);
        expect(emailOtpService.sendEmailOtp).toHaveBeenCalledTimes(1);
    });

    it('returns the rolling-window reset time in verification status', async () => {
        await sendCode();
        challenge.sendHistory = Array.from(
            { length: 5 },
            (_, index) => new Date(Date.now() - (23 * 60 * 60 * 1000) + index)
        );
        challenge.sendsInWindow = 5;
        challenge.windowStartedAt = challenge.sendHistory[0];

        const response = await request(app)
            .get('/api/users/me/email-otp/status')
            .set(authHeader());

        expect(response.status).toBe(200);
        expect(response.body.sendLimitRetryAfterSeconds).toBeGreaterThan(0);
        expect(new Date(response.body.sendLimitRetryAt).getTime()).toBe(challenge.sendHistory[0].getTime() + 86400000);
    });

    it('expires sends individually in the rolling 24-hour window', async () => {
        await sendCode();
        const now = Date.now();
        challenge.sendHistory = [
            new Date(now - 86400000 - 1000),
            new Date(now - 12 * 60 * 60 * 1000),
            new Date(now - 11 * 60 * 60 * 1000),
            new Date(now - 10 * 60 * 60 * 1000),
            new Date(now - 9 * 60 * 60 * 1000)
        ];
        challenge.sendsInWindow = challenge.sendHistory.length;
        challenge.windowStartedAt = challenge.sendHistory[0];
        challenge.resendAfterAt = new Date(now - 1000);

        const allowed = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());

        expect(allowed.status).toBe(200);
        expect(challenge.sendsInWindow).toBe(5);
        expect(challenge.sendHistory).toHaveLength(5);
        expect(challenge.sendHistory[0].getTime()).toBeGreaterThan(now - 86400000);

        challenge.resendAfterAt = new Date(Date.now() - 1000);
        const limited = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());

        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe('OTP_SEND_LIMIT');
        expect(new Date(limited.body.retryAt).getTime()).toBe(challenge.sendHistory[0].getTime() + 86400000);
    });

    it('does not consume quota or start cooldown when mail delivery fails', async () => {
        await sendCode();
        const historyBeforeFailure = [...challenge.sendHistory];
        challenge.resendAfterAt = new Date(Date.now() - 1000);
        emailOtpService.sendEmailOtp.mockRejectedValueOnce(new emailOtpService.EmailOtpDeliveryError());

        const response = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());

        expect(response.status).toBe(502);
        expect(response.body.error.code).toBe('EMAIL_DELIVERY_FAILED');
        expect(response.body.error.message).not.toMatch(/password|secret|stack|ECONN/i);
        expect(response.body).not.toHaveProperty('retryAfterSeconds');
        expect(response.body).not.toHaveProperty('retryAt');
        expect(challenge.status).toBe('DELIVERY_FAILED');
        expect(challenge.otpHash).toBeNull();
        expect(challenge.sendsInWindow).toBe(1);
        expect(challenge.sendHistory).toEqual(historyBeforeFailure);
        expect(challenge.resendAfterAt.getTime()).toBeLessThanOrEqual(Date.now());

        const retry = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());
        expect(retry.status).toBe(200);
        expect(challenge.sendsInWindow).toBe(2);
        expect(challenge.sendHistory).toHaveLength(2);
    });

    it('rejects an expired code', async () => {
        await sendCode();
        challenge.expiresAt = new Date(Date.now() - 1000);

        const response = await verifyCode();

        expect(response.status).toBe(410);
        expect(response.body.error.code).toBe('OTP_EXPIRED');
        expect(challenge.status).toBe('EXPIRED');
    });

    it('counts incorrect codes and locks verification after five attempts', async () => {
        await sendCode();
        const wrongOtp = deliveredOtp === '000000' ? '000001' : '000000';
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const response = await verifyCode(wrongOtp);
            expect(response.status).toBe(400);
        }
        const fifth = await verifyCode(wrongOtp);
        expect(fifth.status).toBe(429);
        expect(fifth.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
        expect(fifth.body.retryAfterSeconds).toBeGreaterThan(0);
        expect(challenge.verificationAttempts).toBe(5);

        const sixth = await verifyCode(deliveredOtp);
        expect(sixth.status).toBe(429);
    });

    it('verifies successfully, invalidates the code, and permits currency-account creation', async () => {
        await sendCode();
        const verified = await verifyCode();

        expect(verified.status).toBe(200);
        expect(verified.body.verified).toBe(true);
        expect(challenge.status).toBe('VERIFIED');
        expect(challenge.otpHash).toBeNull();

        user = { ...user, ...validProfile() };
        prisma.emailOtpChallenge.findUnique.mockResolvedValue({ ...challenge });
        const account = await request(app)
            .post('/api/accounts')
            .set(authHeader())
            .send({ currency: 'INR' });

        expect(account.status).toBe(201);
        expect(prisma.account.create).toHaveBeenCalledWith({
            data: {
                userId,
                currency: 'INR',
                accountNumber: expect.stringMatching(/^\d{16}$/)
            }
        });
    });

    it('prevents account creation without server-verified email status', async () => {
        user = { ...user, ...validProfile() };
        prisma.emailOtpChallenge.findUnique.mockResolvedValue(null);

        const response = await request(app)
            .post('/api/accounts')
            .set(authHeader())
            .send({ currency: 'INR' });

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
        expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('does not reuse verification if the registered email changes', async () => {
        await sendCode();
        await verifyCode();
        user.email = 'changed@example.com';
        user = { ...user, ...validProfile(), email: 'changed@example.com' };
        prisma.emailOtpChallenge.findUnique.mockResolvedValue({ ...challenge });

        const response = await request(app)
            .post('/api/accounts')
            .set(authHeader())
            .send({ currency: 'INR' });

        expect(response.status).toBe(403);
        expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('enforces the per-user daily send limit', async () => {
        await sendCode();
        challenge.resendAfterAt = new Date(Date.now() - 1000);
        for (let i = 1; i < 5; i += 1) {
            await request(app).post('/api/users/me/email-otp/resend').set(authHeader());
            challenge.resendAfterAt = new Date(Date.now() - 1000);
        }
        const limited = await request(app).post('/api/users/me/email-otp/resend').set(authHeader());
        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe('OTP_SEND_LIMIT');
        expect(emailOtpService.sendEmailOtp).toHaveBeenCalledTimes(5);
    });

    it('requires a phone number when saving a complete profile', async () => {
        prisma.user.update.mockResolvedValue({ ...user, ...validProfile() });
        const response = await request(app)
            .patch('/api/users/me')
            .set(authHeader())
            .send(validProfile());

        expect(response.status).toBe(200);
        expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ phone: '+919876543210' })
        }));
    });
});
