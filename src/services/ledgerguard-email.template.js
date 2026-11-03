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

module.exports = { escapeHtml, renderLedgerGuardEmail, renderTransactionEmail, renderFailedTransactionEmail, renderSecurityNotificationEmail, renderAccountEventEmail };
