jest.mock('../src/config/db', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn()
        },
        passwordResetToken: {
            deleteMany: jest.fn(),
            create: jest.fn(),
            findFirst: jest.fn(),
            updateMany: jest.fn()
        },
        $transaction: jest.fn()
    }
}));

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('new-password-hash')
}));

jest.mock('../src/services/email.services', () => ({
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendPasswordChangedEmail: jest.fn().mockResolvedValue(undefined)
}));

const { prisma } = require('../src/config/db');
const { sendPasswordResetEmail, sendPasswordChangedEmail } = require('../src/services/email.services');
const {
    forgotPassword,
    verifyResetToken,
    resetPassword
} = require('../src/controllers/auth.controller');

function response() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
    };
}

describe('password reset flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
        prisma.passwordResetToken.create.mockResolvedValue({ id: 'reset-1' });
    });

    it('distinguishes existing and nonexistent accounts as explicitly required', async () => {
        prisma.user.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'User' });
        const unknownResponse = response();
        const knownResponse = response();

        await forgotPassword({ body: { email: 'missing@example.com' }, ip: '10.0.0.1' }, unknownResponse, jest.fn());
        await forgotPassword({ body: { email: 'user@example.com' }, ip: '10.0.0.2' }, knownResponse, jest.fn());

        expect(unknownResponse.status).not.toHaveBeenCalled();
        expect(knownResponse.status).not.toHaveBeenCalled();
        expect(unknownResponse.json).toHaveBeenCalledWith({
            accountFound: false,
            message: 'No account found with this email address.'
        });
        expect(knownResponse.json).toHaveBeenCalledWith({
            accountFound: true,
            message: 'Password reset link sent to your registered email.'
        });
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
        expect(prisma.passwordResetToken.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                userId: 'user-1',
                tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                expiresAt: expect.any(Date)
            })
        }));
        const expiresAt = prisma.passwordResetToken.create.mock.calls[0][0].data.expiresAt;
        expect(expiresAt.getTime() - Date.now()).toBeGreaterThanOrEqual(899000);
        expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(900000);
        expect(prisma.user.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
            where: { email: { equals: 'user@example.com', mode: 'insensitive' } }
        }));
    });

    it('rate limits repeated reset requests by client IP', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        const requests = Array.from({ length: 6 }, () => response());

        for (const res of requests) {
            await forgotPassword({ body: { email: 'missing@example.com' }, ip: '10.0.0.3' }, res, jest.fn());
        }

        expect(requests[5].status).toHaveBeenCalledWith(429);
        expect(requests[5].json).toHaveBeenCalledWith({
            error: { message: 'Too many password reset requests. Please try again later.' }
        });
    });

    it('does not expose whether a reset token is expired, used, or invalid', async () => {
        prisma.passwordResetToken.findFirst.mockResolvedValue(null);
        const verifyResponse = response();
        const resetResponse = response();

        await verifyResetToken({ query: { token: 'a'.repeat(64) } }, verifyResponse);
        await resetPassword({
            body: { token: 'b'.repeat(64), newPassword: 'new-password', confirmPassword: 'new-password' }
        }, resetResponse);

        expect(verifyResponse.status).toHaveBeenCalledWith(400);
        expect(resetResponse.status).toHaveBeenCalledWith(400);
        expect(verifyResponse.json).toHaveBeenCalledWith({
            error: { message: 'This reset link is invalid or expired' }
        });
        expect(resetResponse.json).toHaveBeenCalledWith({
            error: { message: 'This reset link is invalid or expired' }
        });
    });

    it('rejects a password confirmation mismatch before database access', async () => {
        const res = response();

        await resetPassword({
            body: { token: 'e'.repeat(64), newPassword: 'new-password', confirmPassword: 'different-password' }
        }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: { message: 'Passwords do not match' } });
        expect(prisma.passwordResetToken.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an expired or previously used token', async () => {
        prisma.passwordResetToken.findFirst
            .mockResolvedValueOnce({
                id: 'expired',
                usedAt: null,
                expiresAt: new Date(Date.now() - 1)
            })
            .mockResolvedValueOnce({
                id: 'used',
                usedAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000)
            });
        const expiredResponse = response();
        const usedResponse = response();

        await resetPassword({
            body: { token: 'f'.repeat(64), newPassword: 'new-password', confirmPassword: 'new-password' }
        }, expiredResponse);
        await resetPassword({
            body: { token: '1'.repeat(64), newPassword: 'new-password', confirmPassword: 'new-password' }
        }, usedResponse);

        expect(expiredResponse.status).toHaveBeenCalledWith(400);
        expect(usedResponse.status).toHaveBeenCalledWith(400);
    });

    it('verifies a valid token and updates the password once', async () => {
        const resetToken = {
            id: 'reset-1',
            userId: 'user-1',
            tokenHash: 'hash',
            usedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            user: { id: 'user-1', email: 'user@example.com', name: 'User' }
        };
        prisma.passwordResetToken.findFirst
            .mockResolvedValueOnce({ id: 'reset-1' })
            .mockResolvedValueOnce(resetToken);
        const userUpdate = jest.fn().mockResolvedValue({ id: 'user-1' });
        prisma.$transaction.mockImplementation(async (callback) => callback({
            passwordResetToken: {
                updateMany: jest.fn()
                    .mockResolvedValueOnce({ count: 1 })
                    .mockResolvedValueOnce({ count: 0 })
            },
            user: { update: userUpdate }
        }));
        const verifyResponse = response();
        const resetResponse = response();

        await verifyResetToken({ query: { token: 'c'.repeat(64) } }, verifyResponse);
        await resetPassword({
            body: { token: 'd'.repeat(64), newPassword: 'new-password', confirmPassword: 'new-password' }
        }, resetResponse);

        expect(verifyResponse.json).toHaveBeenCalledWith({ valid: true });
        expect(resetResponse.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('reset successfully') }));
        expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
        expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                passwordHash: 'new-password-hash',
                authVersion: { increment: 1 }
            })
        }));
    });
});
