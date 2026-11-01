const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/user.controller');
const emailVerificationController = require('../controllers/email-verification.controller');
const { authenticate } = require('../middleware/account.middleware');
const validateRequest = require('../middleware/validation.middleware');

const router = express.Router();
function normalizePhone(value) {
    const compact = String(value).trim().replace(/[\s().-]/g, '');
    return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

router.get('/me', authenticate, userController.getCurrentUser);
router.get('/me/email-otp/status', authenticate, emailVerificationController.getEmailOtpStatus);
router.post('/me/email-otp/send', authenticate, emailVerificationController.sendEmailOtp);
router.post('/me/email-otp/resend', authenticate, emailVerificationController.resendEmailOtp);
router.post('/me/email-otp/verify', authenticate, [
    body('otp').isString().matches(/^\d{6}$/).withMessage('Enter the six-digit code sent to your email')
], validateRequest, emailVerificationController.verifyEmailOtp);
router.patch('/me', authenticate, [
    body('name').trim().notEmpty().isLength({ max: 120 }).withMessage('Full name is required and must be 120 characters or fewer'),
    body('phone').customSanitizer(normalizePhone).matches(/^\+[1-9]\d{7,14}$/).withMessage('Phone number is required and must include a valid country code, for example +14155552671'),
    body('addressLine').trim().notEmpty().isLength({ max: 240 }).withMessage('Address is required and must be 240 characters or fewer'),
    body('city').trim().notEmpty().isLength({ max: 100 }).withMessage('City is required and must be 100 characters or fewer'),
    body('region').trim().notEmpty().isLength({ max: 100 }).withMessage('State or province is required and must be 100 characters or fewer'),
    body('postalCode').trim().matches(/^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/).withMessage('Enter a valid postal or ZIP code'),
    body('country').trim().isAlpha().isLength({ min: 2, max: 2 }).toUpperCase().withMessage('Country must be a two-letter country code')
], validateRequest, userController.updateCurrentUserProfile);

module.exports = router;
