const axios = require('axios');
const {
    createOutboundMessage,
    updateOutboundMessage,
} = require('./supabase');

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'boxingcenter31@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Boxing Center';

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

module.exports = { sendBrevoEmail };
