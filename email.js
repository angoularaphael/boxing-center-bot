const axios = require('axios');
const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const {
    createOutboundMessage,
    updateOutboundMessage,
} = require('./supabase');
const {
    buildEmailHtml,
    buildEmailPlainText,
    BOXING_CENTER_CONTACT_EMAIL,
    LOGO_CID,
    embedLogoInHtml,
} = require('./brand');

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
const RECEPTION_EMAIL = (
    process.env.RECEPTION_EMAIL ||
    process.env.BREVO_REPLY_TO ||
    BOXING_CENTER_CONTACT_EMAIL
).trim();

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

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

function getLogoAttachment() {
    if (!fs.existsSync(LOGO_PATH)) return null;
    return {
        filename: 'logo.png',
        path: LOGO_PATH,
        cid: LOGO_CID,
    };
}

function prepareOutboundMail({ subject, body, recipientName, html }) {
    const mailSubject = subject || 'Message de Boxing Center';
    const finalHtml = embedLogoInHtml(
        html ||
            buildEmailHtml({
                subject: mailSubject,
                body: body || '',
                recipientName,
                showSubjectInBody: false,
                embedded: Boolean(getLogoAttachment()),
            })
    );
    const bodyText = buildEmailPlainText({
        subject: mailSubject,
        body: body || '',
        recipientName,
    });
    const logo = getLogoAttachment();
    return {
        mailSubject,
        finalHtml,
        bodyText,
        attachments: logo ? [logo] : [],
    };
}

async function verifyEmailSetup() {
    const base = {
        senderEmail: BREVO_SENDER_EMAIL,
        senderName: BREVO_SENDER_NAME,
        receptionEmail: RECEPTION_EMAIL,
        contactEmail: BOXING_CENTER_CONTACT_EMAIL,
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

async function sendViaSmtp({ to, subject, html, text, attachments }) {
    await getSmtpTransport().sendMail({
        from: `"${BREVO_SENDER_NAME}" <${BREVO_SENDER_EMAIL}>`,
        to,
        replyTo: `"${BREVO_SENDER_NAME}" <${BOXING_CENTER_CONTACT_EMAIL}>`,
        subject,
        html,
        text,
        attachments,
        headers: {
            'X-Mailer': 'Boxing Center',
            Importance: 'normal',
        },
        messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@boxingcenter.fr>`,
    });
}

async function sendViaRestApi({ to, subject, html, text }) {
    const payload = {
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: to }],
        replyTo: { email: BOXING_CENTER_CONTACT_EMAIL, name: BREVO_SENDER_NAME },
        subject,
        htmlContent: html,
        textContent: text,
        headers: {
            'X-Mailin-custom': 'boxing-center-transactional',
        },
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

async function sendBrevoEmail({ to, subject, html, text, managerId = null, recipientName = '' }) {
    if (!isEmailConfigured()) {
        throw new Error(
            'Brevo non configuré — BREVO_SMTP_LOGIN + BREVO_SMTP_KEY (SMTP) ou BREVO_API_KEY API (xkeysib…)'
        );
    }
    if (!to) {
        throw new Error('Destinataire email requis');
    }

    const { mailSubject, finalHtml, bodyText, attachments } = prepareOutboundMail({
        subject,
        body: text || '',
        recipientName,
        html,
    });

    const record = await createOutboundMessage({
        manager_id: managerId,
        channel: 'email',
        recipient: to,
        subject: mailSubject,
        body: bodyText,
        status: 'pending',
    });

    try {
        if (useSmtp()) {
            await sendViaSmtp({
                to,
                subject: mailSubject,
                html: finalHtml,
                text: bodyText,
                attachments,
            });
        } else {
            await sendViaRestApi({
                to,
                subject: mailSubject,
                html: finalHtml,
                text: bodyText,
            });
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
