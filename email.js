const axios = require('axios');
const nodemailer = require('nodemailer');
const {
    createOutboundMessage,
    updateOutboundMessage,
} = require('./supabase');

const BREVO_API_KEY = (process.env.BREVO_API_KEY || '').trim();
const BREVO_SMTP_KEY = (
    process.env.BREVO_SMTP_KEY ||
    (BREVO_API_KEY.startsWith('xsmtpsib-') ? BREVO_API_KEY : '')
).trim();
const BREVO_SMTP_LOGIN = (process.env.BREVO_SMTP_LOGIN || '').trim();
const BREVO_SMTP_HOST = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
const BREVO_SMTP_PORT = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'suzinabot@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Boxing Center';
const RECEPTION_EMAIL = process.env.RECEPTION_EMAIL || process.env.BREVO_REPLY_TO || 'angoularaphael05@gmail.com';

function useSmtp() {
    return Boolean(BREVO_SMTP_KEY && BREVO_SMTP_LOGIN);
}

function useRestApi() {
    return Boolean(BREVO_API_KEY && BREVO_API_KEY.startsWith('xkeysib-'));
}

function isEmailConfigured() {
    return useSmtp() || useRestApi();
}

let smtpTransport = null;

function getSmtpTransport() {
    if (!smtpTransport) {
        smtpTransport = nodemailer.createTransport({
            host: BREVO_SMTP_HOST,
            port: BREVO_SMTP_PORT,
            secure: BREVO_SMTP_PORT === 465,
            auth: {
                user: BREVO_SMTP_LOGIN,
                pass: BREVO_SMTP_KEY,
            },
        });
    }
    return smtpTransport;
}

async function verifyEmailSetup() {
    const base = {
        senderEmail: BREVO_SENDER_EMAIL,
        senderName: BREVO_SENDER_NAME,
        receptionEmail: RECEPTION_EMAIL,
        transport: useSmtp() ? 'smtp' : useRestApi() ? 'api' : null,
    };

    if (!isEmailConfigured()) {
        return {
            ...base,
            configured: false,
            hasApiKey: false,
            hasSmtp: false,
            senderVerified: false,
            hint: 'Ajoutez BREVO_SMTP_LOGIN + BREVO_SMTP_KEY (SMTP) ou BREVO_API_KEY (xkeysib…) dans .env',
        };
    }

    if (useSmtp()) {
        try {
            await getSmtpTransport().verify();
            return {
                ...base,
                configured: true,
                hasApiKey: Boolean(BREVO_API_KEY),
                hasSmtp: true,
                senderVerified: true,
                senderError: null,
                hint: null,
            };
        } catch (err) {
            return {
                ...base,
                configured: false,
                hasApiKey: Boolean(BREVO_API_KEY),
                hasSmtp: true,
                senderVerified: false,
                senderError: err.message,
                hint: 'Vérifiez BREVO_SMTP_LOGIN et BREVO_SMTP_KEY dans Brevo → SMTP et API.',
            };
        }
    }

    let senderVerified = false;
    let senderError = null;
    try {
        const { data } = await axios.get('https://api.brevo.com/v3/senders', {
            headers: { 'api-key': BREVO_API_KEY, Accept: 'application/json' },
            timeout: 15000,
        });
        const senders = data?.senders || [];
        senderVerified = senders.some(
            (s) => s.email?.toLowerCase() === BREVO_SENDER_EMAIL.toLowerCase() && s.active
        );
        if (!senderVerified) {
            senderError = `L'expéditeur ${BREVO_SENDER_EMAIL} n'est pas validé dans Brevo.`;
        }
    } catch (err) {
        senderError = err.response?.data?.message || err.message;
    }

    return {
        ...base,
        configured: Boolean(senderVerified),
        hasApiKey: true,
        hasSmtp: false,
        senderVerified,
        senderError,
        hint: senderVerified
            ? null
            : `Brevo → Expéditeurs : validez ${BREVO_SENDER_EMAIL}.`,
    };
}

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

async function sendViaSmtp({ to, subject, html, text }) {
    await getSmtpTransport().sendMail({
        from: `"${BREVO_SENDER_NAME}" <${BREVO_SENDER_EMAIL}>`,
        to,
        replyTo: RECEPTION_EMAIL,
        subject: subject || 'Message Boxing Center',
        html: html || `<p>${String(text || '').replace(/\n/g, '<br>')}</p>`,
        text: text || '',
    });
}

async function sendViaRestApi({ to, subject, html, text }) {
    const bodyText = text || (html ? html.replace(/<[^>]+>/g, '') : '');
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
}

async function sendBrevoEmail({ to, subject, html, text, managerId = null }) {
    if (!isEmailConfigured()) {
        throw new Error(
            'Brevo non configuré — BREVO_SMTP_LOGIN + BREVO_SMTP_KEY (SMTP) ou BREVO_API_KEY API (xkeysib…)'
        );
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
        if (useSmtp()) {
            await sendViaSmtp({ to, subject, html, text: bodyText });
        } else {
            await sendViaRestApi({ to, subject, html, text: bodyText });
        }

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

module.exports = {
    sendBrevoEmail,
    buildEmailHtml,
    isEmailConfigured,
    verifyEmailSetup,
};
