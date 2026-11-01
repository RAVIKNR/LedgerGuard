const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const nodemailer = require('nodemailer');
const crypto = require("crypto");
const { renderLedgerGuardEmail, renderTransactionEmail, renderFailedTransactionEmail, renderSecurityNotificationEmail, renderAccountEventEmail } = require('./ledgerguard-email.template');
const { getFrontendUrl } = require('../config/frontend-url');

const smtpHost = process.env.EMAIL_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.EMAIL_PORT) || 465;
const smtpSecure = process.env.EMAIL_SECURE
  ? process.env.EMAIL_SECURE === 'true'
  : smtpPort === 465;
const smtpRequireTls = process.env.EMAIL_REQUIRE_TLS === 'true';

function smtpErrorDetails(error) {
  return {
    code: error?.code || null,
    command: error?.command || null,
    responseCode: error?.responseCode || null
  };
}

if (process.env.NODE_ENV !== 'test') {
  console.log(JSON.stringify({
    event: 'email_smtp_configuration',
    stage: 'transporter_initialization',
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: smtpRequireTls,
    credentialsPresent: {
      EMAIL_USER: Boolean(process.env.EMAIL_USER),
      CLIENT_ID: Boolean(process.env.CLIENT_ID),
      CLIENT_SECRET: Boolean(process.env.CLIENT_SECRET),
      REFRESH_TOKEN: Boolean(process.env.REFRESH_TOKEN),
    },
  }));
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  requireTLS: smtpRequireTls,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  auth: {
    type: 'OAuth2',
    user: process.env.EMAIL_USER,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken: process.env.REFRESH_TOKEN,
  },
});

if (process.env.NODE_ENV !== 'test' && process.env.EMAIL_USER) {
  transporter.verify((error) => {
    if (error) {
      console.error(JSON.stringify({
        event: 'email_smtp_verification_failed',
        stage: 'transporter.verify',
        ...smtpErrorDetails(error)
      }));
    } else {
      console.log(JSON.stringify({
        event: 'email_smtp_verified',
        stage: 'transporter.verify'
      }));
    }
  });
}

const sendEmail = async (to, subject, text, html, diagnostics = {}) => {
  const { event, requestId = 'untracked' } = diagnostics;
  const diagnosticFields = event
    ? { event, requestId, stage: 'transporter.sendMail' }
    : null;
  if (diagnosticFields) {
    console.log(JSON.stringify({
      ...diagnosticFields,
      event: `${event}_sendMail_started`,
      smtpHost,
      smtpPort,
      smtpSecure,
      requireTLS: smtpRequireTls
    }));
  }
  try {
    const result = await transporter.sendMail({
    from: `"LedgerGuard" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
    });
    if (diagnosticFields) {
      console.log(JSON.stringify({
        ...diagnosticFields,
        event: `${event}_sendMail_completed`,
        acceptedCount: Array.isArray(result.accepted) ? result.accepted.length : 0,
        rejectedCount: Array.isArray(result.rejected) ? result.rejected.length : 0,
        responseCode: result.responseCode || null
      }));
    }
    return result;
  } catch (error) {
    if (diagnosticFields) {
      console.error(JSON.stringify({
        ...diagnosticFields,
        event: `${event}_sendMail_failed`,
        ...smtpErrorDetails(error)
      }));
    }
    throw error;
  }
};

async function sendTransactionEmail({ email, name, type, amountMinor, currency, reference, occurredAt }) {
  const amount = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency.trim()
  }).format(Number(amountMinor) / 100);
  const message = renderTransactionEmail({
    recipientName: name,
    type,
    amount,
    currency: currency.trim(),
    reference,
    occurredAt
  });
  await sendEmail(email, `${amount} ${type === 'DEBIT' ? 'debited' : 'credited'} | LedgerGuard`, message.text, message.html);
}

async function sendFailedTransactionEmail({ email, name, amountMinor, currency, reason, sourceAccount, recipientAccount, reference, occurredAt }) {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency.trim() }).format(Number(amountMinor) / 100);
  const message = renderFailedTransactionEmail({ recipientName: name, amount, currency: currency.trim(), reason, sourceAccount, recipientAccount, reference, occurredAt });
  await sendEmail(email, message.subject, message.text, message.html);
}

async function sendSecurityNotificationEmail(notification) {
  const message = renderSecurityNotificationEmail({
    recipientName: notification.recipientName,
    eventType: notification.eventType,
    accountIdentifier: notification.accountId ? `acct-****-${notification.accountId.slice(-4)}` : null,
    previousStatus: notification.previousStatus,
    resultingStatus: notification.resultingStatus,
    reason: notification.reason,
    occurredAt: notification.occurredAt
  });
  await sendEmail(notification.recipientEmail, `${message.subject} | LedgerGuard`, message.text, message.html);
}

async function sendPasswordResetEmail({ email, name, token, requestId = 'untracked', expiresAt, occurredAt = new Date() }) {
  const resetUrl = new URL('/reset-password', getFrontendUrl());
  resetUrl.searchParams.set('token', token);
  console.log(JSON.stringify({
    event: 'password_reset_email_prepared',
    requestId,
    stage: 'email_template',
    frontendOrigin: resetUrl.origin,
    frontendPath: resetUrl.pathname,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
  }));
  const date = new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const message = renderLedgerGuardEmail({
    recipientName: name,
    title: 'Reset your LedgerGuard password',
    intro: 'A password reset was requested for your LedgerGuard account.',
    message: `Use the button below to set a new password. This request was made at ${date}. If you did not request a password reset, you can ignore this email and your password will remain unchanged.`,
    actionLabel: 'Reset password',
    actionUrl: resetUrl.toString(),
    expiry: '15 minutes'
  });
  return sendEmail(email, 'Reset your LedgerGuard password', message.text, message.html, {
    event: 'password_reset_email',
    requestId
  });
}

async function sendPasswordChangedEmail({ email, name, occurredAt = new Date() }) {
  const date = new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const message = renderLedgerGuardEmail({
    recipientName: name,
    title: 'Your LedgerGuard password has been changed',
    intro: 'Your LedgerGuard account password was successfully changed.',
    message: `The change took effect at ${date}. If you did not change your password, secure your account immediately and contact LedgerGuard support.`,
    actionLabel: 'Review security settings',
    actionUrl: `${getFrontendUrl()}/settings`,
    expiry: 'not applicable'
  });
  await sendEmail(email, 'Your LedgerGuard password has been changed', message.text, message.html);
}

async function sendRegistrationConfirmationEmail({ email, name, occurredAt = new Date() }) {
  const message = renderAccountEventEmail({
    recipientName: name,
    title: 'Your LedgerGuard registration is complete',
    intro: 'Your email has been verified and your LedgerGuard registration was successfully completed.',
    message: 'You can now sign in and continue to your secure financial workspace.',
    occurredAt,
    actionLabel: 'Continue to LedgerGuard',
    actionUrl: getFrontendUrl()
  });
  await sendEmail(email, 'Your LedgerGuard registration is complete', message.text, message.html);
}

async function sendLoginConfirmationEmail({ email, name, occurredAt = new Date() }) {
  const message = renderAccountEventEmail({
    recipientName: name,
    title: 'New LedgerGuard sign-in',
    intro: 'A successful sign-in to your LedgerGuard account was recorded.',
    message: 'If you do not recognize this activity, review your account security settings.',
    occurredAt,
    actionLabel: 'Review security settings',
    actionUrl: `${getFrontendUrl()}/settings`
  });
  await sendEmail(email, 'Successful LedgerGuard sign-in', message.text, message.html);
}

async function sendAccountCreatedEmail({ email, name, accountId, occurredAt = new Date() }) {
  const maskedAccount = accountId ? `...${String(accountId).slice(-4)}` : 'your INR account';
  const message = renderAccountEventEmail({
    recipientName: name,
    title: 'Your INR account is ready',
    intro: 'Your LedgerGuard INR financial account was successfully created.',
    message: `Account reference: ${maskedAccount}. Your balance and account activity are available in LedgerGuard.`,
    occurredAt,
    actionLabel: 'Open LedgerGuard',
    actionUrl: `${getFrontendUrl()}/accounts`
  });
  await sendEmail(email, 'Your LedgerGuard INR account is ready', message.text, message.html);
}

async function RegistrationEmail(useremail, name) {

  const logoUrl = "https://th.bing.com/th/id/OIP.fTPWjMsqkNzCWGdxTI8jkgHaHZ";

  const subject = "Welcome to HDFC Bank - Account Confirmation";

  const text = `Dear ${name}, your account has been successfully created.`;

  const html = `
<div style="margin:0; padding:0; background:#ffffff; font-family:Arial, sans-serif;">
  
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" style="border:1px solid #ccc; padding:20px;">

          <!-- Logo -->
          <tr>
            <td style="text-align:left;">
              <img src="${logoUrl}" width="140"/>
            </td>
          </tr>

          <!-- Date -->
          <tr>
            <td style="font-size:12px; color:#333; padding-top:10px;">
              Date: ${new Date().toLocaleDateString("en-IN")}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding-top:20px; font-size:14px; color:#000; line-height:1.6;">
              
              <p>Dear ${name},</p>

              <p>
                Welcome to HDFC Bank and thank you for choosing us.
              </p>

              <p>
                We are pleased to inform you that your account has been successfully created.
              </p>

              <p>
                You can now access your account and perform transactions securely.
              </p>

              <p>
                If you have any queries or require assistance, please contact our customer care.
              </p>

              <br/>

              <p>
                Warm Regards,<br/>
                <strong>HDFC Bank</strong>
              </p>

              <br/>

              <p style="font-size:12px; color:#555;">
                This is a system generated email and does not require any signature.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #ccc; padding-top:10px; font-size:11px; color:#666;">
              HDFC BANK LTD.<br/>
              Registered Office: India
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</div>
`;

  await sendEmail(useremail, subject, text, html);
}

async function loginDetected(useremail, name) {

  const logoUrl = "https://th.bing.com/th/id/OIP.fTPWjMsqkNzCWGdxTI8jkgHaHZ";

  const subject = "HDFC Bank: Login Activity Alert";

  const text = `Dear ${name}, a login to your account was detected. If not you, contact support immediately.`;

  const html = `
<div style="margin:0; padding:0; background:#ffffff; font-family:Arial, sans-serif;">
  
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" style="border:1px solid #ccc; padding:20px;">

          <!-- Logo -->
          <tr>
            <td style="text-align:left;">
              <img src="${logoUrl}" width="140"/>
            </td>
          </tr>

          <!-- Date -->
          <tr>
            <td style="font-size:12px; color:#333; padding-top:10px;">
              Date: ${new Date().toLocaleDateString("en-IN")}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding-top:20px; font-size:14px; color:#000; line-height:1.6;">
              
              <p>Dear ${name},</p>

              <p>
                We wish to inform you that a login to your account has been detected with the following details:
              </p>

              <p>
                <strong>Login Details:</strong><br/>
                Date & Time: ${new Date().toLocaleString("en-IN")}<br/>
                Location: India (Approximate)<br/>
                Device: Unknown Device
              </p>

              <p>
                If this activity has been performed by you, no further action is required.
              </p>

              <p>
                If you do not recognize this login, we request you to immediately change your password and contact our customer care.
              </p>

              <p style="color:#000; font-weight:bold;">
                Please do not share your login credentials or OTP with anyone.
              </p>

              <br/>

              <p>
                Warm Regards,<br/>
                <strong>HDFC Bank</strong>
              </p>

              <br/>

              <p style="font-size:12px; color:#555;">
                This is a system generated email and does not require any signature.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #ccc; padding-top:10px; font-size:11px; color:#666;">
              HDFC BANK LTD.<br/>
              Registered Office: India
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</div>
`;

  await sendEmail(useremail, subject, text, html);
}

async function accountCreated(useremail, name) {
  const subject = "Account Creation Confirmation";

  const html = `
<div style="font-family: Arial, sans-serif; background:#ffffff; padding:40px; color:#222;">
  
  <!-- Header -->
  <table width="100%" style="margin-bottom:30px;">
    <tr>
      <td align="left">
        <img src="https://tse3.mm.bing.net/th/id/OIP.PWa2XnI7eOhZREqGR9M2vQHaE8?w=768&h=512&rs=1&pid=ImgDetMain&o=7&rm=3"
             height="50"><br/>
        <span style="font-size:13px; color:#555;">We understand your world</span>
      </td>
      <td align="right" style="font-size:13px;">
        Date: ${new Date().toLocaleDateString("en-IN")}
      </td>
    </tr>
  </table>

  <!-- Greeting -->
  <p style="margin-bottom:25px;"><strong>Dear ${name},</strong></p>

  <!-- Subject -->
  <p style="margin-bottom:20px;">
    <strong>Sub: Account Creation Confirmation</strong>
  </p>

  <!-- Body -->
  <p style="margin-bottom:15px;">
    This is to inform you that your account has been successfully created with our bank.
  </p>

  <p style="margin-bottom:15px;">
    You are now authorized to access banking services and perform transactions securely.
  </p>

  <p style="margin-bottom:15px;">
    If you have not initiated this request, please contact us immediately.
  </p>

  <p style="margin-bottom:30px;">
    Thank you for your cooperation.
  </p>

  <!-- Signature -->
  <p>
    Yours sincerely,<br/><br/>
    <strong>Authorized Signatory</strong>
  </p>

  <br/><br/>

  <!-- Footer -->
  <hr style="margin:30px 0; border:0; border-top:1px solid #999;">

  <p style="font-size:12px; color:#444; text-align:center;">
    HDFC BANK LTD.<br/>
    Customer Support: support@hdfcbank.com | www.hdfcbank.com
  </p>

</div>
`;

  await sendEmail(useremail, subject, "", html);
}

async function debittransactionMail({
  email,
  name,
  amount,
  type, // "DEBIT" | "CREDIT"
  balance,
  toAccount
}) {

  const transactionId = "TXN" + Date.now();

  const date = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });

  const maskedAcc = "XXXX" + String(toAccount).slice(-4);

  const formattedAmount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(amount);

  const formattedBalance = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(balance);

  // ✅ Normalize type (important)
  const normalizedType = String(type).toUpperCase();

  // ✅ Correct color logic
  const color = normalizedType === "DEBIT" ? "#e53935" : "#2e7d32";

  const subject = `${formattedAmount} ${normalizedType} Alert | A/C ${maskedAcc}`;

  const text = `
Dear ${name},

We wish to inform you that a ${normalizedType} transaction has been processed on your account.

Transaction Details:
- Amount: ${formattedAmount}
- Transaction ID: ${transactionId}
- Date & Time: ${date}
- Account: ${maskedAcc}
- Available Balance: ${formattedBalance}

If you did not initiate this transaction, please contact our customer care immediately.

Warm regards,  
Your Bank
`;

  const html = `
<div style="margin:0; padding:0; background:#f4f6f9; font-family:Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
    <tr>
      <td align="center">

        <table width="600" style="background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 6px 18px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:#ffffff; padding:20px; text-align:center; border-bottom:3px solid #e53935;">
              
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/2/28/HDFC_Bank_Logo.svg" 
                alt="Bank Logo"
                style="height:50px; margin-bottom:10px;"
              />

              <p style="margin:0; color:#666; font-size:14px;">
                Secure Banking Notification
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:30px; color:#333;">

              <p style="font-size:15px;">Dear <b>${name}</b>,</p>

              <p style="font-size:15px;">
                A <b style="color:${color};">${normalizedType}</b> transaction has been successfully processed on your account.
              </p>

              <!-- AMOUNT -->
              <div style="text-align:center; margin:30px 0;">
                <span style="font-size:34px; font-weight:bold; color:${color};">
                  ${formattedAmount}
                </span>
              </div>

              <!-- DETAILS -->
              <table width="100%" cellpadding="12" cellspacing="0" style="background:#f9fafc; border-radius:8px; font-size:14px;">
                <tr>
                  <td><b>Transaction ID</b></td>
                  <td align="right">${transactionId}</td>
                </tr>
                <tr>
                  <td><b>Date & Time</b></td>
                  <td align="right">${date}</td>
                </tr>
                <tr>
                  <td><b>Account</b></td>
                  <td align="right">${maskedAcc}</td>
                </tr>
                <tr>
                  <td><b>Type</b></td>
                  <td align="right">${normalizedType}</td>
                </tr>
                <tr>
                  <td><b>Available Balance</b></td>
                  <td align="right">${formattedBalance}</td>
                </tr>
              </table>

              <!-- ALERT -->
              <p style="margin-top:25px; color:#e53935; font-weight:bold; font-size:14px;">
                If you did not authorize this transaction, please contact customer care immediately.
              </p>

              <p style="margin-top:30px; font-size:14px;">
                Regards,<br/>
                <b>Your Bank</b>
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f1f3f6; padding:15px; text-align:center; font-size:12px; color:#777;">
              This is an automated email. Please do not reply.<br/>
              © 2026 Your Bank. All rights reserved.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</div>
`;

  await sendEmail(email, subject, text, html);
}

async function creditTransactionMail({
  email,
  name,
  amount,
  balance,
  fromAccount
}) {

  const transactionId = "TXN" + Date.now();

  const date = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });

  const maskedAcc = "XXXX" + String(fromAccount).slice(-4);

  const formattedAmount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(amount);

  const formattedBalance = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(balance);

  const subject = `${formattedAmount} credited to A/c ${maskedAcc}`;

  const text = `
Dear ${name},

We wish to inform you that an amount of ${formattedAmount} has been credited to your account.

Transaction Details:
- Transaction ID: ${transactionId}
- Date & Time: ${date}
- Account: ${maskedAcc}
- Available Balance: ${formattedBalance}

If you were not expecting this credit, please verify with the sender.

Warm regards,  
Your Bank
`;

  const html = `
<div style="margin:0; padding:0; background:#f4f6f9; font-family:Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
    <tr>
      <td align="center">

        <table width="600" style="background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 6px 18px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:#ffffff; padding:20px; text-align:center; border-bottom:3px solid #2e7d32;">
              
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/2/28/HDFC_Bank_Logo.svg" 
                alt="Bank Logo"
                style="height:50px; margin-bottom:10px;"
              />

              <p style="margin:0; color:#666; font-size:14px;">
                Credit Transaction Alert
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:30px; color:#333;">

              <p style="font-size:15px;">Dear <b>${name}</b>,</p>

              <p style="font-size:15px;">
                An amount of <b style="color:#2e7d32;">${formattedAmount}</b> has been successfully credited to your account.
              </p>

              <!-- AMOUNT -->
              <div style="text-align:center; margin:30px 0;">
                <span style="font-size:34px; font-weight:bold; color:#2e7d32;">
                  ${formattedAmount}
                </span>
              </div>

              <!-- DETAILS -->
              <table width="100%" cellpadding="12" cellspacing="0" style="background:#f9fafc; border-radius:8px; font-size:14px;">
                <tr>
                  <td><b>Transaction ID</b></td>
                  <td align="right">${transactionId}</td>
                </tr>
                <tr>
                  <td><b>Date & Time</b></td>
                  <td align="right">${date}</td>
                </tr>
                <tr>
                  <td><b>Account</b></td>
                  <td align="right">${maskedAcc}</td>
                </tr>
                <tr>
                  <td><b>Transaction Type</b></td>
                  <td align="right">CREDIT</td>
                </tr>
                <tr>
                  <td><b>Available Balance</b></td>
                  <td align="right">${formattedBalance}</td>
                </tr>
              </table>

              <p style="margin-top:25px; font-size:14px;">
                Please retain this email for your records.
              </p>

              <p style="margin-top:30px; font-size:14px;">
                Regards,<br/>
                <b>Your Bank</b>
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f1f3f6; padding:15px; text-align:center; font-size:12px; color:#777;">
              This is an automated email. Please do not reply.<br/>
              © 2026 Your Bank. All rights reserved.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</div>
`;

  await sendEmail(email, subject, text, html);
}

async function initiatefunding(
  name,
  amount,
  toAccount,
  email,
  transactionId,
  balance
) {

  const date = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });

  const maskedAcc = "XXXX" + String(toAccount).slice(-4);

  const formattedAmount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(amount);

  const formattedBalance = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(balance);

  const subject = `${formattedAmount} credited to your A/c ${maskedAcc}`;

  const html = `
<div style="font-family: Arial, sans-serif; background:#ffffff; padding:40px; color:#222; line-height:1.7;">

  <!-- Header -->
  <table width="100%" style="margin-bottom:40px;">
    <tr>
      <td align="left">
        <img src="https://tse3.mm.bing.net/th/id/OIP.PWa2XnI7eOhZREqGR9M2vQHaE8?w=768&h=512&rs=1&pid=ImgDetMain&o=7&rm=3"
             height="50"><br/>
        <span style="font-size:13px; color:#555;">We understand your world</span>
      </td>
      <td align="right" style="font-size:13px;">
        Date: ${date}
      </td>
    </tr>
  </table>

  <!-- Greeting -->
  <p style="margin-bottom:25px;"><strong>Dear ${name},</strong></p>

  <!-- Subject -->
  <p style="margin-bottom:20px;">
    <strong>Sub: CREDIT OF FUNDS TO YOUR ACCOUNT</strong>
  </p>

  <!-- Body -->
  <p style="margin-bottom:15px;">
    This is to inform you that an amount of <strong>${formattedAmount}</strong> has been credited to your account bearing number <strong>${maskedAcc}</strong>.
  </p>

  <p style="margin-bottom:15px;">
    The transaction has been successfully processed and the details are provided below for your reference.
  </p>

  <!-- Table -->
  <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse:collapse; margin:20px 0;">
    <tr>
      <td style="border:1px solid #ccc;"><strong>Transaction ID</strong></td>
      <td style="border:1px solid #ccc;">${transactionId}</td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;"><strong>Date & Time</strong></td>
      <td style="border:1px solid #ccc;">${date}</td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;"><strong>Transaction Type</strong></td>
      <td style="border:1px solid #ccc;">CREDIT</td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;"><strong>Amount</strong></td>
      <td style="border:1px solid #ccc;">${formattedAmount}</td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;"><strong>Available Balance</strong></td>
      <td style="border:1px solid #ccc;">${formattedBalance}</td>
    </tr>
  </table>

  <p style="margin-bottom:15px;">
    Kindly verify the above details and retain this communication for your records.
  </p>

  <p style="margin-bottom:15px;">
    If you have not authorized this transaction, please contact the bank immediately.
  </p>

  <p style="margin-bottom:30px;">
    We appreciate your continued trust in our banking services.
  </p>

  <!-- Signature -->
  <p>
    Yours faithfully,<br/><br/>
    <strong>Authorized Signatory</strong><br/>
    (Operations Department)
  </p>

  <!-- Footer -->
  <hr style="margin:30px 0; border:0; border-top:1px solid #999;">

  <p style="font-size:12px; text-align:center; color:#555;">
    HDFC Bank Ltd.<br/>
    Customer Care: support@hdfcbank.com | www.hdfcbank.com
  </p>

</div>
`;

  await sendEmail(email, subject, "", html);
}




async function sendVerificationEmail(email, name, token) {
 const verificationUrl = new URL('/verify-email', getFrontendUrl());
 verificationUrl.searchParams.set('token', token);
 const subject = 'Verify your LedgerGuard email';
 const message = renderLedgerGuardEmail({
   recipientName: name,
   title: 'Verify your LedgerGuard email',
   intro: 'Confirm your email address to activate sign-in.',
   message: 'This one-time verification link is unique to your account.',
   actionLabel: 'Verify email address',
   actionUrl: verificationUrl.toString(),
   expiry: '24 hours'
 });

 if (process.env.RESEND_API_KEY) {
   const response = await fetch('https://api.resend.com/emails', {
     method: 'POST',
     headers: {
       Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({
       from: process.env.RESEND_FROM_EMAIL || 'LedgerGuard <onboarding@resend.dev>',
       to: [email],
       subject,
       text: message.text,
       html: message.html
     })
   });
   if (!response.ok) {
     console.error('[email] Resend verification email failed', { status: response.status });
     throw new Error('Resend rejected the verification email');
   }
   return;
 }

 if (!process.env.EMAIL_USER || !process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.REFRESH_TOKEN) {
   throw new Error('Email service is not configured');
 }

 try {
   await transporter.sendMail({
     from: `"LedgerGuard" <${process.env.EMAIL_USER}>`,
     to: email,
     subject,
    text: message.text,
    html: message.html
   });
 } catch (error) {
   console.error('[email] Verification email send failed', smtpErrorDetails(error));
   throw error;
 }
}

module.exports = {
  RegistrationEmail: (email, name) => sendRegistrationConfirmationEmail({ email, name }),
  loginDetected: (email, name) => sendLoginConfirmationEmail({ email, name }),
  debittransactionMail,
  creditTransactionMail,
  accountCreated: (email, name, accountId) => sendAccountCreatedEmail({ email, name, accountId }),
  initiatefunding,
  sendVerificationEmail,
  sendTransactionEmail,
  sendFailedTransactionEmail,
  sendSecurityNotificationEmail,
  sendRegistrationConfirmationEmail,
  sendLoginConfirmationEmail,
  sendAccountCreatedEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail
};