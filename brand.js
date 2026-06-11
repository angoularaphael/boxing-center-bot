/**
 * Identité visuelle Boxing Center — signature emails & WhatsApp.
 */

const BOXING_CENTER_SITE = (
    process.env.BOXING_CENTER_SITE_URL || 'https://boxingcenter.fr/'
).replace(/\/?$/, '/');

const BOXING_CENTER_CONTACT_EMAIL = (
    process.env.BOXING_CENTER_CONTACT_EMAIL ||
    process.env.BREVO_SENDER_EMAIL ||
    'boxingcenter31@gmail.com'
).trim();

const BOT_PUBLIC_URL = (
    process.env.BOT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_WHATSAPP_BOT_URL ||
    'http://us2.bot-hosting.net:20042'
).replace(/\/$/, '');

const BOXING_CENTER_LOGO_URL =
    process.env.BOXING_CENTER_LOGO_URL || `${BOT_PUBLIC_URL}/assets/logo.png`;

const WA_CAPTION_MAX = 1024;

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function siteHost() {
    try {
        return new URL(BOXING_CENTER_SITE).host;
    } catch {
        return 'boxingcenter.fr';
    }
}

function buildWhatsAppSignature() {
    return [
        '',
        '────────────────',
        '🥊 *Boxing Center*',
        `🌐 ${siteHost()}`,
        `✉️ ${BOXING_CENTER_CONTACT_EMAIL}`,
        '',
        '_Répondez à Boxing Center pour toute question._',
    ].join('\n');
}

function appendWhatsAppSignature(message) {
    const body = String(message || '').trimEnd();
    const marker = 'Boxing Center';
    if (body.includes(marker) && body.includes(BOXING_CENTER_CONTACT_EMAIL)) {
        return body;
    }
    return `${body}${buildWhatsAppSignature()}`;
}

function buildEmailSignatureHtml() {
    const site = escapeHtml(BOXING_CENTER_SITE);
    const host = escapeHtml(siteHost());
    const email = escapeHtml(BOXING_CENTER_CONTACT_EMAIL);
    const logo = escapeHtml(BOXING_CENTER_LOGO_URL);

    return `
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:28px;border-collapse:collapse;">
  <tr>
    <td style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:22px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
              <tr>
                <td width="84" valign="top" style="padding-right:16px;">
                  <img src="${logo}" alt="Boxing Center" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:12px;background:#fff;padding:6px;object-fit:contain;" />
                </td>
                <td valign="middle" style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
                  <p style="margin:0 0 6px;font-size:18px;font-weight:700;letter-spacing:0.02em;">Boxing Center</p>
                  <p style="margin:0 0 4px;font-size:14px;line-height:1.5;">
                    <a href="${site}" style="color:#93c5fd;text-decoration:none;font-weight:600;">${host}</a>
                  </p>
                  <p style="margin:0;font-size:14px;line-height:1.5;">
                    <a href="mailto:${email}" style="color:#e2e8f0;text-decoration:none;">${email}</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 24px 16px;background:rgba(0,0,0,0.15);color:#cbd5e1;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;">
            Pour répondre à ce message, contactez <strong style="color:#fff;">Boxing Center</strong> à
            <a href="mailto:${email}" style="color:#93c5fd;text-decoration:none;">${email}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function buildEmailSignatureText() {
    return [
        '',
        '—',
        'Boxing Center',
        BOXING_CENTER_SITE,
        BOXING_CENTER_CONTACT_EMAIL,
    ].join('\n');
}

function buildEmailHtml({ subject = '', body = '', recipientName = '' }) {
    const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
    const greeting = recipientName
        ? `<p style="margin:0 0 16px;font-size:16px;color:#0f172a;">Bonjour <strong>${escapeHtml(recipientName)}</strong>,</p>`
        : '';
    const subjectBlock = subject
        ? `<p style="margin:0 0 12px;font-size:17px;font-weight:700;color:#0f172a;">${escapeHtml(subject)}</p>`
        : '';

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#eef2f7;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;border-collapse:collapse;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="height:5px;background:linear-gradient(90deg,#2563eb,#0f172a);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;font-size:15px;line-height:1.6;color:#334155;">
              ${greeting}
              ${subjectBlock}
              <div style="margin:0 0 8px;">${safeBody || '&nbsp;'}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              ${buildEmailSignatureHtml()}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailPlainText({ subject = '', body = '', recipientName = '' }) {
    const lines = [];
    if (recipientName) lines.push(`Bonjour ${recipientName},`, '');
    if (subject) lines.push(subject, '');
    lines.push(String(body || '').trim(), buildEmailSignatureText());
    return lines.filter((l, i, arr) => !(i === arr.length - 1 && l === '')).join('\n');
}

module.exports = {
    BOXING_CENTER_SITE,
    BOXING_CENTER_CONTACT_EMAIL,
    BOXING_CENTER_LOGO_URL,
    WA_CAPTION_MAX,
    appendWhatsAppSignature,
    buildEmailHtml,
    buildEmailPlainText,
    buildEmailSignatureHtml,
    buildWhatsAppSignature,
};
