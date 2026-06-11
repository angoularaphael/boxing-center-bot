const axios = require('axios');
const {
    createOutboundMessage,
    updateOutboundMessage,
} = require('./supabase');

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'boxingcenter31@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Boxing Center';

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildEmailHtml({ subject = '', body = '', recipientName = '' }) {
    const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
    const greeting = recipientName
        ? `<p style="margin:0 0 16px;font-size:16px;color:#334155;">Bonjour <strong>${escapeHtml(recipientName)}</strong>,</p>`
        : '';

    return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#2563eb 100%);padding:36px 32px;text-align:center;">
            <div style="font-size:36px;line-height:1;margin-bottom:8px;">🥊</div>
            <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Boxing Center</h1>
            <p style="margin:8px 0 0;font-size:13px;color:#cbd5e1;">Messagerie officielle managers</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 32px;">
            ${greeting}
            ${subject ? `<h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;">${escapeHtml(subject)}</h2>` : ''}
            <div style="font-size:16px;line-height:1.7;color:#334155;">${safeBody}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
              Cet email vous a été envoyé par <strong style="color:#0f172a;">Boxing Center</strong>.<br>
              Répondez directement à cet email pour nous contacter.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendBrevoEmail({ to, subject, html, text, managerId = null }) {
    if (!BREVO_API_KEY) {
        throw new Error('BREVO_API_KEY manquant — configurez la clé API Brevo dans .env');
    }
    if (!to) {
        throw new Error('Destinataire email requis');
    }

    const bodyText = text || (html ? html.replace(/<[^>]+>/g, '') : '');
    const record = await createOutboundMessage({
        manager_id: managerId,
        channel: 'email',
        recipient: to,
        subject: subject || '(sans objet)',
        body: bodyText,
        status: 'pending',
    });

    try {
        const payload = {
            sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
            to: [{ email: to }],
            subject: subject || 'Message Boxing Center',
            htmlContent: html || `<p>${bodyText.replace(/\n/g, '<br>')}</p>`,
            textContent: bodyText,
        };

        await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
            headers: {
                'api-key': BREVO_API_KEY,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            timeout: 30000,
        });

        await updateOutboundMessage(record.id, {
            status: 'sent',
            sent_at: new Date().toISOString(),
        });

        return { success: true, id: record.id };
    } catch (err) {
        const message = err.response?.data?.message || err.message;
        await updateOutboundMessage(record.id, {
            status: 'failed',
            error: message,
        });
        throw new Error(message);
    }
}

module.exports = { sendBrevoEmail, buildEmailHtml };
