
const nodemailer = require('nodemailer');
const { renderLedgerGuardEmail } = require('./ledgerguard-email.template');

class EmailOtpConfigurationError extends Error {
    constructor(settings) {
        super('Email OTP configuration is incomplete');
        this.name = 'EmailOtpConfigurationError';
        this.settings = settings;
    }
}

class EmailOtpDeliveryError extends Error {
    constructor() {
        super('Email OTP delivery failed');
        this.name = 'EmailOtpDeliveryError';
    }
}

function smtpErrorDetails(error) {
    return {
        code: error?.code || null,
        command: error?.command || null,
        responseCode: error?.responseCode || null
    };
}

function assertEmailOtpConfiguration() {
    const deliveryMode = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development'
        ? process.env.EMAIL_OTP_DELIVERY_MODE || 'smtp'
        : 'mailjet';

    if (deliveryMode === 'resend') {
        const settings = [
            ...(!process.env.RESEND_API_KEY ? ['RESEND_API_KEY'] : []),
            ...(!process.env.RESEND_FROM_EMAIL ? ['RESEND_FROM_EMAIL'] : [])
        ];

        if (settings.length) {
            throw new EmailOtpConfigurationError(settings);
        }

        return {
            deliveryMode,
            apiKey: process.env.RESEND_API_KEY,
            from: process.env.RESEND_FROM_EMAIL
        };
    }

    if (deliveryMode === 'mailjet') {
        const settings = [
            ...(!process.env.MAILJET_API_KEY ? ['MAILJET_API_KEY'] : []),
            ...(!process.env.MAILJET_SECRET_KEY ? ['MAILJET_SECRET_KEY'] : []),
            ...(!process.env.MAILJET_FROM_EMAIL ? ['MAILJET_FROM_EMAIL'] : [])
        ];

        if (settings.length) {
            throw new EmailOtpConfigurationError(settings);
        }

        return {
            deliveryMode,
            apiKey: process.env.MAILJET_API_KEY,
            secretKey: process.env.MAILJET_SECRET_KEY,
            from: process.env.MAILJET_FROM_EMAIL
        };
    }

    if (deliveryMode === 'mailpit') {
        const host = process.env.EMAIL_OTP_MAILPIT_HOST || '127.0.0.1';
        const port = Number(process.env.EMAIL_OTP_MAILPIT_PORT || 1025);
        const allowedHosts = ['127.0.0.1', 'localhost', '::1', 'mailpit'];

        if (
            process.env.NODE_ENV !== 'development' ||
            !allowedHosts.includes(host) ||
            port !== 1025
        ) {
            throw new EmailOtpConfigurationError(['EMAIL_OTP_DELIVERY_MODE']);
        }

        return { deliveryMode, host, port };
    }

    if (deliveryMode !== 'smtp') {
        throw new EmailOtpConfigurationError(['EMAIL_OTP_DELIVERY_MODE']);
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    const port = Number(SMTP_PORT);

    const settings = [
        ...(!SMTP_HOST ? ['SMTP_HOST'] : []),
        ...(![465, 587].includes(port) ? ['SMTP_PORT'] : []),
        ...(!SMTP_USER ? ['SMTP_USER'] : []),
        ...(!SMTP_PASS ? ['SMTP_PASS'] : [])
    ];

    if (settings.length) {
        throw new EmailOtpConfigurationError(settings);
    }

    return {
        deliveryMode,
        host: SMTP_HOST,
        port,
        user: SMTP_USER,
        pass: SMTP_PASS
    };
}

async function sendEmailOtp(email, otp) {
    const config = assertEmailOtpConfiguration();

    try {
        const message = renderLedgerGuardEmail({
            title: 'Your LedgerGuard verification code',
            recipientName: 'there',
            intro: 'Use this one-time code to verify the email address on your LedgerGuard account.',
            message: 'If you did not request a code, ignore this email. Do not share the code with anyone.',
            verificationCode: otp,
            expiry: 'five minutes'
        });

        // Resend provider
        if (config.deliveryMode === 'resend') {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: config.from,
                    to: [email],
                    subject: 'Your LedgerGuard verification code',
                    text: message.text,
                    html: message.html
                })
            });

            if (!response.ok) {
                console.error('[email] OTP Resend delivery failed', {
                    status: response.status
                });
                throw new Error('Resend rejected OTP email');
            }

            console.log('[email] OTP delivered through Resend');
            return;
        }

        // Mailjet provider
        if (config.deliveryMode === 'mailjet') {
            const credentials = Buffer.from(
                `${config.apiKey}:${config.secretKey}`
            ).toString('base64');

            const response = await fetch('https://api.mailjet.com/v3.1/send', {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${credentials}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    Messages: [{
                        From: {
                            Email: config.from,
                            Name: 'LedgerGuard'
                        },
                        To: [{ Email: email }],
                        Subject: 'Your LedgerGuard verification code',
                        TextPart: message.text,
                        HTMLPart: message.html
                    }]
                })
            });

            const responseText = await response.text();

            if (!response.ok) {
                console.error('[email] OTP Mailjet delivery failed', {
                    status: response.status
                });
                throw new Error('Mailjet rejected OTP email');
            }

            let result;

            try {
                result = JSON.parse(responseText);
            } catch {
                throw new Error('Invalid Mailjet response');
            }

            if (result?.Messages?.[0]?.Status !== 'success') {
                console.error('[email] Mailjet did not accept the OTP message');
                throw new Error('Mailjet message was not accepted');
            }

            console.log('[email] OTP delivered through Mailjet');
            return;
        }

        // SMTP / Mailpit providers
        const transportOptions = {
            host: config.host,
            port: config.port,
            secure: config.port === 465,
            requireTLS: config.deliveryMode === 'smtp' && config.port === 587
        };

        if (config.deliveryMode === 'smtp') {
            transportOptions.auth = {
                user: config.user,
                pass: config.pass
            };
        }

        const transport = nodemailer.createTransport(transportOptions);

        const from = config.deliveryMode === 'mailpit'
            ? 'LedgerGuard <no-reply@ledgerguard.test>'
            : config.user;

        await transport.sendMail({
            from,
            to: email,
            subject: 'Your LedgerGuard verification code',
            text: message.text,
            html: message.html
        });

        console.log(`[email] OTP delivered through ${config.deliveryMode}`);
    } catch (error) {
        console.error('[email] OTP delivery failed:', smtpErrorDetails(error));
        throw new EmailOtpDeliveryError();
    }
}

module.exports = {
    EmailOtpConfigurationError,
    EmailOtpDeliveryError,
    assertEmailOtpConfiguration,
    sendEmailOtp
};
