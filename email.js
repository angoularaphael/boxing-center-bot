const axios = require('axios');
const {
    createOutboundMessage,
    updateOutboundMessage,
} = require('./supabase');

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'suzinabot@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Boxing Center';
const RECEPTION_EMAIL = process.env.RECEPTION_EMAIL || process.env.BREVO_REPLY_TO || 'angoularaphael05@gmail.com';

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildEmailHtml({ subject = '', body = '', recipientName = '' }) {
    const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
    const greeting = recipientName ? `<p>Bonjour ${escapeHtml(recipientName)},</p>` : '';

    return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;">
  <p style="margin:0 0 8px;font-weight:bold;">Boxing Center</p>
  ${greeting}
  ${subject ? `<p style="margin:16px 0 8px;font-weight:bold;">${escapeHtml(subject)}</p>` : ''}
  <div style="margin:0 0 24px;">${safeBody || '&nbsp;'}</div>
  <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
  <p style="margin:0;font-size:13px;color:#666;">
    Boxing Center — pour répondre : ${escapeHtml(RECEPTION_EMAIL)}
  </p>
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
            replyTo: { email: RECEPTION_EMAIL, name: BREVO_SENDER_NAME },
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
        let message = err.response?.data?.message || err.message;
        const code = err.response?.data?.code || '';
        if (
            /sender/i.test(message) ||
            /not verified/i.test(message) ||
            code === 'invalid_parameter'
        ) {
            message =
                `Expéditeur Brevo non configuré : validez « ${BREVO_SENDER_EMAIL} » dans Brevo → Expéditeurs. ` +
                `(Détail : ${message})`;
        }
        await updateOutboundMessage(record.id, {
            status: 'failed',
            error: message,
        });
        throw new Error(message);
    }
}

module.exports = { sendBrevoEmail, buildEmailHtml };
