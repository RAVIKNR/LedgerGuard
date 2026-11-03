const { renderLedgerGuardEmail, renderSecurityNotificationEmail, renderHighAmountSecurityEmail, renderFrequencySecurityEmail, renderAccountEventEmail } = require('../src/services/ledgerguard-email.template');

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) }))
}));

describe('LedgerGuard transactional email template', () => {
    it('renders branded, responsive verification email with plain-text fallback and escaped content', () => {
        const message = renderLedgerGuardEmail({
            recipientName: '<Ravi & Co>',
            title: 'Verify your LedgerGuard email',
            intro: 'Confirm your address.',
            message: 'This link is for your account.',
            actionLabel: 'Verify email address',
            actionUrl: 'https://example.test/verify?token=opaque',
            expiry: '24 hours'
        });

        expect(message.html).toContain('ledger');
        expect(message.html).toContain('role="presentation"');
        expect(message.html).toContain('&lt;Ravi &amp; Co&gt;');
        expect(message.html).not.toContain('<Ravi & Co>');
        expect(message.html).toContain('https://example.test/verify?token=opaque');
        expect(message.html).toContain('24 hours');
        expect(message.text).toContain('https://example.test/verify?token=opaque');
        expect(message.text).toContain('expires in 24 hours');
        expect(message.text).toContain('never ask you to share your password');
    });

    it('sends branded verification content over the configured SMTP transport', async () => {
        const nodemailer = require('nodemailer');
        const original = {
            RESEND_API_KEY: process.env.RESEND_API_KEY,
            EMAIL_USER: process.env.EMAIL_USER,
            CLIENT_ID: process.env.CLIENT_ID,
            CLIENT_SECRET: process.env.CLIENT_SECRET,
            REFRESH_TOKEN: process.env.REFRESH_TOKEN,
            FRONTEND_URL: process.env.FRONTEND_URL
        };
        delete process.env.RESEND_API_KEY;
        process.env.EMAIL_USER = 'sender@example.test';
        process.env.CLIENT_ID = 'test-client';
        process.env.CLIENT_SECRET = 'test-secret';
        process.env.REFRESH_TOKEN = 'test-refresh-token';
        process.env.FRONTEND_URL = 'https://ledgerguard.example.test';

        try {
            const transport = { sendMail: jest.fn().mockResolvedValue({}) };
            nodemailer.createTransport.mockReturnValue(transport);
            const { sendVerificationEmail } = require('../src/services/email.services');

            await sendVerificationEmail('user@example.test', '<Ravi & Co>', 'verification-token');

            const sentMessage = transport.sendMail.mock.calls[0][0];
            expect(sentMessage.subject).toBe('Verify your LedgerGuard email');
            expect(sentMessage.html).toContain('ledger');
            expect(sentMessage.html).toContain('&lt;Ravi &amp; Co&gt;');
            expect(sentMessage.html).toContain('/verify-email?token=verification-token');
            expect(sentMessage.text).toContain('/verify-email?token=verification-token');
            expect(sentMessage.text).toContain('expires in 24 hours');
        } finally {
            for (const [key, value] of Object.entries(original)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('rejects non-web email action links', () => {
        expect(() => renderLedgerGuardEmail({
            recipientName: 'Ravi',
            title: 'Verify your LedgerGuard email',
            intro: 'Confirm your address.',
            message: 'This link is for your account.',
            actionLabel: 'Verify email address',
            actionUrl: 'javascript:alert(1)',
            expiry: '24 hours'
        })).toThrow('Email action links must use HTTP or HTTPS');
    });

    it('escapes account security notification content and provides plain text', () => {
        const message = renderSecurityNotificationEmail({
            recipientName: '<Ravi>',
            eventType: 'ACCOUNT_FROZEN',
            accountIdentifier: 'acct-****-1234',
            previousStatus: 'ACTIVE',
            resultingStatus: 'FROZEN',
            reason: '<unsafe reason>',
            occurredAt: new Date('2026-10-27T10:00:00.000Z')
        });

        expect(message.html).toContain('&lt;Ravi&gt;');
        expect(message.html).toContain('&lt;unsafe reason&gt;');
        expect(message.html).not.toContain('<unsafe reason>');
        expect(message.html).toContain('acct-****-1234');
        expect(message.text).toContain('Previous status: ACTIVE');
        expect(message.text).toContain('Resulting status: FROZEN');
    });

    it('renders configured LedgerGuard account-event actions and event time', () => {
        const message = renderAccountEventEmail({
            recipientName: '<Ravi>',
            title: 'Your LedgerGuard registration is complete',
            intro: 'Your registration was successful.',
            message: 'Continue securely.',
            occurredAt: new Date('2026-10-27T10:00:00.000Z'),
            actionLabel: 'Continue to LedgerGuard',
            actionUrl: 'https://ledgerguard.example.test/'
        });

        expect(message.html).toContain('https://ledgerguard.example.test/');
        expect(message.html).toContain('Event time:');
        expect(message.html).toContain('&lt;Ravi&gt;');
        expect(message.text).toContain('Continue to LedgerGuard: https://ledgerguard.example.test/');
        expect(message.text).toContain('Event time:');
    });

    it('renders the high-amount alert as a structured security review email', () => {
        const message = renderHighAmountSecurityEmail({
            recipientName: 'Ravi',
            amount: '₹75,000.00',
            currency: 'INR',
            recipientAccount: 'acct-****-1234',
            occurredAt: new Date('2026-10-27T10:00:00.000Z'),
            reference: 'transfer-123',
            reasons: 'Unusually large amount',
            reviewDeadlineAt: new Date('2026-10-28T10:00:00.000Z'),
            supportContact: 'admin@example.test'
        });

        expect(message.html).toContain('₹75,000.00');
        expect(message.html).toContain('Transaction details');
        expect(message.html).toContain('What should you do now?');
        expect(message.html).toContain('acct-****-1234');
        expect(message.text).toContain('automatic approval after 24 hours');
    });

    it('renders the frequency alert with a ten-step activity indicator', () => {
        const message = renderFrequencySecurityEmail({
            recipientName: 'Ravi',
            accountIdentifier: 'acct-****-1234',
            occurredAt: new Date('2026-10-27T10:00:00.000Z')
        });

        expect(message.html).toContain('10 successful');
        expect(message.html).toContain('Rolling 24-hour monitor');
        expect((message.html.match(/height:10px/g) || []).length).toBe(10);
        expect(message.html).toContain('This alert does not block your account.');
        expect(message.text).toContain('Review your recent outgoing transactions.');
    });
});
