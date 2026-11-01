const express = require('express');
const { body, header } = require('express-validator');
const { transactionController, getTransferStatus } = require('../controllers/transaction.controller');
const { authenticate } = require('../middleware/account.middleware');
const validateRequest = require('../middleware/validation.middleware');

const router = express.Router();
const transferValidation = [
    body('receiverAccountId').optional().isString().trim().isLength({ min: 1, max: 64 }).withMessage('receiverAccountId must be a valid account number'),
    body('toAccount').optional().isString().trim().isLength({ min: 1, max: 64 }).withMessage('toAccount must be a valid account number'),
    body('amountMinor').optional().isInt({ min: 1 }).withMessage('amountMinor must be a positive integer'),
    body('amount').optional().isString().withMessage('amount must be a decimal INR amount'),
    body('currency').custom(value => String(value).trim().toUpperCase() === 'INR').withMessage('Only INR transfers are supported'),
    header('Idempotency-Key').isLength({ min: 1, max: 255 }).withMessage('Idempotency-Key is required')
];

router.get('/status', authenticate, [
    header('Idempotency-Key').isLength({ min: 1, max: 255 }).withMessage('Idempotency-Key is required')
], validateRequest, getTransferStatus);
router.post('/', authenticate, transferValidation, validateRequest, transactionController);
router.post('/transaction', authenticate, transferValidation, validateRequest, transactionController);

module.exports = router;
