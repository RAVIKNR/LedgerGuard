function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
}

function validateActionUrl(value) {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError('Email action links must use HTTP or HTTPS');
    }
    return url.toString();
}

function renderLedgerGuardEmail({
    recipientName,
    title,
    intro,
    message,
    actionLabel,
    actionUrl,
    verificationCode,
    expiry
}) {
    const safeName = escapeHtml(recipientName || 'there');
    const plainName = String(recipientName || 'there').replace(/[\r\n]+/g, ' ');
    const safeTitle = escapeHtml(title);
    const safeIntro = escapeHtml(intro);
    const safeMessage = escapeHtml(message);
    const safeExpiry = escapeHtml(expiry);
    const safeActionUrl = actionLabel && actionUrl
        ? escapeHtml(validateActionUrl(actionUrl))
        : '';
    const actionHtml = actionLabel && actionUrl
        ? `<tr><td align="center" style="padding:8px 32px 28px"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#3eb982" style="border-radius:8px"><a href="${safeActionUrl}" style="display:inline-block;padding:14px 24px;border:1px solid #5fd4a0;border-radius:8px;color:#07140d;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none">${escapeHtml(actionLabel)}</a></td></tr></table></td></tr>`
        : '';
    const codeHtml = verificationCode
        ? `<tr><td align="center" style="padding:8px 32px 22px"><div style="display:inline-block;padding:15px 25px;border:1px solid #365a46;border-radius:8px;background:#13221a;color:#c9f2da;font-family:Arial,sans-serif;font-size:28px;font-weight:bold;letter-spacing:8px">${escapeHtml(verificationCode)}</div></td></tr>`
        : '';
    const safetyText = 'LedgerGuard will never ask you to share your password or verification code. If you did not request this message, you can ignore it and secure your account if needed.';
    const text = [
        'LEDGERGUARD',
        title,
        '',
        `Hi ${plainName},`,
        intro,
        message,
        verificationCode ? `Your verification code: ${verificationCode}` : '',
        actionLabel && actionUrl ? `${actionLabel}: ${validateActionUrl(actionUrl)}` : '',
        `This ${verificationCode ? 'code' : 'link'} expires in ${expiry}.`,
        '',
        safetyText
    ].filter(Boolean).join('\n');

    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${safeTitle}</title></head>
<body style="margin:0;padding:0;background-color:#08100b;color:#1b2820;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${safeIntro}&#847; &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#08100b" style="width:100%;background:#08100b"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#101914" style="width:100%;max-width:600px;border:1px solid #294335;border-radius:14px;background:#101914">
<tr><td style="padding:25px 32px;border-bottom:1px solid #294335"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td width="38" valign="middle"><div style="width:32px;height:32px;border:1px solid #365a46;border-radius:9px;background:#1c4a37;color:#8ce8bc;font-size:17px;line-height:32px;text-align:center;font-weight:bold">L</div></td>
<td valign="middle" style="padding-left:10px;color:#f1f7f2;font-size:19px;font-weight:bold">ledger<span style="color:#55d6a0">guard</span></td>
<td align="right" valign="middle" style="color:#8ba396;font-size:11px;letter-spacing:1px;text-transform:uppercase">Secure account notice</td>
</tr></table></td></tr>
<tr><td style="padding:30px 32px 12px">
<p style="margin:0 0 8px;color:#63dbaa;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Account security</p>
<h1 style="margin:0 0 18px;color:#edf6ef;font-size:25px;line-height:1.25">${safeTitle}</h1>
<p style="margin:0 0 14px;color:#d8e5dc;font-size:15px;line-height:1.65">Hi ${safeName},</p>
<p style="margin:0 0 12px;color:#c0cec4;font-size:15px;line-height:1.65">${safeIntro}</p>
<p style="margin:0 0 14px;color:#9eafa3;font-size:14px;line-height:1.65">${safeMessage}</p>
</td></tr>${codeHtml}${actionHtml}
<tr><td style="padding:0 32px 24px"><p style="margin:0 0 10px;color:#b6c7bc;font-size:13px;line-height:1.6">This ${verificationCode ? 'code' : 'link'} expires in <strong style="color:#e4efe7">${safeExpiry}</strong>${verificationCode ? '' : ' and can only be used once'}.</p>
<p style="margin:0;color:#81958a;font-size:12px;line-height:1.6">${escapeHtml(safetyText)}</p></td></tr>
<tr><td style="padding:17px 32px;border-top:1px solid #294335;color:#75877c;font-size:11px;line-height:1.6">LedgerGuard · Secure, accountable financial operations<br>This is an automated message. For your security, never forward codes or verification links.</td></tr>
</table><p style="margin:16px 0 0;color:#718278;font-size:10px;line-height:1.5;text-align:center">If the button does not work, copy and paste the verification link from this message into your browser.</p>
</td></tr></table></body></html>`;

    return { html, text };
}

function renderTransactionEmail({
    recipientName,
    type,
    amount,
    currency,
    reference,
    occurredAt
}) {
    const safeName = escapeHtml(recipientName || 'there');
    const safeType = escapeHtml(type);
    const safeAmount = escapeHtml(amount);
    const safeCurrency = escapeHtml(currency);
    const safeReference = escapeHtml(reference || 'Unavailable');
    const safeDate = escapeHtml(new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    const isDebit = type === 'DEBIT';
    const accent = isDebit ? '#ef7f78' : '#63dbaa';
    const accentBackground = isDebit ? '#4a211f' : '#183c2a';
    const directionLabel = isDebit ? 'DEBIT' : 'CREDIT';
    const title = `${isDebit ? 'Debit' : 'Credit'} transaction confirmed`;
    const intro = type === 'DEBIT'
        ? `A debit of ${amount} ${currency} was successfully committed from your LedgerGuard account.`
        : `A credit of ${amount} ${currency} was successfully committed to your LedgerGuard account.`;
    const text = [
        'LEDGERGUARD',
        title,
        '',
        `Hi ${String(recipientName || 'there').replace(/[\r\n]+/g, ' ')},`,
        intro,
        '',
        `Status: COMPLETED`,
        `Amount: ${amount} ${currency}`,
        `Reference: ${reference || 'Unavailable'}`,
        `Date and time: ${new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
        '',
        'This is an automated LedgerGuard notification. LedgerGuard will never ask for your password, OTP, or access token.'
    ].join('\n');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#08100b;color:#d8e5dc;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 14px;background:#08100b"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#101914;border:1px solid #294335;border-radius:14px"><tr><td style="padding:25px 32px;border-bottom:1px solid #294335;color:#f1f7f2;font-size:19px;font-weight:bold">ledger<span style="color:#55d6a0">guard</span></td></tr><tr><td style="padding:30px 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px"><tr><td width="58" height="58" align="center" valign="middle" bgcolor="${accentBackground}" style="width:58px;height:58px;border:1px solid ${accent};border-radius:14px;color:${accent};font-size:30px;font-weight:bold;line-height:58px" aria-label="${directionLabel} transaction illustration">${isDebit ? '&minus;' : '+'}</td><td style="padding-left:14px;color:${accent};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">${directionLabel} · COMPLETED<br><span style="display:inline-block;margin-top:6px;color:#91a69a;font-size:11px;font-weight:normal;letter-spacing:0;text-transform:none">LedgerGuard transaction artwork</span></td></tr></table><p style="margin:0 0 8px;color:${accent};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Transaction notice</p><h1 style="margin:0 0 18px;color:#edf6ef;font-size:25px">${escapeHtml(title)}</h1><p style="color:#d8e5dc;font-size:15px;line-height:1.65">Hi ${safeName},</p><p style="color:#c0cec4;font-size:15px;line-height:1.65">${escapeHtml(intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="10" style="margin-top:22px;border:1px solid #294335;border-radius:9px;color:#c0cec4;font-size:14px"><tr><td>Amount</td><td align="right" style="color:${accent};font-weight:bold">${safeAmount} ${safeCurrency}</td></tr><tr><td>Status</td><td align="right" style="color:${accent};font-weight:bold">COMPLETED</td></tr><tr><td>Reference</td><td align="right">${safeReference}</td></tr><tr><td>Date and time</td><td align="right">${safeDate}</td></tr><tr><td>Type</td><td align="right">${safeType}</td></tr></table></td></tr><tr><td style="padding:17px 32px;border-top:1px solid #294335;color:#75877c;font-size:11px;line-height:1.6">LedgerGuard · Secure, accountable financial operations<br>This is an automated message. Never share passwords, OTPs, access tokens, or refresh tokens.</td></tr></table></td></tr></table></body></html>`;
    return { html, text };
}

function renderFailedTransactionEmail({ recipientName, amount, currency, reason, sourceAccount, recipientAccount, reference, occurredAt }) {
    const safeName = escapeHtml(recipientName || 'there');
    const safeAmount = escapeHtml(amount);
    const safeCurrency = escapeHtml(currency);
    const safeReason = escapeHtml(reason);
    const safeSource = escapeHtml(sourceAccount || 'Unavailable');
    const safeRecipient = escapeHtml(recipientAccount || 'Unavailable');
    const safeReference = escapeHtml(reference || 'Unavailable');
    const safeDate = escapeHtml(new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    const subject = reason === 'Insufficient Funds'
        ? 'LedgerGuard: Transfer Failed — Insufficient Funds'
        : 'LedgerGuard: Transfer Failed';
    const text = [
        'LEDGERGUARD',
        subject,
        '',
        `Hi ${String(recipientName || 'there').replace(/[\r\n]+/g, ' ')},`,
        'Your transfer failed and no money was moved.',
        '',
        `Amount: ${amount} ${currency}`,
        `Source account: ${sourceAccount || 'Unavailable'}`,
        `Recipient account: ${recipientAccount || 'Unavailable'}`,
        `Reason: ${reason}`,
        `Reference: ${reference || 'Unavailable'}`,
        `Date and time: ${new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
        '',
        'This is an automated LedgerGuard notification. LedgerGuard will never ask for your password, OTP, or access token.'
    ].join('\n');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#08100b;color:#d8e5dc;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 14px;background:#08100b"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#101914;border:1px solid #70443d;border-radius:14px"><tr><td style="padding:25px 32px;border-bottom:1px solid #70443d;color:#f1f7f2;font-size:19px;font-weight:bold">ledger<span style="color:#55d6a0">guard</span></td></tr><tr><td style="padding:30px 32px"><p style="color:#ef9a8f;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Transfer status</p><h1 style="color:#edf6ef;font-size:25px">${escapeHtml(subject)}</h1><p style="color:#d8e5dc;font-size:15px;line-height:1.6">Hi ${safeName},</p><p style="color:#c0cec4;font-size:15px;line-height:1.6">Your transfer failed and no money was moved.</p><p style="line-height:1.8"><strong>Amount:</strong> ${safeAmount} ${safeCurrency}<br><strong>Source account:</strong> ${safeSource}<br><strong>Recipient account:</strong> ${safeRecipient}<br><strong>Reason:</strong> ${safeReason}<br><strong>Reference:</strong> ${safeReference}<br><strong>Date and time:</strong> ${safeDate}</p></td></tr><tr><td style="padding:17px 32px;border-top:1px solid #294335;color:#75877c;font-size:11px">LedgerGuard · Automated transfer notification</td></tr></table></td></tr></table></body></html>`;
    return { subject, text, html };
}

function renderSecurityNotificationEmail({
    recipientName,
    eventType,
    accountIdentifier,
    previousStatus,
    resultingStatus,
    reason,
    occurredAt
}) {
    const restored = eventType === 'ACCOUNT_UNFROZEN' || eventType === 'USER_REACTIVATED';
    const frequencyAlert = eventType === 'FREQUENCY_ALERT';
    const subject = frequencyAlert
        ? 'Unusually frequent transaction activity detected'
        : eventType === 'ACCOUNT_FROZEN'
        ? 'Your account has been frozen'
        : eventType === 'USER_SUSPENDED'
            ? 'Your LedgerGuard access has been suspended'
            : 'Your LedgerGuard access has been restored';
    const safeName = escapeHtml(recipientName || 'there');
    const safeAccount = escapeHtml(accountIdentifier || 'Unavailable');
    const safePrevious = escapeHtml(previousStatus);
    const safeResulting = escapeHtml(resultingStatus);
    const safeReason = reason ? escapeHtml(reason) : '';
    const date = new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const safeDate = escapeHtml(date);
    const impact = frequencyAlert
        ? 'Ten successful outgoing transactions were detected within the last 24 hours. Please confirm that you recognize and authorized this activity. If you do not recognize it, contact the administration team immediately.'
        : eventType === 'ACCOUNT_FROZEN'
        ? 'Some operations on this account may be restricted while it is frozen.'
        : eventType === 'USER_SUSPENDED'
            ? 'Sign-in and account operations are restricted while your access is suspended.'
            : 'The restriction described in this notice has been removed. Normal access is subject to your current account status.';
    const text = [
        'LEDGERGUARD',
        subject,
        '',
        `Hi ${String(recipientName || 'there').replace(/[\r\n]+/g, ' ')},`,
        `Previous status: ${previousStatus}`,
        `Resulting status: ${resultingStatus}`,
        accountIdentifier ? `Account: ${accountIdentifier}` : '',
        `Effective: ${date}`,
        reason ? `Reason: ${String(reason).replace(/[\r\n]+/g, ' ')}` : '',
        impact,
        '',
        'This is an automated LedgerGuard security notification.'
    ].filter(Boolean).join('\n');
    const reasonHtml = safeReason ? `<p><strong>Reason:</strong> ${safeReason}</p>` : '';
    const accountHtml = accountIdentifier ? `<p><strong>Account:</strong> ${safeAccount}</p>` : '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#08100b;color:#d8e5dc;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 14px;background:#08100b"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#101914;border:1px solid ${frequencyAlert ? '#70443d' : '#294335'};border-radius:14px"><tr><td style="padding:25px 32px;border-bottom:1px solid ${frequencyAlert ? '#70443d' : '#294335'};color:#f1f7f2;font-size:19px;font-weight:bold">ledger<span style="color:#55d6a0">guard</span></td></tr><tr><td style="padding:30px 32px"><p style="color:${frequencyAlert ? '#ef9a8f' : '#63dbaa'};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Account security</p><h1 style="color:#edf6ef;font-size:25px">${escapeHtml(subject)}</h1><p style="color:#d8e5dc;font-size:15px;line-height:1.6">Hi ${safeName},</p>${accountHtml}<p><strong>Status:</strong> ${safePrevious} &rarr; ${safeResulting}<br><strong>Effective:</strong> ${safeDate}</p>${reasonHtml}<p style="line-height:1.6">${escapeHtml(impact)}</p></td></tr><tr><td style="padding:17px 32px;border-top:1px solid #294335;color:#75877c;font-size:11px">LedgerGuard · Automated security notification</td></tr></table></td></tr></table></body></html>`;
    return { html, text, subject, restored };
}

function emailShell({ title, eyebrow, recipientName, accent, content, textContent }) {
    const safeName = escapeHtml(recipientName || 'there');
    const safeTitle = escapeHtml(title);
    const safeEyebrow = escapeHtml(eyebrow);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${safeTitle}</title><style>@media screen and (max-width:620px){.lg-wrap{padding:16px 8px!important}.lg-card{border-radius:10px!important}.lg-pad{padding-left:20px!important;padding-right:20px!important}.lg-amount{font-size:30px!important}.lg-stack{display:block!important;width:100%!important}.lg-stack td{display:block!important;width:100%!important;margin-bottom:8px!important}}</style></head><body style="margin:0;padding:0;background:#07100b;color:#d9e7dd;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#07100b"><tr><td class="lg-wrap" align="center" style="padding:30px 12px"><table class="lg-card" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#101914" style="width:100%;max-width:600px;background:#101914;border:1px solid #294335;border-radius:16px;overflow:hidden"><tr><td class="lg-pad" style="padding:22px 30px;border-bottom:1px solid #294335"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="38"><div style="width:32px;height:32px;border:1px solid #47705a;border-radius:9px;background:#183c2a;color:#8ce8bc;font-size:17px;line-height:32px;text-align:center;font-weight:bold">L</div></td><td style="padding-left:10px;color:#f1f7f2;font-size:19px;font-weight:bold">ledger<span style="color:#55d6a0">guard</span></td><td align="right" style="color:${accent};font-size:10px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase">Security notice</td></tr></table></td></tr><tr><td class="lg-pad" style="padding:28px 30px 30px"><p style="margin:0 0 8px;color:${accent};font-size:10px;font-weight:bold;letter-spacing:1.6px;text-transform:uppercase">${safeEyebrow}</p><h1 style="margin:0 0 12px;color:#f0f7f2;font-size:26px;line-height:1.2">${safeTitle}</h1><p style="margin:0 0 20px;color:#b9cbbf;font-size:14px;line-height:1.6">Hi ${safeName},</p>${content}</td></tr><tr><td class="lg-pad" style="padding:17px 30px;border-top:1px solid #294335;color:#82968a;font-size:11px;line-height:1.6">LedgerGuard · Secure, accountable financial operations<br>This is an automated security notification. LedgerGuard will never ask for your password, PIN, OTP, or verification code.</td></tr></table></td></tr></table></body></html>`;
    const text = ['LEDGERGUARD', title, '', `Hi ${String(recipientName || 'there').replace(/[\r\n]+/g, ' ')},`, textContent, '', 'This is an automated LedgerGuard security notification. LedgerGuard will never ask for your password, PIN, OTP, or verification code.'].join('\n');
    return { html, text };
}

function renderHighAmountSecurityEmail({
    recipientName,
    amount,
    currency,
    recipientAccount,
    occurredAt,
    reference,
    reasons,
    reviewDeadlineAt,
    supportContact
}) {
    const safeAmount = escapeHtml(amount);
    const safeCurrency = escapeHtml(currency);
    const safeRecipient = escapeHtml(recipientAccount || 'Unavailable');
    const safeReference = escapeHtml(reference || 'Unavailable');
    const safeReasons = escapeHtml(reasons || 'Unusual transaction activity');
    const safeDate = escapeHtml(new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    const safeDeadline = escapeHtml(new Date(reviewDeadlineAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    const safeSupport = escapeHtml(supportContact || 'your LedgerGuard administrator');
    const content = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:18px 14px 22px;background:#281715;border:1px solid #70443d;border-radius:12px"><p style="margin:0 0 7px;color:#ef9a8f;font-size:10px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase">Unusual amount detected</p><p class="lg-amount" style="margin:0;color:#fff4f1;font-size:38px;line-height:1.1;font-weight:bold">${safeAmount} <span style="font-size:17px;color:#efb0a7">${safeCurrency}</span></p></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;border:1px solid #294335;border-radius:10px"><tr><td class="lg-pad" style="padding:16px 18px"><p style="margin:0 0 12px;color:#edf6ef;font-size:13px;font-weight:bold">Transaction details</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:12px;line-height:1.5"><tr><td style="padding:6px 0;color:#84988b">Recipient</td><td align="right" style="padding:6px 0;color:#e5efe8;font-weight:bold">${safeRecipient}</td></tr><tr><td style="padding:6px 0;color:#84988b">Date and time</td><td align="right" style="padding:6px 0;color:#e5efe8">${safeDate}</td></tr><tr><td style="padding:6px 0;color:#84988b">Reference</td><td align="right" style="padding:6px 0;color:#e5efe8;word-break:break-all">${safeReference}</td></tr><tr><td style="padding:6px 0;color:#84988b">Flagged because</td><td align="right" style="padding:6px 0;color:#efb0a7">${safeReasons}</td></tr></table></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;background:#15291e;border-left:3px solid #55d6a0;border-radius:8px"><tr><td style="padding:14px 16px;color:#d5e5da;font-size:13px;line-height:1.6">This transaction is temporarily on hold and requires administrator approval.</td></tr></table><p style="margin:22px 0 10px;color:#f0f7f2;font-size:15px;font-weight:bold">What should you do now?</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:10px 12px;background:#151f19;border:1px solid #294335;border-radius:8px;color:#c9d9cf;font-size:12px;line-height:1.5">1&nbsp;&nbsp;Review whether you recognize this transaction.</td></tr><tr><td style="padding:10px 12px;background:#151f19;border:1px solid #294335;border-radius:8px;color:#c9d9cf;font-size:12px;line-height:1.5">2&nbsp;&nbsp;If you did not authorize it, contact ${safeSupport} immediately.</td></tr><tr><td style="padding:10px 12px;background:#151f19;border:1px solid #294335;border-radius:8px;color:#c9d9cf;font-size:12px;line-height:1.5">3&nbsp;&nbsp;The transaction is scheduled for automatic approval after 24 hours, consistent with LedgerGuard business rules.</td></tr></table><p style="margin:18px 0 0;color:#84988b;font-size:11px;line-height:1.5">Review deadline: <strong style="color:#dce9e0">${safeDeadline}</strong></p>`;
    const textContent = [`Security alert: unusual transaction amount`, `Amount: ${amount} ${currency}`, `Recipient: ${recipientAccount || 'Unavailable'}`, `Date and time: ${new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, `Reference: ${reference || 'Unavailable'}`, `Flagged because: ${reasons || 'Unusual transaction activity'}`, '', 'This transaction is temporarily on hold and requires administrator approval.', '', 'What should you do now?', '1. Review whether you recognize this transaction.', `2. If you did not authorize it, contact ${supportContact || 'your LedgerGuard administrator'} immediately.`, '3. The transaction is scheduled for automatic approval after 24 hours.', `Review deadline: ${new Date(reviewDeadlineAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`].join('\n');
    return emailShell({ title: 'Transaction requires your attention', eyebrow: 'High-amount security alert', recipientName, accent: '#ef9a8f', content, textContent });
}

function renderFrequencySecurityEmail({ recipientName, accountIdentifier, occurredAt }) {
    const safeAccount = escapeHtml(accountIdentifier || 'Your account');
    const safeDate = escapeHtml(new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    const steps = Array.from({ length: 10 }, (_, index) => `<td style="width:10%;padding-right:${index === 9 ? 0 : 4}px"><div style="height:10px;background:${index === 9 ? '#ef9a8f' : '#55d6a0'};border-radius:5px;font-size:0">&nbsp;</div></td>`).join('');
    const content = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:20px 14px;background:#15291e;border:1px solid #3c6b50;border-radius:12px"><p style="margin:0 0 8px;color:#9be0b8;font-size:10px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase">Rolling 24-hour monitor</p><p style="margin:0;color:#f0f7f2;font-size:27px;line-height:1.2;font-weight:bold">10 successful</p><p style="margin:4px 0 0;color:#b9d1c0;font-size:14px">outgoing transactions</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px"><tr>${steps}</tr></table><p style="margin:10px 0 0;color:#efb0a7;font-size:11px;font-weight:bold">Security attention recommended</p></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;border:1px solid #294335;border-radius:10px"><tr><td class="lg-pad" style="padding:16px 18px"><p style="margin:0 0 12px;color:#edf6ef;font-size:13px;font-weight:bold">Activity overview</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:12px;line-height:1.5"><tr><td style="padding:6px 0;color:#84988b">Account</td><td align="right" style="padding:6px 0;color:#e5efe8">${safeAccount}</td></tr><tr><td style="padding:6px 0;color:#84988b">Monitoring window</td><td align="right" style="padding:6px 0;color:#e5efe8">Last 24 hours</td></tr><tr><td style="padding:6px 0;color:#84988b">Security status</td><td align="right" style="padding:6px 0;color:#efb0a7;font-weight:bold">Review activity</td></tr><tr><td style="padding:6px 0;color:#84988b">Detected at</td><td align="right" style="padding:6px 0;color:#e5efe8">${safeDate}</td></tr></table></td></tr></table><p style="margin:22px 0 10px;color:#f0f7f2;font-size:15px;font-weight:bold">What should you do now?</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:10px 12px;background:#151f19;border:1px solid #294335;border-radius:8px;color:#c9d9cf;font-size:12px;line-height:1.5">1&nbsp;&nbsp;Review your recent outgoing transactions.</td></tr><tr><td style="padding:10px 12px;background:#151f19;border:1px solid #294335;border-radius:8px;color:#c9d9cf;font-size:12px;line-height:1.5">2&nbsp;&nbsp;Confirm that you recognize and authorized the activity.</td></tr><tr><td style="padding:10px 12px;background:#151f19;border:1px solid #294335;border-radius:8px;color:#c9d9cf;font-size:12px;line-height:1.5">3&nbsp;&nbsp;Contact the administrator immediately if you notice unfamiliar activity.</td></tr></table><p style="margin:18px 0 0;color:#84988b;font-size:11px;line-height:1.5">Transactions remain available subject to existing security checks. This alert does not block your account.</p>`;
    const textContent = ['Unusually high transaction activity', '10 successful outgoing transactions', 'Monitoring window: Last 24 hours', `Account: ${accountIdentifier || 'Your account'}`, `Detected at: ${new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, '', 'What should you do now?', '1. Review your recent outgoing transactions.', '2. Confirm that you recognize and authorized the activity.', '3. Contact the administrator immediately if you notice unfamiliar activity.', '', 'Transactions remain available subject to existing security checks. This alert does not block your account.'].join('\n');
    return emailShell({ title: 'Unusually high transaction activity', eyebrow: 'Activity monitoring alert', recipientName, accent: '#efb05f', content, textContent });
}

function renderAccountEventEmail({ recipientName, title, intro, message, occurredAt, actionLabel, actionUrl }) {
    const date = new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const safeDate = escapeHtml(date);
    const rendered = renderLedgerGuardEmail({
        recipientName,
        title,
        intro,
        message: `${message} Event time: ${date}.`,
        actionLabel,
        actionUrl,
        expiry: 'not applicable'
    });
    return {
        ...rendered,
        html: rendered.html.replace(
            '<p style="margin:0 0 10px;color:#b6c7bc;font-size:13px;line-height:1.6">This link expires in <strong style="color:#e4efe7">not applicable</strong> and can only be used once.</p>',
            `<p style="margin:0 0 10px;color:#b6c7bc;font-size:13px;line-height:1.6">Event time: <strong style="color:#e4efe7">${safeDate}</strong></p>`
        ),
        text: rendered.text.replace('This link expires in not applicable.', `Event time: ${date}.`)
    };
}

module.exports = { escapeHtml, renderLedgerGuardEmail, renderTransactionEmail, renderFailedTransactionEmail, renderSecurityNotificationEmail, renderHighAmountSecurityEmail, renderFrequencySecurityEmail, renderAccountEventEmail };
