const { createHmac, randomInt, timingSafeEqual } = require('crypto');
const { prisma } = require('../config/db');
const emailOtpService = require('../services/email-otp.service');

const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_DAY = 5;
const SEND_WINDOW_MS = 24 * 60 * 60 * 1000;

function getExpirySeconds() {
    const expiry = Number(process.env.EMAIL_OTP_EXPIRY_SECONDS || 300);
    if (expiry !== 300) throw new emailOtpService.EmailOtpConfigurationError(['EMAIL_OTP_EXPIRY_SECONDS']);
    return expiry;
}

function getCooldownSeconds() {
    const cooldown = Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS || 60);
    if (cooldown !== 60) throw new emailOtpService.EmailOtpConfigurationError(['EMAIL_OTP_RESEND_COOLDOWN_SECONDS']);
    return cooldown;
}

function emailConfigurationUnavailable(res, error) {
    const settings = Array.isArray(error.settings) ? error.settings : [];
    return res.status(503).json({
        error: {
            code: 'EMAIL_DELIVERY_UNAVAILABLE',
            message: settings.length
                ? `Email verification is not configured. Check these backend settings: ${settings.join(', ')}.`
                : 'Email verification is not configured. Check SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS, EMAIL_OTP_EXPIRY_SECONDS=300, and EMAIL_OTP_RESEND_COOLDOWN_SECONDS=60.'
        }
    });
}

function hashOtp(userId, email, otp) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('Email OTP hashing is unavailable');
    return createHmac('sha256', secret).update(`${userId}:${email}:${otp}`).digest('hex');
}

function hashesMatch(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string' || expected.length !== actual.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function generateOtp() {
    return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
}

function challengeResponse(email, challenge, now = new Date()) {
    const cutoff = new Date(now.getTime() - SEND_WINDOW_MS);
    const sentAtHistory = challenge?.email === email
        ? challenge.sendHistory ?? Array.from(
            { length: challenge.sendsInWindow },
            () => challenge.windowStartedAt
        )
        : [];
    const activeSendTimes = sentAtHistory.filter(sentAt => sentAt > cutoff);
    const sendLimitRetryAt = activeSendTimes.length >= MAX_SENDS_PER_DAY
        ? new Date(activeSendTimes[0].getTime() + SEND_WINDOW_MS)
        : null;
    return {
        email,
        status: challenge?.status || 'NOT_SENT',
        verified: challenge?.status === 'VERIFIED' && challenge.email === email && Boolean(challenge.verifiedAt),
        verifiedAt: challenge?.verifiedAt || null,
        expiresAt: challenge?.expiresAt || null,
        resendAfterAt: challenge?.resendAfterAt || null,
        resendCooldownSeconds: challenge?.resendAfterAt
            ? Math.max(0, Math.ceil((challenge.resendAfterAt.getTime() - now.getTime()) / 1000))
            : 0,
        sendLimitRetryAt,
        sendLimitRetryAfterSeconds: sendLimitRetryAt
            ? Math.max(0, Math.ceil((sendLimitRetryAt.getTime() - now.getTime()) / 1000))
            : 0
    };
}


async function getEmailOtpStatus(req, res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const challenge = await prisma.emailOtpChallenge.findUnique({
        where: { userId: req.user.id }
    });

    const response = challengeResponse(req.user.email, challenge);
    return res.json(response);
}


async function deliverCode(req, res, isResend) {
    const email = req.user.email;
    const userId = req.user.id;
    const now = new Date();
    let expirySeconds;
    let cooldownSeconds;
    try {
        expirySeconds = getExpirySeconds();
        cooldownSeconds = getCooldownSeconds();
    } catch (error) {
        if (error instanceof emailOtpService.EmailOtpConfigurationError) {
            return emailConfigurationUnavailable(res, error);
        }
        throw error;
    }
    try {
        emailOtpService.assertEmailOtpConfiguration();
    } catch (error) {
        if (error instanceof emailOtpService.EmailOtpConfigurationError) {
            return emailConfigurationUnavailable(res, error);
        }
        throw error;
    }
    let challenge = await prisma.emailOtpChallenge.findUnique({ where: { userId } });

    if (challenge?.email === email && challenge.status === 'VERIFIED' && challenge.verifiedAt) {
        return res.status(409).json({ error: { code: 'EMAIL_ALREADY_VERIFIED', message: 'This email address is already verified.' } });
    }
    if (challenge?.status === 'SENDING') {
        return res.status(409).json({ error: { code: 'OTP_REQUEST_PENDING', message: 'An email verification request is already in progress.' } });
    }
    if (isResend && !challenge) {
        return res.status(409).json({ error: { code: 'OTP_NOT_SENT', message: 'Request an email verification code first.' } });
    }
    if (challenge?.email === email && challenge.status === 'SENT' && !isResend) {
        return res.status(409).json({ error: { code: 'OTP_ALREADY_SENT', message: 'Use resend after the cooldown to request another code.' } });
    }
    if (challenge?.email === email && challenge.resendAfterAt > now) {
        const retryAfter = Math.ceil((challenge.resendAfterAt.getTime() - now.getTime()) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
            error: { code: 'OTP_COOLDOWN', message: `Please wait ${retryAfter} seconds before requesting another code.` },
            retryAfterSeconds: retryAfter,
            retryAt: challenge.resendAfterAt.toISOString()
        });
    }

    const cutoff = new Date(now.getTime() - SEND_WINDOW_MS);
    const storedSendTimes = challenge?.email === email
        ? challenge.sendHistory ?? Array.from(
            { length: challenge.sendsInWindow },
            () => challenge.windowStartedAt
        )
        : [];
    const activeSendTimes = storedSendTimes.filter(sentAt => sentAt > cutoff);
    const sendsInWindow = activeSendTimes.length;
    if (sendsInWindow >= MAX_SENDS_PER_DAY) {
        const retryAt = new Date(activeSendTimes[0].getTime() + SEND_WINDOW_MS);
        const retryAfter = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
            error: { code: 'OTP_SEND_LIMIT', message: `The email verification request limit has been reached. Try again in ${retryAfter} seconds.` },
            retryAfterSeconds: retryAfter,
            retryAt: retryAt.toISOString()
        });
    }

    const otp = generateOtp();
    const id = challenge?.id;
    const reservedChallenge = {
        email,
        otpHash: hashOtp(userId, email, otp),
        status: 'SENDING',
        windowStartedAt: challenge?.windowStartedAt || now,
        sendsInWindow: challenge?.sendsInWindow || 0,
        sendHistory: challenge?.sendHistory ?? [],
        sentAt: null,
        expiresAt: new Date(now.getTime() + expirySeconds * 1000),
        resendAfterAt: challenge?.email === email ? challenge.resendAfterAt : now,
        verificationAttempts: 0,
        verifiedAt: null
    };

    try {
        if (challenge) {
            const changed = await prisma.emailOtpChallenge.updateMany({
                where: {
                    id,
                    status: challenge.status,
                    email: challenge.email,
                    sendsInWindow: challenge.sendsInWindow,
                    sendHistory: { equals: challenge.sendHistory ?? storedSendTimes },
                    ...(challenge.email === email ? { resendAfterAt: { lte: now } } : {}),
                },
                data: reservedChallenge
            });
            if (changed.count !== 1) {
                return res.status(409).json({ error: { code: 'OTP_CHALLENGE_CHANGED', message: 'The verification request changed. Please refresh and try again.' } });
            }
        } else {
            challenge = await prisma.emailOtpChallenge.create({ data: { userId, ...reservedChallenge } });
        }
    } catch (error) {
    console.error('[EMAIL OTP] Prisma error:', {
        code: error.code,
        meta: error.meta,
        message: error.message
    });

    if (error.code === 'P2002') {
        return res.status(409).json({
            error: {
                code: 'OTP_REQUEST_PENDING',
                message: 'An email verification request is already in progress.'
            }
        });
    }

    throw error;
}

    const challengeId = challenge.id;
    try {
        await emailOtpService.sendEmailOtp(email, otp);
    } catch (error) {
        const failed = await prisma.emailOtpChallenge.updateMany({
            where: { id: challengeId, status: 'SENDING' },
            data: { status: 'DELIVERY_FAILED', otpHash: null, sentAt: null }
        });
        if (failed.count !== 1) {
            throw new Error('Email OTP delivery state changed before failure could be recorded');
        }
        if (error instanceof emailOtpService.EmailOtpConfigurationError) {
            return emailConfigurationUnavailable(res, error);
        }
        if (error instanceof emailOtpService.EmailOtpDeliveryError) {
            return res.status(502).json({
                error: { code: 'EMAIL_DELIVERY_FAILED', message: 'The verification email could not be delivered. Check the backend email settings and try again.' }
            });
        }
        throw error;
    }

    const sentAt = new Date();
    const sendsStillInWindow = storedSendTimes.filter(
        sendTime => sendTime > new Date(sentAt.getTime() - SEND_WINDOW_MS)
    );
    const sendHistory = [...sendsStillInWindow, sentAt];
    const deliveredChallenge = {
        ...reservedChallenge,
        status: 'SENT',
        sentAt,
        windowStartedAt: sendsStillInWindow[0] || sentAt,
        sendsInWindow: sendHistory.length,
        sendHistory,
        expiresAt: new Date(sentAt.getTime() + expirySeconds * 1000),
        resendAfterAt: new Date(sentAt.getTime() + cooldownSeconds * 1000)
    };
    const completed = await prisma.emailOtpChallenge.updateMany({
        where: { id: challengeId, status: 'SENDING' },
        data: deliveredChallenge
    });
    if (completed.count !== 1) {
        throw new Error('Email OTP delivery state changed before successful delivery could be recorded');
    }
    return res.json({
        ...challengeResponse(email, deliveredChallenge, sentAt),
        message: 'A verification code has been sent to your registered email address.'
    });
}

async function sendEmailOtp(req, res) {
    return deliverCode(req, res, false);
}

async function resendEmailOtp(req, res) {
    return deliverCode(req, res, true);
}

async function verifyEmailOtp(req, res) {
    const challenge = await prisma.emailOtpChallenge.findUnique({ where: { userId: req.user.id } });
    const now = new Date();
    if (!challenge || challenge.email !== req.user.email) {
        return res.status(409).json({ error: { code: 'OTP_NOT_SENT', message: 'Request a verification code for your registered email first.' } });
    }
    if (challenge.status === 'VERIFIED' && challenge.verifiedAt) {
        return res.json({ ...challengeResponse(req.user.email, challenge), message: 'Your email address is verified.' });
    }
    if (challenge.verificationAttempts >= MAX_ATTEMPTS) {
        const retryAfter = Math.max(0, Math.ceil((challenge.resendAfterAt.getTime() - now.getTime()) / 1000));
        if (retryAfter > 0) res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
            error: { code: 'OTP_ATTEMPTS_EXCEEDED', message: retryAfter
                ? `Too many incorrect codes. Request a new code in ${retryAfter} seconds.`
                : 'Too many incorrect codes. Request a new code to continue.' },
            ...(retryAfter > 0 ? {
                retryAfterSeconds: retryAfter,
                retryAt: challenge.resendAfterAt.toISOString()
            } : {})
        });
    }
    if (challenge.status !== 'SENT' || !challenge.otpHash) {
        return res.status(409).json({ error: { code: 'OTP_NOT_ACTIVE', message: 'Request a new verification code before trying again.' } });
    }
    if (challenge.expiresAt <= now) {
        await prisma.emailOtpChallenge.updateMany({
            where: { id: challenge.id, status: 'SENT', expiresAt: { lte: now } },
            data: { status: 'EXPIRED', otpHash: null }
        });
        return res.status(410).json({ error: { code: 'OTP_EXPIRED', message: 'This verification code has expired. Request a new code.' } });
    }

    const submittedHash = hashOtp(req.user.id, req.user.email, req.body.otp);
    if (!hashesMatch(challenge.otpHash, submittedHash)) {
        const attempt = await prisma.emailOtpChallenge.updateMany({
            where: {
                id: challenge.id,
                status: 'SENT',
                otpHash: challenge.otpHash,
                verificationAttempts: { lt: MAX_ATTEMPTS },
                expiresAt: { gt: now }
            },
            data: { verificationAttempts: { increment: 1 } }
        });
        if (attempt.count !== 1) {
            return res.status(409).json({ error: { code: 'OTP_CHALLENGE_CHANGED', message: 'The verification code changed. Request the latest code and try again.' } });
        }
        const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - challenge.verificationAttempts - 1);
        const retryAfter = attemptsRemaining === 0 && challenge.resendAfterAt > now
            ? Math.ceil((challenge.resendAfterAt.getTime() - now.getTime()) / 1000)
            : 0;
        if (retryAfter > 0) res.set('Retry-After', String(retryAfter));
        return res.status(attemptsRemaining ? 400 : 429).json({
            error: {
                code: attemptsRemaining ? 'INVALID_OTP' : 'OTP_ATTEMPTS_EXCEEDED',
                message: attemptsRemaining
                    ? `The code is incorrect. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`
                    : retryAfter
                        ? `Too many incorrect codes. Request a new code in ${retryAfter} seconds.`
                        : 'Too many incorrect codes. Request a new code to continue.'
            },
            ...(retryAfter > 0 ? {
                retryAfterSeconds: retryAfter,
                retryAt: challenge.resendAfterAt.toISOString()
            } : {})
        });
    }

    const verifiedAt = new Date();
    const verified = await prisma.emailOtpChallenge.updateMany({
        where: {
            id: challenge.id,
            email: req.user.email,
            status: 'SENT',
            otpHash: challenge.otpHash,
            verificationAttempts: { lt: MAX_ATTEMPTS },
            expiresAt: { gt: verifiedAt }
        },
        data: { status: 'VERIFIED', otpHash: null, verifiedAt }
    });
    if (verified.count !== 1) {
        return res.status(409).json({ error: { code: 'OTP_CHALLENGE_CHANGED', message: 'The verification code is no longer active. Request a new code and try again.' } });
    }
    res.json({
        email: req.user.email,
        verified: true,
        verifiedAt,
        message: 'Your email address has been verified.'
    });
}

module.exports = { getEmailOtpStatus, sendEmailOtp, resendEmailOtp, verifyEmailOtp };
