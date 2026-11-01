jest.mock('../src/controllers/auth.controller', () => ({
    registerUser: jest.fn(),
    loginUser: jest.fn(),
    googleAuth: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    forgotPassword: jest.fn((req, res) => res.json({ accountFound: true, message: 'Password reset link sent to your registered email.' })),
    verifyResetToken: jest.fn(),
    resetPassword: jest.fn(),
    logoutUser: jest.fn()
}));

jest.mock('../src/services/email.services', () => ({
    sendVerificationEmail: jest.fn(),
    sendRegistrationConfirmationEmail: jest.fn(),
    sendLoginConfirmationEmail: jest.fn(),
    sendAccountCreatedEmail: jest.fn(),
    sendTransactionEmail: jest.fn(),
    sendFailedTransactionEmail: jest.fn(),
    sendSecurityNotificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendPasswordChangedEmail: jest.fn()
}));

const request = require('supertest');
const app = require('../src/app');
const { forgotPassword } = require('../src/controllers/auth.controller');

describe('forgot-password route email normalization', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([
        ['Ravi.Boi+ledger@gmail.com', 'ravi.boi+ledger@gmail.com'],
        ['User.Name@example.com', 'user.name@example.com'],
        ['User+test@example.com', 'user+test@example.com']
    ])('trims and lowercases %s without removing punctuation', async (input, normalized) => {
        const response = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: `  ${input}  ` });

        expect(response.status).toBe(200);
        expect(forgotPassword).toHaveBeenCalledWith(
            expect.objectContaining({ body: { email: normalized } }),
            expect.anything(),
            expect.anything()
        );
    });
});
