const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { prisma } = require('../config/db');
const { sendVerificationEmail, sendRegistrationConfirmationEmail, sendLoginConfirmationEmail, sendPasswordResetEmail, sendPasswordChangedEmail } = require('../services/email.services');

const googleClient = new OAuth2Client();
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_REQUEST_LIMIT = 5;
const resetRequestAttempts = new Map();
const passwordResetSentMessage = 'Password reset link sent to your registered email.';
const passwordResetNotFoundMessage = 'No account found with this email address.';
const publicUserSelect = {
    id: true,
    name: true,
    email: true,
    status: true,
    createdAt: true,
    emailVerifiedAt: true,
    authVersion: true
};

function createToken(user) {
    return jwt.sign({ sub: user.id, authVersion: user.authVersion || 0 }, process.env.JWT_SECRET, { expiresIn: '3d' });
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
        emailVerifiedAt: user.emailVerifiedAt || null
    };
}

function createVerificationToken() {
    const token = crypto.randomBytes(32).toString('hex');
    return {
        token,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)
    };
}

function hashVerificationToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function registerUser(req, res) {
    const { name, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const verification = createVerificationToken();

    try {
        const user = await prisma.user.create({
            data: {
                name,
                email,
                passwordHash,
                emailVerificationTokenHash: verification.tokenHash,
                emailVerificationTokenExpiresAt: verification.expiresAt,
                emailVerificationSentAt: new Date()
            },
            select: publicUserSelect
        });

        try {
            await sendVerificationEmail(user.email, user.name, verification.token);
        } catch (error) {
            console.error(JSON.stringify({
                event: 'verification_email_failed',
                operation: 'registration',
                errorName: error instanceof Error ? error.name : 'UnknownError'
            }));
            return res.status(503).json({ error: { message: 'Your account was created, but we could not send the verification email. Please try again shortly.' } });
        }

        res.status(201).json({
            user: publicUser(user),
            verificationRequired: true,
            message: 'Check your email to verify your account before signing in.'
        });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: { message: 'Email is already registered' } });
        }
        throw error;
    }
}

async function loginUser(req, res) {
    const user = await prisma.user.findUnique({
        where: { email: req.body.email },
        select: { ...publicUserSelect, passwordHash: true }
    });

    if (!user || !user.passwordHash || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
        return res.status(401).json({ error: { message: 'Invalid email or password' } });
    }
    if (user.status !== 'ACTIVE') {
        return res.status(401).json({ error: { message: 'This account is not active' } });
    }
    if (!user.emailVerifiedAt) {
        return res.status(403).json({ error: { message: 'Please verify your email before signing in' } });
    }

    res.status(200).json({ user: publicUser(user), token: createToken(user) });
    void sendLoginConfirmationEmail({
        email: user.email,
        name: user.name,
        occurredAt: new Date()
    }).catch(error => console.error(JSON.stringify({
        event: 'login_confirmation_email_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError'
    })));
}

async function googleAuth(req, res) {
    const { credential } = req.body;
    if (typeof credential !== 'string' || credential.length < 20) {
        return res.status(400).json({ error: { message: 'A Google credential is required' } });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: { message: 'Google authentication is not configured' } });
    }

    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
    } catch (error) {
        console.error(JSON.stringify({
            event: 'google_token_verification_failed',
            errorName: error instanceof Error ? error.name : 'UnknownError'
        }));
        return res.status(401).json({ error: { message: 'Invalid Google credential' } });
    }

    const validIssuer = payload && ['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss);
    const validExpiry = payload && Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
    if (!payload || !payload.sub || !payload.email || payload.email_verified !== true || !validIssuer || !validExpiry) {
        return res.status(401).json({ error: { message: 'Invalid or unverified Google account' } });
    }

    const email = payload.email.toLowerCase();
    const existingGoogleUser = await prisma.user.findUnique({
        where: { googleSubject: payload.sub },
        select: publicUserSelect
    });
    if (existingGoogleUser) {
        if (existingGoogleUser.status !== 'ACTIVE') {
            return res.status(401).json({ error: { message: 'User is not active' } });
        }
        res.json({ user: publicUser(existingGoogleUser), token: createToken(existingGoogleUser) });
        void sendLoginConfirmationEmail({
            email: existingGoogleUser.email,
            name: existingGoogleUser.name,
            occurredAt: new Date()
        }).catch(error => console.error(JSON.stringify({
            event: 'login_confirmation_email_failed',
            provider: 'google',
            errorName: error instanceof Error ? error.name : 'UnknownError'
        })));
        return;
    }

    const existingEmailUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true }
    });
    if (existingEmailUser) {
        return res.status(409).json({
            error: { message: 'An account already exists for this email. Sign in with your password before linking Google.' }
        });
    }

    try {
        const user = await prisma.user.create({
            data: {
                email,
                name: (payload.name || payload.email.split('@')[0]).slice(0, 120),
                passwordHash: null,
                googleSubject: payload.sub,
                emailVerifiedAt: new Date()
            },
            select: publicUserSelect
        });
        res.status(201).json({ user: publicUser(user), token: createToken(user) });
        void sendRegistrationConfirmationEmail({
            email: user.email,
            name: user.name,
            occurredAt: new Date()
        }).catch(error => console.error(JSON.stringify({
            event: 'registration_confirmation_email_failed',
            provider: 'google',
            errorName: error instanceof Error ? error.name : 'UnknownError'
        })));
        return;
        } catch (error) {
        console.error('Google login Prisma error:', {
            code: error.code,
            message: error.message,
            meta: error.meta
        });

        if (error.code === 'P2002') {
            return res.status(409).json({
                error: {
                    message: 'This Google account is already registered'
                }
            });
        }

        throw error;
    }
}

async function verifyEmail(req, res) {
    const { token } = req.query;
    if (typeof token !== 'string' || token.length !== 64) {
        return res.status(400).json({ error: { message: 'This verification link is invalid or expired' } });
    }

    const tokenHash = hashVerificationToken(token);
    const verifiedUser = await prisma.user.findFirst({
        where: {
            emailVerificationTokenHash: tokenHash,
            emailVerificationTokenExpiresAt: { gt: new Date() },
            emailVerifiedAt: null
        },
        select: { id: true, email: true, name: true }
    });
    const result = await prisma.user.updateMany({
        where: {
            ...(verifiedUser ? { id: verifiedUser.id } : {}),
            emailVerificationTokenHash: tokenHash,
            emailVerificationTokenExpiresAt: { gt: new Date() },
            emailVerifiedAt: null
        },
        data: {
            emailVerifiedAt: new Date(),
            emailVerificationTokenHash: null,
            emailVerificationTokenExpiresAt: null,
            emailVerificationSentAt: null
        }
    });

    if (result.count !== 1) {
        return res.status(400).json({ error: { message: 'This verification link is invalid or expired' } });
    }

    void sendRegistrationConfirmationEmail({
        email: verifiedUser.email,
        name: verifiedUser.name,
        occurredAt: new Date()
    }).catch(error => console.error(JSON.stringify({
        event: 'registration_confirmation_email_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError'
    })));
    return res.json({ message: 'Email verified successfully. You can now sign in.' });
}

async function resendVerification(req, res) {
    const email = req.body.email;
    const user = await prisma.user.findUnique({
        where: { email },
        select: {
            id: true,
            email: true,
            name: true,
            emailVerifiedAt: true,
            googleSubject: true,
            emailVerificationSentAt: true
        }
    });
    if (!user || user.emailVerifiedAt || user.googleSubject) {
        return res.json({ message: 'If an eligible account exists, a verification email will be sent shortly.' });
    }

    if (user.emailVerificationSentAt && Date.now() - user.emailVerificationSentAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS) {
        return res.status(429).json({ error: { message: 'Please wait before requesting another verification email' } });
    }

    const verification = createVerificationToken();
    await prisma.user.update({
        where: { id: user.id },
        data: {
            emailVerificationTokenHash: verification.tokenHash,
            emailVerificationTokenExpiresAt: verification.expiresAt,
            emailVerificationSentAt: new Date()
        },
        select: { id: true }
    });

    try {
        await sendVerificationEmail(user.email, user.name, verification.token);
    } catch (error) {
        console.error(JSON.stringify({
            event: 'verification_email_failed',
            operation: 'resend',
            errorName: error instanceof Error ? error.name : 'UnknownError'
        }));
        return res.status(503).json({ error: { message: 'We could not send the verification email. Please try again shortly.' } });
    }

    return res.json({ message: 'A new verification email has been sent.' });
}

function logoutUser(req, res) {
    res.clearCookie('token');
    res.status(200).json({ message: 'Logged out successfully' });
}

async function forgotPassword(req, res, next) {
    const requestId = req.requestId || 'untracked';
    try {
        const { email } = req.body;
        if (!email || !email.trim()) {
            console.warn(JSON.stringify({ event: 'password_reset_request_rejected', requestId, stage: 'input_validation', reason: 'missing_email' }));
            return res.status(400).json({ error: { message: 'Email is required' } });
        }

        const now = Date.now();
        const requesterKey = req.ip || req.get?.('x-forwarded-for') || 'unknown';
        const attempts = (resetRequestAttempts.get(requesterKey) || []).filter(timestamp => now - timestamp < PASSWORD_RESET_REQUEST_WINDOW_MS);
        if (attempts.length >= PASSWORD_RESET_REQUEST_LIMIT) {
            console.warn(JSON.stringify({
                event: 'password_reset_request_rate_limited',
                requestId,
                stage: 'rate_limit',
                windowMs: PASSWORD_RESET_REQUEST_WINDOW_MS,
                limit: PASSWORD_RESET_REQUEST_LIMIT
            }));
            return res.status(429).json({ error: { message: 'Too many password reset requests. Please try again later.' } });
        }
        attempts.push(now);
        resetRequestAttempts.set(requesterKey, attempts);
        if (resetRequestAttempts.size > 10000) {
            for (const [key, timestamps] of resetRequestAttempts) {
                if (!timestamps.some(timestamp => now - timestamp < PASSWORD_RESET_REQUEST_WINDOW_MS)) {
                    resetRequestAttempts.delete(key);
                }
            }
        }

        const normalizedEmail = email.trim().toLowerCase();
        console.log(JSON.stringify({ event: 'password_reset_request_started', requestId, stage: 'database_lookup' }));
        const user = await prisma.user.findFirst({
            where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
            select: { id: true, email: true, name: true }
        });

        if (!user) {
            console.log(JSON.stringify({ event: 'password_reset_account_not_found', requestId, stage: 'database_lookup' }));
            // This response intentionally reveals account existence per the product requirement.
            return res.json({ accountFound: false, message: passwordResetNotFoundMessage });
        }

        const deletedTokens = await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
        console.log(JSON.stringify({
            event: 'password_reset_previous_tokens_invalidated',
            requestId,
            stage: 'database_cleanup',
            deletedCount: deletedTokens.count
        }));

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(now + PASSWORD_RESET_TOKEN_TTL_MS);

        await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt
            }
        });
        console.log(JSON.stringify({
            event: 'password_reset_token_stored',
            requestId,
            stage: 'database_create',
            tokenStorage: 'sha256_hash',
            tokenHashLength: tokenHash.length,
            expiresAt: expiresAt.toISOString(),
            ttlMs: expiresAt.getTime() - now
        }));

        try {
            console.log(JSON.stringify({
                event: 'password_reset_email_started',
                requestId,
                stage: 'email_service'
            }));
            await sendPasswordResetEmail({
                email: user.email,
                name: user.name,
                token,
                requestId,
                expiresAt
            });
            console.log(JSON.stringify({ event: 'password_reset_email_completed', requestId, stage: 'email_service' }));
        } catch (error) {
            await prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
            console.error(JSON.stringify({
                event: 'password_reset_email_failed',
                requestId,
                stage: 'email_service',
                errorName: error instanceof Error ? error.name : 'UnknownError'
            }));
        }

        console.log(JSON.stringify({ event: 'password_reset_request_completed', requestId, stage: 'response', statusCode: 200 }));
        return res.json({ accountFound: true, message: passwordResetSentMessage });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'password_reset_request_failed',
            requestId,
            stage: 'controller',
            errorName: error instanceof Error ? error.name : 'UnknownError',
            prismaCode: error?.code || null
        }));
        return next(error);
    }
}

async function findValidResetToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;
    const tokenHash = hashVerificationToken(token);
    return prisma.passwordResetToken.findFirst({
        where: {
            tokenHash,
            usedAt: null,
            expiresAt: { gt: new Date() }
        },
        select: { id: true }
    });
}

async function verifyResetToken(req, res, next) {
    try {
        const token = req.query.token;
        const resetToken = await findValidResetToken(token);
        if (!resetToken) {
            return res.status(400).json({ error: { message: 'This reset link is invalid or expired' } });
        }
        return res.json({ valid: true });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'password_reset_token_verification_failed',
            stage: 'controller',
            errorName: error instanceof Error ? error.name : 'UnknownError',
            prismaCode: error?.code || null
        }));
        return next(error);
    }
}

async function resetPassword(req, res, next) {
    try {
        const { token, newPassword, confirmPassword } = req.body;

    // Validate all input
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).json({ error: { message: 'This reset link is invalid or expired' } });
    }
    if (!newPassword || !confirmPassword) {
        return res.status(400).json({ error: { message: 'New password and confirmation are required' } });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: { message: 'Passwords do not match' } });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: { message: 'Password must be at least 6 characters long' } });
    }

    // Hash the received token to look up the record
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find the matching reset-token record — must exist, be unused, and not expired
    const resetToken = await prisma.passwordResetToken.findFirst({
        where: { tokenHash },
        include: { user: { select: { id: true, email: true, name: true } } }
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
        return res.status(400).json({ error: { message: 'This reset link is invalid or expired' } });
    }

    // Hash the new password using bcrypt
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Begin transactional database changes
    let resetCompleted = false;
    await prisma.$transaction(async (tx) => {
        // Update the user's password
        const claimed = await tx.passwordResetToken.updateMany({
            where: {
                tokenHash,
                usedAt: null,
                expiresAt: { gt: new Date() }
            },
            data: { usedAt: new Date() }
        });
        if (claimed.count !== 1) {
            return;
        }
        resetCompleted = true;
        await tx.user.update({
            where: { id: resetToken.userId },
            data: {
                passwordHash,
                authVersion: { increment: 1 }
            }
        });

        // Invalidate all other outstanding reset tokens for this user
        await tx.passwordResetToken.updateMany({
            where: {
                userId: resetToken.userId,
                tokenHash: { not: tokenHash },
                usedAt: null
            },
            data: { usedAt: new Date() }
        });
    });
    if (!resetCompleted) {
        return res.status(400).json({ error: { message: 'This reset link is invalid or expired' } });
    }

    // Send password-changed confirmation email
    try {
        await sendPasswordChangedEmail({
            email: resetToken.user.email,
            name: resetToken.user.name,
            occurredAt: new Date()
        });
    } catch (error) {
        console.error('[password-reset] confirmation email failed:', error instanceof Error ? error.message : 'UnknownError');
    }

        return res.json({ message: 'Your password has been reset successfully. You can now sign in with your new password.' });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'password_reset_completion_failed',
            stage: 'controller',
            errorName: error instanceof Error ? error.name : 'UnknownError',
            prismaCode: error?.code || null
        }));
        return next(error);
    }
}

module.exports = { registerUser, loginUser, googleAuth, verifyEmail, resendVerification, forgotPassword, verifyResetToken, resetPassword, logoutUser };
