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
    const deliveryMode = process.env.EMAIL_OTP_DELIVERY_MODE || 'smtp';
    if (deliveryMode === 'mailpit') {
        const host = process.env.EMAIL_OTP_MAILPIT_HOST || '127.0.0.1';
        const port = Number(process.env.EMAIL_OTP_MAILPIT_PORT || 1025);
        const allowedHosts = ['127.0.0.1', 'localhost', '::1', 'mailpit'];
        if (process.env.NODE_ENV !== 'development' || !allowedHosts.includes(host) || port !== 1025) {
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
    if (settings.length) throw new EmailOtpConfigurationError(settings);
    return { deliveryMode, host: SMTP_HOST, port, user: SMTP_USER, pass: SMTP_PASS };
}

async function sendEmailOtp(email, otp) {
    const { deliveryMode, host, port, user, pass } = assertEmailOtpConfiguration();

    try {
        const transportOptions = {
            host,
            port,
            secure: port === 465,
            requireTLS: deliveryMode === 'smtp' && port === 587
        };
        const from = deliveryMode === 'mailpit' ? 'LedgerGuard <no-reply@ledgerguard.test>' : user;
        if (deliveryMode === 'smtp') transportOptions.auth = { user, pass };
        const transport = nodemailer.createTransport(transportOptions);
        const message = renderLedgerGuardEmail({
            title: 'Your LedgerGuard verification code',
            recipientName: 'there',
            intro: 'Use this one-time code to verify the email address on your LedgerGuard account.',
            message: 'If you did not request a code, ignore this email. Do not share the code with anyone.',
            verificationCode: otp,
            expiry: 'five minutes'
        });
        await transport.sendMail({
            from,
            to: email,
            subject: 'Your LedgerGuard verification code',
            text: message.text,
            html: message.html
        });
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
