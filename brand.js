/**
 * Identité visuelle Boxing Center — signature emails & WhatsApp.
 */

const BOXING_CENTER_SITE = (
    process.env.BOXING_CENTER_SITE_URL || 'https://boxingcenter.fr/'
).replace(/\/?$/, '/');

const BOXING_CENTER_CONTACT_EMAIL = (
    process.env.BOXING_CENTER_CONTACT_EMAIL ||
    process.env.RECEPTION_EMAIL ||
    process.env.BREVO_REPLY_TO ||
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

const LOGO_CID = 'boxing-center-logo';
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
    ].join('\n');
}

function appendWhatsAppSignature(message) {
    const body = String(message || '').trimEnd();
    if (body.includes('boxingcenter.fr') && body.includes(BOXING_CENTER_CONTACT_EMAIL)) {
        return body;
    }
    return `${body}${buildWhatsAppSignature()}`;
}

function buildEmailSignatureHtml({ embedded = false } = {}) {
    const site = escapeHtml(BOXING_CENTER_SITE);
    const host = escapeHtml(siteHost());
    const email = escapeHtml(BOXING_CENTER_CONTACT_EMAIL);
    const logoSrc = embedded ? `cid:${LOGO_CID}` : escapeHtml(BOXING_CENTER_LOGO_URL);

    return `
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:24px;border-collapse:collapse;">
  <tr>
    <td style="padding:20px 22px;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-radius:14px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td width="80" valign="middle" style="padding-right:14px;">
            <img src="${logoSrc}" alt="Boxing Center" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:10px;background:#ffffff;padding:5px;object-fit:contain;" />
          </td>
          <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
            <p style="margin:0 0 4px;font-size:17px;font-weight:700;">Boxing Center</p>
            <p style="margin:0 0 2px;font-size:13px;line-height:1.45;">
              <a href="${site}" style="color:#93c5fd;text-decoration:none;">${host}</a>
            </p>
            <p style="margin:0;font-size:13px;line-height:1.45;">
              <a href="mailto:${email}" style="color:#e2e8f0;text-decoration:none;">${email}</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function buildEmailSignatureText() {
    return ['', '—', 'Boxing Center', siteHost(), BOXING_CENTER_CONTACT_EMAIL].join('\n');
}

function buildEmailHtml({
    subject = '',
    body = '',
    recipientName = '',
    showSubjectInBody = false,
    embedded = false,
} = {}) {
    const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
    const greeting = recipientName
        ? `<p style="margin:0 0 14px;font-size:16px;color:#0f172a;">Bonjour <strong>${escapeHtml(recipientName)}</strong>,</p>`
        : '';
    const subjectBlock =
        showSubjectInBody && subject
            ? `<p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(subject)}</p>`
            : '';

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject || 'Boxing Center')}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:20px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:580px;border-collapse:collapse;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#2563eb,#0f172a);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:26px 26px 10px;font-size:15px;line-height:1.65;color:#334155;">
              ${greeting}
              ${subjectBlock}
              <div style="margin:0;">${safeBody || '&nbsp;'}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 26px 24px;">
              ${buildEmailSignatureHtml({ embedded })}
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
    lines.push(String(body || '').trim());
    lines.push(buildEmailSignatureText());
    return lines.join('\n');
}

function embedLogoInHtml(html) {
    if (!html) return html;
    return html
        .split(BOXING_CENTER_LOGO_URL)
        .join(`cid:${LOGO_CID}`);
}

module.exports = {
    BOXING_CENTER_SITE,
    BOXING_CENTER_CONTACT_EMAIL,
    BOXING_CENTER_LOGO_URL,
    LOGO_CID,
    WA_CAPTION_MAX,
    appendWhatsAppSignature,
    buildEmailHtml,
    buildEmailPlainText,
    buildEmailSignatureHtml,
    buildWhatsAppSignature,
    embedLogoInHtml,
};
