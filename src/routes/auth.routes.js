const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const validateRequest = require('../middleware/validation.middleware');

const registrationValidation = [
    body('name').trim().notEmpty().isLength({ max: 120 }).withMessage('Name is required and must be 120 characters or fewer'),
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
];

const loginValidation = [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required')
];

const emailValidation = [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail()
];

const forgotPasswordValidation = [
    body('email')
        .trim()
        .toLowerCase()
        .isEmail().withMessage('A valid email is required')
];

const resetPasswordValidation = [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.newPassword) {
            throw new Error('Passwords do not match');
        }
        return true;
    })
];

router.post("/register", registrationValidation, validateRequest, authController.registerUser);
router.post("/login", loginValidation, validateRequest, authController.loginUser);
router.post("/google", authController.googleAuth);
router.get("/verify-email", authController.verifyEmail);
router.post("/resend-verification", emailValidation, validateRequest, authController.resendVerification);
router.post("/forgot-password", forgotPasswordValidation, validateRequest, authController.forgotPassword);
router.get("/reset-password/verify", authController.verifyResetToken);
router.post("/reset-password", resetPasswordValidation, validateRequest, authController.resetPassword);
router.post("/logout", authController.logoutUser);

module.exports = router;