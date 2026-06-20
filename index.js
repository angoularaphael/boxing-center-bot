const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    getContentType,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Bothosting : le .env éditable est à /home/container/.env (parent du clone)
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const {
    fetchManagers,
    fetchManagerById,
    fetchTestManager,
    fetchManagerStats,
    fetchManagersWithPhone,
    fetchManagersWithEmail,
    fetchManagersForBroadcast,
    fetchPromoteurs,
    fetchPromoteurById,
    fetchTestPromoteur,
    fetchPromoteurStats,
    fetchPromoteursForBroadcast,
    fetchPromoteursWithPhone,
    fetchPromoteursWithEmail,
    fetchBoxeurs,
    fetchBoxeurById,
    fetchTestBoxeur,
    fetchBoxeurStats,
    fetchBoxeursForBroadcast,
    fetchBoxeursWithPhone,
    fetchBoxeursWithEmail,
    fetchClientsByIds,
    countPortetClientsForBroadcast,
    fetchAllPaginated,
    clientDisplayName,
    getSupabase,
    fetchUnreadInbound,
    fetchInboundMessages,
    fetchOutboundMessages,
    saveInboundMessage,
    markInboundRead,
    createOutboundMessage,
    updateOutboundMessage,
    markOutboundWhatsAppRead,
} = require('./supabase');
const { sendBrevoEmail, verifyEmailSetup } = require('./email');
const {
    getGroupeChabaneContacts,
    resolveGroupeChabaneForSend,
} = require('./groupeChabane');
const {
    buildContactsCsv,
    extractContactsFromIncomingMessage,
    formatContactsCsvSummary,
} = require('./contactsCsv');
const {
    appendWhatsAppSignature,
    buildEmailHtml,
    WA_CAPTION_MAX,
} = require('./brand');
const app = express();
app.use(cors());
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

let sock = null;
let currentQrBase64 = null;
let pairingCode = null;
let isConnected = false;
let isLinking = false;
let linkMethod = 'qr';
let linkPhone = '';
let qrError = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 6;
const lidPhoneCache = new Map();

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR);
}

const CONFIG_FILE = path.join(__dirname, 'bot_config.json');
const MENU_LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');
const SITE_API_SECRET = process.env.SITE_API_SECRET || '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.BOXING_CENTER_SITE_URL || 'https://gestion-manager.vercel.app';
const RECEPTION_EMAIL = process.env.RECEPTION_EMAIL || process.env.BREVO_REPLY_TO || 'boxingcenter31@gmail.com';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'suzinabot@11426075.brevosend.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Boxing Center';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const {
  getTestSendEmail,
  getTestSendPhone,
  getTestContactLabel,
} = require('./testSendTargets');

const TEST_TARGET_PHONE = getTestSendPhone();
const TEST_TARGET_EMAIL = getTestSendEmail();
const WA_MAX_LEN = 3800;
/** proto.WebMessageInfo.Status.READ — accusé de lecture WhatsApp (2 coches bleues). */
const WA_MSG_STATUS_READ = 4;
const OFFRE_ETE_CAMPAIGN_TAG = 'offre_ete_2026';

function normalizePhone(input) {
    if (!input) return '';
    return String(input).split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Numéro FR 06… → 336… pour WhatsApp. */
function toWhatsAppDigits(input) {
    const digits = normalizePhone(input);
    if (!digits) return '';
    if (digits.length === 10 && digits.startsWith('0')) {
        return `33${digits.slice(1)}`;
    }
    if (digits.length === 9 && /^[1-9]/.test(digits)) {
        return `33${digits}`;
    }
    if (digits.startsWith('33') && digits.length >= 11) {
        return digits;
    }
    return digits;
}

const MANDATORY_ADMIN_PHONE = normalizePhone(
    process.env.MANDATORY_ADMIN_PHONE || '33762641473'
);

let botConfig = { authorizedPhones: [] };

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2));
}

function isValidPhoneDigits(digits) {
    return digits.length >= 9 && digits.length <= 15;
}

function migrateConfig(parsed) {
    let authorizedPhones = Array.isArray(parsed.authorizedPhones)
        ? parsed.authorizedPhones.map(normalizePhone).filter(Boolean)
        : [];
    authorizedPhones = authorizedPhones
        .filter((p) => p !== MANDATORY_ADMIN_PHONE)
        .filter((p) => isValidPhoneDigits(p));
    return { authorizedPhones };
}

function getEnvAuthorizedPhones() {
    const raw = process.env.ADMIN_PHONES || '';
    return raw
        .split(/[,;\s]+/)
        .map(normalizePhone)
        .filter((p) => p && isValidPhoneDigits(p));
}

function getAllAuthorizedPhones() {
    const envPhones = getEnvAuthorizedPhones();
    const extra = (botConfig.authorizedPhones || [])
        .map(normalizePhone)
        .filter((p) => p && p !== MANDATORY_ADMIN_PHONE);
    return [...new Set([MANDATORY_ADMIN_PHONE, ...envPhones, ...extra])];
}

if (fs.existsSync(CONFIG_FILE)) {
    try {
        botConfig = migrateConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
        saveConfig();
    } catch (e) {
        console.error('[BOT] Erreur lecture config', e);
    }
}

function verifyApiSecret(req, res) {
    const secret = req.headers['x-api-secret']
        || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!SITE_API_SECRET || secret !== SITE_API_SECRET) {
        res.status(401).json({ error: 'Non autorisé' });
        return false;
    }
    return true;
}

function isPnJid(jid) {
    const s = String(jid || '');
    return s.includes('@s.whatsapp.net') || s.endsWith('@c.us');
}

function isLidJid(jid) {
    return String(jid || '').includes('@lid');
}

function storeLidMapping(lid, pn) {
    const lidKey = normalizePhone(lid);
    const phone = normalizePhone(pn);
    if (lidKey && phone && isValidPhoneDigits(phone)) {
        lidPhoneCache.set(lidKey, phone);
    }
}

function cacheLidFromMessage(key) {
    if (!key) return;
    const primary = key.participant || key.remoteJid;
    const alt = key.participantAlt || key.remoteJidAlt;
    if (primary && alt && (isLidJid(primary) || !isPnJid(primary)) && isPnJid(alt)) {
        storeLidMapping(primary, alt);
    }
}

function resolveSenderPhone(msg) {
    const key = msg.key || {};
    if (msg.key.fromMe) {
        return sock?.user?.id ? normalizePhone(sock.user.id) : '';
    }
    for (const altJid of [key.participantAlt, key.remoteJidAlt]) {
        if (altJid && isPnJid(altJid)) {
            const phone = normalizePhone(altJid);
            if (isValidPhoneDigits(phone)) return phone;
        }
    }
    const primary = key.participant || key.remoteJid || '';
    if (primary && isPnJid(primary)) {
        const phone = normalizePhone(primary);
        if (isValidPhoneDigits(phone)) return phone;
    }
    const lidKey = normalizePhone(primary);
    if (lidKey && lidPhoneCache.has(lidKey)) {
        return lidPhoneCache.get(lidKey);
    }
    if (sock?.signalRepository?.lidMapping?.getPNForLID) {
        try {
            const lidJid = isLidJid(primary) ? primary : `${lidKey}@lid`;
            const pn = sock.signalRepository.lidMapping.getPNForLID(lidJid);
            if (pn) {
                const phone = normalizePhone(pn);
                if (isValidPhoneDigits(phone)) {
                    storeLidMapping(lidKey, phone);
                    return phone;
                }
            }
        } catch (e) {
            console.warn('[BOT] getPNForLID:', e.message);
        }
    }
    if (isValidPhoneDigits(lidKey) && !isLidJid(primary)) {
        return lidKey;
    }
    return '';
}

function isSenderAuthorized(msg) {
    const senderPhone = resolveSenderPhone(msg);
    if (!senderPhone) return false;
    return getAllAuthorizedPhones().includes(senderPhone);
}

const BOT_COMMANDS = new Set([
    '.menu',
    '.guide', '.aide', '.help',
    '.ping',
    '.test', '.testenvoi',
    '.numeros', '.phones',
    '.emails',
    '.promo-numeros', '.promo-phones',
    '.promo-emails',
    '.box-numeros', '.box-phones',
    '.box-emails',
    '.box-pro-numeros', '.box-pro-phones',
    '.box-amateur-numeros', '.box-amateur-phones',
    '.nonlus', '.unread',
    '.stats',
    '.authorise', '.authorize', '.autorise',
    '.unauthorise', '.unauthorize', '.unautorise',
    '.contacts-csv', '.contactscsv', '.export-contacts',
    '.groupe-chabane-numeros', '.groupe-chabane-phones',
]);

function isKnownBotCommand(cleanText, cmd) {
    if (BOT_COMMANDS.has(cmd)) return true;
    return ['.authorise', '.authorize', '.autorise', '.unauthorise', '.unauthorize', '.unautorise'].some(
        (p) => cleanText.startsWith(p)
    );
}

const COMMAND_REACTION = '🥊';

function getMenuText() {
    return [
        '🥊 *Boxing Center — Commandes*',
        '',
        '*Général*',
        '`.menu`',
        '`.guide`',
        '`.ping`',
        '`.stats` — Stats managers + promoteurs + boxeurs',
        '`.nonlus`',
        '',
        '*Managers*',
        '`.numeros`',
        '`.emails`',
        '',
        '*Promoteurs*',
        '`.promo-numeros`',
        '`.promo-emails`',
        '',
        '*Boxeurs*',
        '`.box-numeros`',
        '`.box-emails`',
        '`.box-pro-numeros`',
        '`.box-amateur-numeros`',
        '',
        '*Groupe Chabane*',
        '`.groupe-chabane-numeros`',
        '',
        '*Outils*',
        '`.contacts-csv` — CSV depuis contacts (répondre au message)',
        '',
        '*Tests & admin*',
        '`.test`',
        '`.authorise`',
        '`.unauthorise`',
        '',
        `🌐 Console : ${SITE_URL}`,
        `📧 Réception : ${RECEPTION_EMAIL}`,
        `📤 Envoi : ${SENDER_EMAIL}`,
        '',
        'Tapez `.guide` pour le détail (admins).',
    ].join('\n');
}

function getGuideText() {
    return [
        '📖 *Guide — Boxing Center Bot*',
        '',
        '*Général*',
        '• `.menu` — Liste des commandes (+ logo)',
        '• `.guide` — Ce guide détaillé',
        '• `.ping` — Tester la connexion du bot',
        '• `.stats` — Statistiques managers, promoteurs et boxeurs',
        '• `.nonlus` / `.unread` — Messages WhatsApp non lus',
        '',
        '*Managers*',
        '• `.numeros` / `.phones` — Managers avec téléphone',
        '• `.emails` — Managers avec email',
        '',
        '*Promoteurs*',
        '• `.promo-numeros` / `.promo-phones` — Promoteurs avec téléphone',
        '• `.promo-emails` — Promoteurs avec email',
        '',
        '*Boxeurs*',
        '• `.box-numeros` / `.box-phones` — Tous les boxeurs avec téléphone',
        '• `.box-emails` — Tous les boxeurs avec email',
        '• `.box-pro-numeros` — Boxeurs pro avec téléphone',
        '• `.box-amateur-numeros` — Boxeurs amateur avec téléphone',
        '',
        '*Groupe Chabane*',
        '• `.groupe-chabane-numeros` — Contacts du Groupe Chabane',
        '',
        '*Outils*',
        '• `.contacts-csv` — Répondre à un message contenant des contacts pour recevoir un CSV',
        '',
        '*Tests & admin*',
        `• \`.test\` — Envoi test WA + email (${getTestContactLabel()} : ${TEST_TARGET_PHONE} / ${TEST_TARGET_EMAIL})`,
        '• `.authorise NUMERO` — Autoriser un admin WhatsApp',
        '• `.unauthorise NUMERO` — Retirer un admin',
        '',
        '*Console web*',
        `• ${SITE_URL}`,
        '• Envoi managers, promoteurs et boxeurs (email + WhatsApp)',
        `• Réponses / contact : ${RECEPTION_EMAIL}`,
        '',
        '*Exemples*',
        '`.authorise 33762641473`',
        '`.stats`',
        '`.promo-numeros`',
    ].join('\n');
}

async function getMenuLogoBuffer() {
    if (fs.existsSync(MENU_LOGO_PATH)) {
        return fs.readFileSync(MENU_LOGO_PATH);
    }
    return null;
}

async function sendLongMessage(jid, text) {
    if (text.length <= WA_MAX_LEN) {
        await sock.sendMessage(jid, { text });
        return;
    }
    let rest = text;
    while (rest.length > WA_MAX_LEN) {
        await sock.sendMessage(jid, { text: rest.slice(0, WA_MAX_LEN) });
        rest = rest.slice(WA_MAX_LEN);
        await new Promise((r) => setTimeout(r, 400));
    }
    if (rest) await sock.sendMessage(jid, { text: rest });
}

async function sendTextWithLogo(jid, text, logo = null) {
    const img = logo ?? (await getMenuLogoBuffer());
    if (img) {
        await sock.sendMessage(jid, { image: img, caption: text });
    } else {
        await sock.sendMessage(jid, { text });
    }
}

async function sendMenu(jid) {
    await sendTextWithLogo(jid, getMenuText());
}

async function sendGuide(jid) {
    await sendLongMessage(jid, getGuideText());
}

async function runTestEnvoi() {
    let testMgr = null;
    try {
        testMgr = await fetchTestManager();
    } catch { /* ignore */ }

    const phone = normalizePhone(testMgr?.telephone || TEST_TARGET_PHONE);
    const email = (testMgr?.email || TEST_TARGET_EMAIL).trim().toLowerCase();
    const managerId = testMgr?.id || null;
    const name = testMgr?.nom || getTestContactLabel();
    const subject = 'Boxing Center';
    const message = 'Message de Boxing Center — merci de confirmer la bonne réception de ce message.';

    const results = { whatsapp: '—', email: '—' };

    try {
        await sendWhatsAppMessage(phone, message, managerId);
        results.whatsapp = `✅ +${phone}`;
    } catch (err) {
        results.whatsapp = `❌ ${err.message}`;
    }

    try {
        const html = buildEmailHtml({ subject, body: message, recipientName: name });
        await sendBrevoEmail({
            to: email,
            subject,
            html,
            text: message,
            managerId,
            recipientName: name,
        });
        results.email = `✅ ${email}`;
    } catch (err) {
        results.email = `❌ ${err.message}`;
    }

    return { results, phone, email, name };
}

function formatPhoneList(rows, total, entityLabel = 'Managers') {
    const lines = [`📞 *${entityLabel} avec téléphone* — ${total} au total`, ''];
    if (!rows.length) {
        lines.push(`Aucun ${entityLabel.toLowerCase()} avec numéro.`);
        return lines.join('\n');
    }
    rows.forEach((r, i) => {
        const cat = r.categorie ? ` (${r.categorie})` : '';
        lines.push(`${i + 1}. *${r.nom}*${cat} — ${r.telephone || '—'}`);
    });
    if (total > rows.length) {
        lines.push('', `_(échantillon ${rows.length}/${total})_`);
    }
    return lines.join('\n');
}

function formatEmailList(rows, total, entityLabel = 'Managers') {
    const lines = [`📧 *${entityLabel} avec email* — ${total} au total`, ''];
    if (!rows.length) {
        lines.push(`Aucun ${entityLabel.toLowerCase()} avec email.`);
        return lines.join('\n');
    }
    rows.forEach((r, i) => {
        const cat = r.categorie ? ` (${r.categorie})` : '';
        lines.push(`${i + 1}. *${r.nom}*${cat} — ${r.email || '—'}`);
    });
    if (total > rows.length) {
        lines.push('', `_(échantillon ${rows.length}/${total})_`);
    }
    return lines.join('\n');
}

function formatUnreadList(rows) {
    const lines = [`📥 *Messages non lus* — ${rows.length}`, ''];
    if (!rows.length) {
        lines.push('Aucun message non lu.');
        return lines.join('\n');
    }
    rows.forEach((r) => {
        const date = new Date(r.received_at).toLocaleString('fr-FR');
        lines.push(`• *${r.from_phone}*${r.from_name ? ` (${r.from_name})` : ''}`, `  ${date}`, `  ${r.body.slice(0, 120)}${r.body.length > 120 ? '…' : ''}`, '');
    });
    return lines.join('\n');
}

function formatStatsBlock(title, stats) {
    return [
        `*${title}*`,
        `Total : ${stats.total} · Tél. : ${stats.withPhone} · Email : ${stats.withEmail} · Les deux : ${stats.both}`,
    ].join('\n');
}

function formatAllStats(mgr, promo, box) {
    const lines = ['📊 *Statistiques contacts*', ''];
    lines.push(formatStatsBlock('Managers', mgr));
    lines.push('');
    lines.push(formatStatsBlock('Promoteurs', promo));
    lines.push('');
    lines.push(formatStatsBlock('Boxeurs', box));
    lines.push('', `Amateur : ${box.amateur} · Pro : ${box.pro}`);
    lines.push('', `Console : ${SITE_URL}`);
    return lines.join('\n');
}

function extractText(msg) {
    if (!msg?.message) return '';
    const contentType = getContentType(msg.message);
    if (contentType === 'conversation') return msg.message.conversation || '';
    if (contentType === 'extendedTextMessage') return msg.message.extendedTextMessage?.text || '';
    if (contentType === 'imageMessage') return msg.message.imageMessage?.caption || '';
    return '';
}

function parseCommandPhone(text, commandBase) {
    const trimmed = text.trim();
    const bases = [commandBase];
    if (commandBase === 'authorise') bases.push('authorize', 'autorise');
    if (commandBase === 'unauthorise') bases.push('unauthorize', 'unautorise');
    for (const base of bases) {
        const patterns = [
            new RegExp(`^\\.${base}\\s*\\((\\d{9,15})\\)`, 'i'),
            new RegExp(`^\\.${base}\\s+(\\d{9,15})`, 'i'),
        ];
        for (const pattern of patterns) {
            const match = trimmed.match(pattern);
            if (match) return normalizePhone(match[1]);
        }
    }
    return null;
}

function addAuthorizedPhone(phone) {
    if (!isValidPhoneDigits(phone)) {
        return { ok: false, message: '❌ Numéro invalide.' };
    }
    if (phone === MANDATORY_ADMIN_PHONE) {
        return { ok: true, message: 'ℹ️ Numéro déjà autorisé en permanence.' };
    }
    if (!botConfig.authorizedPhones.includes(phone)) {
        botConfig.authorizedPhones.push(phone);
        saveConfig();
    }
    return { ok: true, message: `✅ ${phone} autorisé.` };
}

function removeAuthorizedPhone(phone) {
    if (phone === MANDATORY_ADMIN_PHONE) {
        return { ok: false, message: '⛔ Numéro obligatoire, non supprimable.' };
    }
    botConfig.authorizedPhones = botConfig.authorizedPhones.filter((p) => p !== phone);
    saveConfig();
    return { ok: true, message: `✅ ${phone} retiré.` };
}

async function reactToCommand(msg) {
    if (!sock || !msg?.key?.remoteJid) return;
    try {
        await sock.sendMessage(msg.key.remoteJid, {
            react: { text: COMMAND_REACTION, key: msg.key },
        });
    } catch (err) {
        console.warn('[BOT] Réaction:', err.message);
    }
}

async function sendWhatsAppMessage(
    phone,
    message,
    managerId = null,
    promoterId = null,
    boxeurId = null,
    clientId = null,
    campaign = null
) {
    if (!isConnected || !sock) {
        throw new Error('WhatsApp non connecté');
    }
    const cleanNumber = toWhatsAppDigits(phone);
    if (!isValidPhoneDigits(cleanNumber)) {
        throw new Error(`Numéro invalide : ${phone}`);
    }
    const fullMessage = appendWhatsAppSignature(message);
    const record = await createOutboundMessage({
        manager_id: (promoterId || boxeurId || clientId) ? null : managerId,
        promoter_id: promoterId || null,
        boxeur_id: boxeurId || null,
        client_id: clientId || null,
        campaign: campaign || null,
        channel: 'whatsapp',
        recipient: cleanNumber,
        subject: null,
        body: fullMessage,
        status: 'pending',
    });
    try {
        const jid = `${cleanNumber}@s.whatsapp.net`;
        const logo = await getMenuLogoBuffer();
        let waMessageId = null;
        if (logo && fullMessage.length <= WA_CAPTION_MAX) {
            const sent = await sock.sendMessage(jid, { image: logo, caption: fullMessage });
            waMessageId = sent?.key?.id || null;
        } else if (fullMessage.length <= WA_MAX_LEN) {
            const sent = await sock.sendMessage(jid, { text: fullMessage });
            waMessageId = sent?.key?.id || null;
        } else {
            await sendLongMessage(jid, fullMessage);
        }
        await updateOutboundMessage(record.id, {
            status: 'sent',
            sent_at: new Date().toISOString(),
            wa_message_id: waMessageId,
        });
        return { success: true, id: record.id, phone: cleanNumber, waMessageId };
    } catch (err) {
        await updateOutboundMessage(record.id, {
            status: 'failed',
            error: err.message,
        });
        throw err;
    }
}

async function handleWhatsAppReadReceipts(updates) {
    if (!updates?.length) return;
    for (const { key, update } of updates) {
        if (!key?.fromMe || !key?.id) continue;
        const status = update?.status;
        if (status !== WA_MSG_STATUS_READ && status !== 'READ') continue;
        try {
            const row = await markOutboundWhatsAppRead(key.id);
            if (row?.campaign === OFFRE_ETE_CAMPAIGN_TAG) {
                console.log(`[BOT] WhatsApp lu — campagne offre été (${row.recipient || '?'})`);
            }
        } catch (err) {
            console.warn('[BOT] Accusé lecture WhatsApp:', err.message);
        }
    }
}

async function handleIncomingMessages(m) {
    if (m.type && m.type !== 'notify') return;
    if (!m.messages?.length) return;

    for (const msg of m.messages) {
        try {
            if (!msg.message || msg.key.fromMe) continue;
            cacheLidFromMessage(msg.key);

            const text = extractText(msg);
            if (!text) continue;

            const sender = msg.key.remoteJid;
            const senderPhone = resolveSenderPhone(msg);
            const cleanText = text.trim().toLowerCase();
            const isCommand = cleanText.startsWith('.');

            if (!isSenderAuthorized(msg)) {
                if (senderPhone) {
                    await saveInboundMessage({
                        fromPhone: senderPhone,
                        fromName: msg.pushName || null,
                        body: text.trim(),
                    });
                }
                continue;
            }

            if (!isCommand) {
                if (senderPhone) {
                    await saveInboundMessage({
                        fromPhone: senderPhone,
                        fromName: msg.pushName || null,
                        body: text.trim(),
                    });
                }
                continue;
            }

            const cmd = cleanText.split(/\s+/)[0].split('(')[0].split(':')[0];
            if (!isKnownBotCommand(cleanText, cmd)) continue;

            await reactToCommand(msg);

            if (cmd === '.menu') {
                await sendMenu(sender);
                continue;
            }

            if (cmd === '.guide' || cmd === '.aide' || cmd === '.help') {
                await sendGuide(sender);
                continue;
            }

            if (cmd === '.ping') {
                await sock.sendMessage(sender, {
                    text: `🏓 Pong — Boxing Center Bot en ligne.\nConsole : ${SITE_URL}`,
                });
                continue;
            }

            if (cmd === '.numeros' || cmd === '.phones') {
                const stats = await fetchManagerStats();
                const sample = await fetchManagersWithPhone(10);
                await sendLongMessage(sender, formatPhoneList(sample, stats.withPhone, 'Managers'));
            } else if (cmd === '.emails') {
                const stats = await fetchManagerStats();
                const sample = await fetchManagersWithEmail(10);
                await sendLongMessage(sender, formatEmailList(sample, stats.withEmail, 'Managers'));
            } else if (cmd === '.promo-numeros' || cmd === '.promo-phones') {
                const stats = await fetchPromoteurStats();
                const sample = await fetchPromoteursWithPhone(10);
                await sendLongMessage(sender, formatPhoneList(sample, stats.withPhone, 'Promoteurs'));
            } else if (cmd === '.promo-emails') {
                const stats = await fetchPromoteurStats();
                const sample = await fetchPromoteursWithEmail(10);
                await sendLongMessage(sender, formatEmailList(sample, stats.withEmail, 'Promoteurs'));
            } else if (cmd === '.box-numeros' || cmd === '.box-phones') {
                const stats = await fetchBoxeurStats();
                const sample = await fetchBoxeursWithPhone(10);
                await sendLongMessage(sender, formatPhoneList(sample, stats.withPhone, 'Boxeurs'));
            } else if (cmd === '.box-emails') {
                const stats = await fetchBoxeurStats();
                const sample = await fetchBoxeursWithEmail(10);
                await sendLongMessage(sender, formatEmailList(sample, stats.withEmail, 'Boxeurs'));
            } else if (cmd === '.box-pro-numeros' || cmd === '.box-pro-phones') {
                const sample = await fetchBoxeursWithPhone(10, 'pro');
                const proRows = await fetchBoxeurs({ categorie: 'pro' });
                const total = proRows.filter((b) => b.has_phone || b.telephone).length;
                await sendLongMessage(sender, formatPhoneList(sample, total, 'Boxeurs pro'));
            } else if (cmd === '.box-amateur-numeros' || cmd === '.box-amateur-phones') {
                const sample = await fetchBoxeursWithPhone(10, 'amateur');
                const amateurRows = await fetchBoxeurs({ categorie: 'amateur' });
                const total = amateurRows.filter((b) => b.has_phone || b.telephone).length;
                await sendLongMessage(sender, formatPhoneList(sample, total, 'Boxeurs amateur'));
            } else if (cmd === '.nonlus' || cmd === '.unread') {
                const unread = await fetchUnreadInbound();
                await sendLongMessage(sender, formatUnreadList(unread));
            } else if (cmd === '.stats') {
                const [mgr, promo, box] = await Promise.all([
                    fetchManagerStats(),
                    fetchPromoteurStats(),
                    fetchBoxeurStats(),
                ]);
                await sendLongMessage(sender, formatAllStats(mgr, promo, box));
            } else if (cmd === '.test' || cmd === '.testenvoi') {
                await sock.sendMessage(sender, { text: `🧪 Envoi test en cours (${getTestContactLabel()})…` });
                const { results, phone, email, name } = await runTestEnvoi();
                await sock.sendMessage(sender, {
                    text: [
                        `🧪 *Test envoi — ${getTestContactLabel()}*`,
                        '',
                        `👤 ${name}`,
                        `📱 WhatsApp +${phone} : ${results.whatsapp}`,
                        `✉️ Email ${email} : ${results.email}`,
                    ].join('\n'),
                });
            } else if (cmd === '.authorise' || cleanText.startsWith('.authorize') || cleanText.startsWith('.autorise')) {
                const phone = parseCommandPhone(text, 'authorise');
                const result = phone ? addAuthorizedPhone(phone) : { ok: false, message: '❌ Format: `.authorise NUMERO`' };
                await sock.sendMessage(sender, { text: result.message });
            } else if (
                cmd === '.unauthorise' ||
                cleanText.startsWith('.unauthorize') ||
                cleanText.startsWith('.unautorise')
            ) {
                const phone = parseCommandPhone(text, 'unauthorise');
                const result = phone ? removeAuthorizedPhone(phone) : { ok: false, message: '❌ Format: `.unauthorise NUMERO`' };
                await sock.sendMessage(sender, { text: result.message });
            } else if (cmd === '.groupe-chabane-numeros' || cmd === '.groupe-chabane-phones') {
                const rows = getGroupeChabaneContacts();
                const sample = rows.slice(0, 15).map((c) => ({
                    nom: c.nom || c.telephone,
                    telephone: c.telephone,
                }));
                await sendLongMessage(sender, formatPhoneList(sample, rows.length, 'Groupe Chabane'));
            } else if (
                cmd === '.contacts-csv' ||
                cmd === '.contactscsv' ||
                cmd === '.export-contacts'
            ) {
                const contacts = extractContactsFromIncomingMessage(msg, { preferQuoted: true });
                if (!contacts.length) {
                    await sock.sendMessage(sender, {
                        text: [
                            '❌ Aucun contact trouvé.',
                            '',
                            'Répondez à un message contenant des contacts WhatsApp (cartes ou vCard), puis tapez `.contacts-csv`.',
                        ].join('\n'),
                    });
                    continue;
                }
                const csv = buildContactsCsv(contacts);
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                await sock.sendMessage(sender, { text: formatContactsCsvSummary(contacts) });
                await sock.sendMessage(sender, {
                    document: Buffer.from(csv, 'utf8'),
                    mimetype: 'text/csv',
                    fileName: `contacts-${stamp}.csv`,
                    caption: `${contacts.length} contact(s)`,
                });
            }
        } catch (err) {
            console.error('[BOT] Erreur message:', err);
        }
    }
}

function hasRegisteredSession() {
    const creds = path.join(AUTH_DIR, 'creds.json');
    return fs.existsSync(creds) && fs.statSync(creds).size > 50;
}

function clearAuthSession() {
    if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR);
    }
}

function isQrExpiredError(error) {
    const msg = String(error?.message || error || '').toLowerCase();
    return msg.includes('qr') && (msg.includes('expir') || msg.includes('timeout'));
}

async function destroySocket() {
    const old = sock;
    sock = null;
    if (!old) return;
    try {
        old.ev.removeAllListeners('connection.update');
        old.ev.removeAllListeners('creds.update');
        old.ev.removeAllListeners('messages.upsert');
        old.ev.removeAllListeners('lid-mapping.update');
        await old.end(undefined);
    } catch (e) {
        console.warn('[BOT] Fermeture socket:', e.message);
    }
}

function cancelScheduledReconnect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect(method, phoneNumber, delayMs, { clearAuth = false } = {}) {
    cancelScheduledReconnect();
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        isLinking = false;
        qrError = 'Trop de tentatives. Relancez via la console web.';
        return;
    }
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectToWhatsApp(method, phoneNumber, { force: true, clearAuth });
    }, delayMs);
}

async function connectToWhatsApp(method = 'qr', phoneNumber = '', options = {}) {
    const { force = false, clearAuth = false } = options;
    if (isConnected && sock && !force) return;
    if (isLinking && !force) return;

    cancelScheduledReconnect();
    isLinking = true;
    linkMethod = method;
    linkPhone = phoneNumber;
    if (force) qrError = null;

    await destroySocket();
    if (clearAuth) {
        clearAuthSession();
        currentQrBase64 = null;
        pairingCode = null;
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        let version = [2, 3000, 1017578768];
        try {
            const latest = await fetchLatestBaileysVersion();
            version = latest.version;
        } catch (e) {
            console.warn('[BOT] Version WA par défaut');
        }

        const pairingPhone = normalizePhone(phoneNumber);

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: method !== 'pairing_code',
            browser:
                method === 'pairing_code'
                    ? ['Windows', 'Chrome', '110.0.5481.100']
                    : ['Boxing Center Bot', 'Chrome', '120.0.0.0'],
            qrTimeout: 60000,
            connectTimeoutMs: 60000,
        });

        if (method === 'pairing_code' && pairingPhone && !sock.authState.creds.registered) {
            if (!isValidPhoneDigits(pairingPhone)) {
                qrError = 'Numéro invalide (indicatif pays, chiffres uniquement).';
                isLinking = false;
            } else {
                setTimeout(async () => {
                    if (!sock || isConnected) return;
                    try {
                        const code = await sock.requestPairingCode(pairingPhone);
                        pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
                    } catch (err) {
                        console.error('[BOT] Erreur code d\'association :', err);
                        qrError = 'Impossible de générer le code. Vérifiez le numéro et réessayez.';
                        isLinking = false;
                    }
                }, 3000);
            }
        }

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr && method === 'qr') {
                try {
                    currentQrBase64 = await qrcode.toDataURL(qr);
                    qrError = null;
                    reconnectAttempts = 0;
                } catch (err) {
                    console.error('[BOT] QR error:', err);
                }
            }
            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = statusCode === DisconnectReason.loggedOut;
                await destroySocket();
                if (loggedOut) {
                    isLinking = false;
                    currentQrBase64 = null;
                    pairingCode = null;
                    clearAuthSession();
                    return;
                }
                if (method === 'qr' && isQrExpiredError(lastDisconnect?.error)) {
                    currentQrBase64 = null;
                    scheduleReconnect(method, phoneNumber, 3000, { clearAuth: true });
                    return;
                }
                if (statusCode !== DisconnectReason.loggedOut) {
                    scheduleReconnect(method, phoneNumber, statusCode === DisconnectReason.restartRequired ? 1500 : 5000);
                } else {
                    isLinking = false;
                }
            } else if (connection === 'open') {
                isConnected = true;
                isLinking = false;
                currentQrBase64 = null;
                pairingCode = null;
                qrError = null;
                reconnectAttempts = 0;
                cancelScheduledReconnect();
                try {
                    const jid = `${normalizePhone(sock.user.id)}@s.whatsapp.net`;
                    await sock.sendMessage(jid, { text: 'Boxing Center Bot connecté ✅' });
                } catch (err) {
                    console.warn('[BOT] Confirmation:', err.message);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('lid-mapping.update', (update) => {
            if (!update || typeof update !== 'object') return;
            const entries = Array.isArray(update) ? update : Object.entries(update).map(([lid, pn]) => ({ lid, pn }));
            for (const entry of entries) {
                const lid = entry.lid || entry[0];
                const pn = entry.pn || entry[1];
                if (lid && pn) storeLidMapping(lid, pn);
            }
        });
        sock.ev.on('messages.upsert', async (m) => {
            await handleIncomingMessages(m);
        });
        sock.ev.on('messages.update', async (updates) => {
            await handleWhatsAppReadReceipts(updates);
        });
    } catch (error) {
        console.error('[BOT] Init error:', error);
        isLinking = false;
        qrError = 'Erreur de connexion.';
        await destroySocket();
    }
}

setTimeout(() => {
    if (hasRegisteredSession()) {
        connectToWhatsApp('qr');
    }
}, 3000);

// --- API ---

app.get('/api/status', (req, res) => {
    res.json({
        connected: isConnected,
        connecting: isLinking && !isConnected,
        qr: currentQrBase64,
        pairingCode,
        qrError,
        mandatoryPhone: MANDATORY_ADMIN_PHONE,
        authorizedPhones: getAllAuthorizedPhones(),
        siteUrl: SITE_URL,
    });
});

app.post('/api/start', (req, res) => {
    const { method, phone } = req.body || {};
    if (isConnected) return res.json({ success: true, message: 'Already connected' });
    const useMethod = method || 'qr';
    const pairingPhone = normalizePhone(phone);
    if (useMethod === 'pairing_code' && !pairingPhone) {
        return res.status(400).json({ error: 'Phone required for pairing code' });
    }
    if (useMethod === 'pairing_code' && !isValidPhoneDigits(pairingPhone)) {
        return res.status(400).json({ error: 'Numéro invalide (indicatif pays, chiffres uniquement)' });
    }
    cancelScheduledReconnect();
    reconnectAttempts = 0;
    qrError = null;
    pairingCode = null;

    // Réponse immédiate — évite timeout Vercel et bouton bloqué sur « Démarrage… »
    res.json({ success: true, message: 'Started connection process' });

    connectToWhatsApp(useMethod, pairingPhone || '', {
        force: true,
        clearAuth: useMethod === 'qr' || useMethod === 'pairing_code' || !hasRegisteredSession(),
    }).catch((err) => {
        console.error('[BOT] /api/start:', err);
        isLinking = false;
        qrError = err.message || 'Erreur de connexion.';
    });
});

app.post('/api/logout', async (req, res) => {
    cancelScheduledReconnect();
    reconnectAttempts = 0;
    isLinking = false;
    if (sock) {
        try {
            await sock.logout();
        } catch (e) {
            console.warn('[BOT] Logout:', e.message);
        }
    }
    await destroySocket();
    isConnected = false;
    currentQrBase64 = null;
    pairingCode = null;
    clearAuthSession();
    res.json({ success: true, message: 'Logged out' });
});

app.get('/api/managers', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        const managers = await fetchManagers({
            search: req.query.search || '',
            contactType: req.query.contact_type || req.query.contactType || '',
        });
        res.json({ managers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/managers/stats', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        res.json(await fetchManagerStats());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/managers/test', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        const manager = await fetchTestManager();
        res.json({ manager });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/promoteurs', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        const promoteurs = await fetchPromoteurs({
            search: req.query.search || '',
            contactType: req.query.contact_type || req.query.contactType || '',
        });
        res.json({ promoteurs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/promoteurs/stats', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        res.json(await fetchPromoteurStats());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/boxeurs', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        const boxeurs = await fetchBoxeurs({
            search: req.query.search || '',
            contactType: req.query.contact_type || req.query.contactType || '',
            categorie: req.query.categorie || '',
        });
        res.json({ boxeurs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/boxeurs/stats', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        res.json(await fetchBoxeurStats());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/email-status', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        res.json(await verifyEmailSetup());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/outbound-messages', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        const limit = parseInt(req.query.limit || '50', 10);
        const messages = await fetchOutboundMessages(limit);
        res.json({ messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/inbound-messages', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
        const messages = await fetchInboundMessages({ unreadOnly });
        res.json({ messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/inbound-messages/mark-read', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    try {
        const ids = req.body.ids || [];
        await markInboundRead(ids);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/send-message', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const { phone, message, manager_id: managerId } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    if (!phone) return res.status(400).json({ error: 'phone required' });
    try {
        const result = await sendWhatsAppMessage(phone, message, managerId || null);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/send-bulk', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const { phones, message } = req.body;
    if (!Array.isArray(phones) || !phones.length) {
        return res.status(400).json({ error: 'phones[] required' });
    }
    if (!message) return res.status(400).json({ error: 'message required' });
    const results = { sent: 0, failed: 0, errors: [], warnings: [] };
    for (const phone of phones) {
        if (!canSendWhatsAppBulkNow()) {
            results.warnings.push(
                `Limite horaire WhatsApp (${WA_BULK_MAX_PER_HOUR}/h) atteinte — envoi arrêté.`
            );
            results.failed += phones.length - results.sent - results.failed;
            break;
        }
        try {
            await sendWhatsAppMessage(phone, message);
            results.sent++;
            recordWhatsAppBulkSend();
            await sleepBetweenWhatsAppBulk();
        } catch (err) {
            results.failed++;
            results.errors.push({ phone, error: err.message });
            if (isWhatsAppRateLimitError(err.message)) {
                results.warnings.push('Envoi interrompu : restriction WhatsApp détectée.');
                break;
            }
        }
    }
    res.json({ success: true, ...results });
});

app.post('/api/send-email', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const { to, subject, html, text, manager_id: managerId, recipient_name: recipientName } = req.body;
    if (!to) return res.status(400).json({ error: 'to required' });
    try {
        const result = await sendBrevoEmail({
            to,
            subject,
            html,
            text,
            managerId,
            recipientName,
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function deliverToManager(mgr, { message, subject, html, channels, results }) {
    const mailSubject = subject || 'Message Boxing Center';
    const tasks = [];

    if (channels.includes('whatsapp')) {
        tasks.push((async () => {
            if (!mgr.telephone) {
                results.whatsapp.skipped++;
                return;
            }
            try {
                await sendWhatsAppMessage(mgr.telephone, message, mgr.id);
                results.whatsapp.sent++;
                results.destinations.push({
                    channel: 'whatsapp',
                    to: `+${normalizePhone(mgr.telephone)}`,
                    manager: mgr.nom,
                });
            } catch (err) {
                results.whatsapp.failed++;
                results.errors.push({ manager: mgr.nom, channel: 'whatsapp', error: err.message });
            }
        })());
    }

    if (channels.includes('email')) {
        tasks.push((async () => {
            if (!mgr.email) {
                results.email.skipped++;
                return;
            }
            try {
                const emailHtml = html || buildEmailHtml({
                    subject: mailSubject,
                    body: message,
                    recipientName: mgr.nom,
                });
                await sendBrevoEmail({
                    to: mgr.email,
                    subject: mailSubject,
                    html: emailHtml,
                    text: message,
                    managerId: mgr.id,
                    recipientName: mgr.nom,
                });
                results.email.sent++;
                results.destinations.push({
                    channel: 'email',
                    to: mgr.email,
                    manager: mgr.nom,
                });
            } catch (err) {
                results.email.failed++;
                results.errors.push({ manager: mgr.nom, channel: 'email', error: err.message });
            }
        })());
    }

    await Promise.all(tasks);
}

const { pickRandomOffreEteWhatsAppMessage } = require('./offreEteWhatsAppCampaign');
const RECENT_BULK_SENDS = new Map();
const BULK_SEND_DEDUP_MS = 15 * 60 * 1000;

/** Espacement envois WhatsApp — limite blocage anti-spam (~24 h). */
const WA_BULK_DELAY_MS = Math.max(15000, Number(process.env.WA_BULK_DELAY_MS) || 50000);
const WA_BULK_DELAY_JITTER_MS = Math.max(0, Number(process.env.WA_BULK_DELAY_JITTER_MS) || 20000);
const WA_BULK_MAX_PER_HOUR = Math.max(1, Number(process.env.WA_BULK_MAX_PER_HOUR) || 12);
const waBulkSendTimestamps = [];

function pruneWaBulkTimestamps() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    while (waBulkSendTimestamps.length && waBulkSendTimestamps[0] < cutoff) {
        waBulkSendTimestamps.shift();
    }
}

function canSendWhatsAppBulkNow() {
    pruneWaBulkTimestamps();
    return waBulkSendTimestamps.length < WA_BULK_MAX_PER_HOUR;
}

function recordWhatsAppBulkSend() {
    waBulkSendTimestamps.push(Date.now());
}

async function sleepBetweenWhatsAppBulk() {
    const jitter = WA_BULK_DELAY_JITTER_MS ? Math.floor(Math.random() * WA_BULK_DELAY_JITTER_MS) : 0;
    await new Promise((r) => setTimeout(r, WA_BULK_DELAY_MS + jitter));
}

function isWhatsAppRateLimitError(message) {
    const m = String(message || '').toLowerCase();
    return (
        m.includes('rate') ||
        m.includes('restrict') ||
        m.includes('ban') ||
        m.includes('spam') ||
        m.includes('too many') ||
        m.includes('blocked') ||
        m.includes('temporarily')
    );
}

function shouldParallelBulkDelivery(channels, count, testOnly) {
    if (testOnly) return true;
    if (channels.includes('whatsapp') && count > 1) return false;
    return count <= 3;
}

async function runBulkDelivery(recipients, deliverFn, ctx, { testOnly = false } = {}) {
    const { channels, results } = ctx;
    if (!results.warnings) results.warnings = [];

    if (shouldParallelBulkDelivery(channels, recipients.length, testOnly)) {
        await Promise.all(recipients.map((r) => deliverFn(r, ctx)));
        return;
    }

    for (let i = 0; i < recipients.length; i++) {
        if (channels.includes('whatsapp') && !testOnly && !canSendWhatsAppBulkNow()) {
            const remaining = recipients.length - i;
            results.whatsapp.skipped += remaining;
            results.warnings.push(
                `WhatsApp : limite horaire (${WA_BULK_MAX_PER_HOUR}/h) atteinte. ` +
                `${remaining} destinataire(s) non contacté(s) — utilisez l'email ou réessayez dans 1 h.`
            );
            break;
        }

        const sentBefore = results.whatsapp.sent;
        const errorsBefore = results.errors.length;

        await deliverFn(recipients[i], ctx);

        if (channels.includes('whatsapp')) {
            if (results.whatsapp.sent > sentBefore) {
                recordWhatsAppBulkSend();
            }
            const lastErr =
                results.errors.length > errorsBefore
                    ? results.errors[results.errors.length - 1]
                    : null;
            if (lastErr?.channel === 'whatsapp' && isWhatsAppRateLimitError(lastErr.error)) {
                const remaining = recipients.length - i - 1;
                if (remaining > 0) results.whatsapp.skipped += remaining;
                results.warnings.push(
                    'WhatsApp : envoi interrompu (limitation anti-spam). Attendez ~24 h ou passez par l\'email.'
                );
                break;
            }
            if (i < recipients.length - 1) {
                await sleepBetweenWhatsAppBulk();
            }
        }
    }
}

function pruneBulkSendDedup() {
    const now = Date.now();
    for (const [key, startedAt] of RECENT_BULK_SENDS) {
        if (now - startedAt > BULK_SEND_DEDUP_MS) RECENT_BULK_SENDS.delete(key);
    }
}

function bulkSendDedupKey(scope, body) {
    const ids =
        (Array.isArray(body.client_ids) && body.client_ids) ||
        (Array.isArray(body.manager_ids) && body.manager_ids) ||
        (Array.isArray(body.promoter_ids) && body.promoter_ids) ||
        (Array.isArray(body.boxeur_ids) && body.boxeur_ids) ||
        [];
    const payload = {
        scope,
        test: !!body.test_only,
        broadcast: body.broadcast || '',
        ids: [...ids].sort().join(','),
        channels: [...(body.channels || [])].sort().join(','),
        msg: String(body.message || '').slice(0, 400),
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function registerBulkSend(key) {
    pruneBulkSendDedup();
    if (RECENT_BULK_SENDS.has(key)) return false;
    RECENT_BULK_SENDS.set(key, Date.now());
    return true;
}

async function resolveManagersForSend({ managerIds, testOnly, broadcast }) {
    if (testOnly) {
        const test = await fetchTestManager();
        if (test) return [test];
        return [{
            nom: getTestContactLabel(),
            email: TEST_TARGET_EMAIL,
            telephone: TEST_TARGET_PHONE,
            id: null,
        }];
    }
    if (broadcast === 'email') return fetchManagersForBroadcast('email');
    if (broadcast === 'phone' || broadcast === 'whatsapp') {
        return fetchManagersForBroadcast('whatsapp');
    }
    if (broadcast === 'all') return fetchManagers({});
    if (Array.isArray(managerIds) && managerIds.length) {
        const managers = [];
        for (const id of managerIds) {
            const m = await fetchManagerById(id);
            if (m) managers.push(m);
        }
        return managers;
    }
    return null;
}

async function deliverManagersBatch(managers, { message, subject, html, channels, testOnly }) {
    const results = {
        whatsapp: { sent: 0, failed: 0, skipped: 0 },
        email: { sent: 0, failed: 0, skipped: 0 },
        errors: [],
        destinations: [],
        warnings: [],
    };
    const ctx = { message, subject, html, channels, results };
    await runBulkDelivery(managers, deliverToManager, ctx, { testOnly });
    return results;
}

app.post('/api/send-to-managers', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const {
        manager_ids: managerIds,
        message,
        subject,
        html,
        channels = ['whatsapp'],
        test_only: testOnly,
        broadcast,
    } = req.body;

    if (!message) return res.status(400).json({ error: 'message required' });
    if (!Array.isArray(channels) || !channels.length) {
        return res.status(400).json({ error: 'channels required' });
    }

    try {
        if (!testOnly) {
            const dedupKey = bulkSendDedupKey('managers', req.body);
            if (!registerBulkSend(dedupKey)) {
                return res.json({
                    success: true,
                    duplicate: true,
                    managers: 0,
                    whatsapp: { sent: 0, failed: 0, skipped: 0 },
                    email: { sent: 0, failed: 0, skipped: 0 },
                    errors: [],
                    destinations: [],
                    warnings: ['Envoi identique ignoré (déjà lancé il y a moins de 15 min).'],
                });
            }
        }

        const managers = await resolveManagersForSend({
            managerIds,
            testOnly,
            broadcast,
        });

        if (managers === null) {
            return res.status(400).json({ error: 'manager_ids, broadcast ou test_only requis' });
        }
        if (broadcast && !['email', 'phone', 'whatsapp', 'all'].includes(broadcast)) {
            return res.status(400).json({ error: 'broadcast invalide (email, phone, all)' });
        }
        if (!managers.length) {
            return res.status(400).json({ error: 'Aucun manager trouvé pour cet envoi' });
        }

        const waTargets = channels.includes('whatsapp')
            ? managers.filter((m) => m.telephone).length
            : 0;
        const runInBackground = channels.includes('whatsapp') && waTargets > 1 && !testOnly;

        if (runInBackground) {
            res.json({
                success: true,
                accepted: true,
                managers: managers.length,
                whatsapp: { sent: 0, queued: waTargets, failed: 0, skipped: managers.length - waTargets },
                email: { sent: 0, failed: 0, skipped: 0 },
                errors: [],
                destinations: [],
                warnings: [`Envoi WhatsApp démarré pour ${waTargets} numéro(s) — ~1 min entre chaque pour éviter le blocage.`],
            });
            setImmediate(() => {
                deliverManagersBatch(managers, {
                    message,
                    subject,
                    html,
                    channels,
                    testOnly,
                }).catch((err) => console.error('[send-to-managers] background:', err.message));
            });
            return;
        }

        const results = await deliverManagersBatch(managers, {
            message,
            subject,
            html,
            channels,
            testOnly,
        });
        res.json({ success: true, managers: managers.length, ...results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function deliverToClient(client, { message, subject, html, channels, results, offre_ete_whatsapp }) {
    const mailSubject = subject || 'Message Boxing Center';
    const label = clientDisplayName(client);
    const tasks = [];
    const waMessage = offre_ete_whatsapp
        ? pickRandomOffreEteWhatsAppMessage({
            prenom: client.prenom,
            nom: client.nom,
            salle: client.salle,
        })
        : message;

    if (channels.includes('whatsapp')) {
        tasks.push((async () => {
            if (!client.telephone) {
                results.whatsapp.skipped++;
                return;
            }
            try {
                await sendWhatsAppMessage(
                    client.telephone,
                    waMessage,
                    null,
                    null,
                    null,
                    client.id || null,
                    offre_ete_whatsapp ? OFFRE_ETE_CAMPAIGN_TAG : null
                );
                results.whatsapp.sent++;
                results.destinations.push({
                    channel: 'whatsapp',
                    to: `+${normalizePhone(client.telephone)}`,
                    client: label,
                });
            } catch (err) {
                results.whatsapp.failed++;
                results.errors.push({ client: label, channel: 'whatsapp', error: err.message });
            }
        })());
    }

    if (channels.includes('email')) {
        tasks.push((async () => {
            if (!client.email) {
                results.email.skipped++;
                return;
            }
            try {
                const emailHtml = html || buildEmailHtml({
                    subject: mailSubject,
                    body: message,
                    recipientName: label,
                });
                await sendBrevoEmail({
                    to: client.email,
                    subject: mailSubject,
                    html: emailHtml,
                    text: message,
                    recipientName: label,
                });
                results.email.sent++;
                results.destinations.push({
                    channel: 'email',
                    to: client.email,
                    client: label,
                });
            } catch (err) {
                results.email.failed++;
                results.errors.push({ client: label, channel: 'email', error: err.message });
            }
        })());
    }

    await Promise.all(tasks);
}

async function deliverClientsBatch(clients, { message, subject, html, channels, testOnly, offreEteWhatsapp }) {
    const results = {
        whatsapp: { sent: 0, failed: 0, skipped: 0 },
        email: { sent: 0, failed: 0, skipped: 0 },
        errors: [],
        destinations: [],
        warnings: [],
    };
    const ctx = { message, subject, html, channels, results, offre_ete_whatsapp: offreEteWhatsapp };
    await runBulkDelivery(clients, deliverToClient, ctx, { testOnly });
    return results;
}

async function resolveClientsForSend({ clientIds, testOnly, broadcast }) {
    if (testOnly) {
        return [{
            prenom: 'Test',
            nom: getTestContactLabel(),
            email: TEST_TARGET_EMAIL,
            telephone: TEST_TARGET_PHONE,
            id: null,
        }];
    }
    if (broadcast === 'email' || broadcast === 'phone' || broadcast === 'whatsapp' || broadcast === 'all') {
        const sb = getSupabase();
        const makeQuery = () => {
            let query = sb
                .from('portet_clients')
                .select('id, prenom, nom, telephone, email, salle')
                .order('created_at', { ascending: false });
            if (broadcast === 'email') {
                query = query.not('email', 'is', null).neq('email', '');
            } else if (broadcast === 'phone' || broadcast === 'whatsapp') {
                query = query.not('telephone', 'is', null).neq('telephone', '');
            }
            return query;
        };
        return fetchAllPaginated(makeQuery);
    }
    if (Array.isArray(clientIds) && clientIds.length) {
        return fetchClientsByIds(clientIds);
    }
    return null;
}

app.post('/api/send-to-clients', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const {
        client_ids: clientIds,
        message,
        subject,
        html,
        channels = ['whatsapp'],
        test_only: testOnly,
        broadcast,
        offre_ete_whatsapp: offreEteWhatsapp,
    } = req.body;

    if (!message && !offreEteWhatsapp) return res.status(400).json({ error: 'message required' });
    if (!Array.isArray(channels) || !channels.length) {
        return res.status(400).json({ error: 'channels required' });
    }

    try {
        if (!testOnly) {
            const dedupKey = bulkSendDedupKey('clients', req.body);
            if (!registerBulkSend(dedupKey)) {
                return res.json({
                    success: true,
                    duplicate: true,
                    clients: 0,
                    whatsapp: { sent: 0, failed: 0, skipped: 0 },
                    email: { sent: 0, failed: 0, skipped: 0 },
                    errors: [],
                    destinations: [],
                    warnings: ['Envoi identique ignoré (déjà lancé il y a moins de 15 min).'],
                });
            }
        }

        const isWaBroadcast =
            !testOnly &&
            channels.includes('whatsapp') &&
            (broadcast === 'phone' || broadcast === 'whatsapp' || broadcast === 'all');

        if (isWaBroadcast) {
            const waTargets = await countPortetClientsForBroadcast(
                broadcast === 'all' ? 'phone' : broadcast
            );
            if (!waTargets) {
                return res.status(400).json({ error: 'Aucun client trouvé pour cet envoi' });
            }

            res.json({
                success: true,
                accepted: true,
                clients: waTargets,
                whatsapp: { sent: 0, queued: waTargets, failed: 0, skipped: 0 },
                email: { sent: 0, failed: 0, skipped: 0 },
                errors: [],
                destinations: [],
                warnings: [
                    `Envoi WhatsApp démarré pour ${waTargets} numéro(s) sur Bothosting — ` +
                        `~12 messages/heure max (anti-spam WhatsApp).`,
                    'Chaque message : prénom + variante aléatoire parmi 14 textes.',
                ],
            });

            setImmediate(() => {
                (async () => {
                    if (!isConnected || !sock) {
                        console.error('[send-to-clients] background annulé : WhatsApp non connecté');
                        return;
                    }
                    try {
                        const clients = await resolveClientsForSend({
                            clientIds,
                            testOnly: false,
                            broadcast,
                        });
                        console.log(
                            `[send-to-clients] background démarré — ${clients.length} client(s), WA connecté`
                        );
                        const results = await deliverClientsBatch(clients, {
                            message,
                            subject,
                            html,
                            channels,
                            testOnly: false,
                            offreEteWhatsapp,
                        });
                        console.log(
                            `[send-to-clients] background terminé — WA envoyés: ${results.whatsapp.sent}, ` +
                                `échecs: ${results.whatsapp.failed}, ignorés: ${results.whatsapp.skipped}`
                        );
                    } catch (err) {
                        console.error('[send-to-clients] background:', err.message);
                    }
                })();
            });
            return;
        }

        const clients = await resolveClientsForSend({ clientIds, testOnly, broadcast });
        if (clients === null) {
            return res.status(400).json({ error: 'client_ids, broadcast ou test_only requis' });
        }
        if (broadcast && !['email', 'phone', 'whatsapp', 'all'].includes(broadcast)) {
            return res.status(400).json({ error: 'broadcast invalide (email, phone, all)' });
        }
        if (!clients.length) {
            return res.status(400).json({ error: 'Aucun client trouvé pour cet envoi' });
        }

        const waTargets = channels.includes('whatsapp')
            ? clients.filter((c) => c.telephone).length
            : 0;
        const runInBackground = channels.includes('whatsapp') && waTargets > 1 && !testOnly;

        if (runInBackground) {
            res.json({
                success: true,
                accepted: true,
                clients: clients.length,
                whatsapp: { sent: 0, queued: waTargets, failed: 0, skipped: clients.length - waTargets },
                email: { sent: 0, failed: 0, skipped: 0 },
                errors: [],
                destinations: [],
                warnings: [
                    `Envoi WhatsApp démarré pour ${waTargets} numéro(s) sur Bothosting — ` +
                        `~12 messages/heure max (anti-spam WhatsApp).`,
                    'Chaque message : prénom + variante aléatoire parmi 14 textes.',
                ],
            });
            setImmediate(() => {
                deliverClientsBatch(clients, {
                    message,
                    subject,
                    html,
                    channels,
                    testOnly,
                    offreEteWhatsapp,
                }).catch((err) => console.error('[send-to-clients] background:', err.message));
            });
            return;
        }

        const results = await deliverClientsBatch(clients, {
            message,
            subject,
            html,
            channels,
            testOnly,
            offreEteWhatsapp,
        });
        res.json({ success: true, clients: clients.length, ...results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function deliverToPromoteur(prom, { message, subject, html, channels, results }) {
    const mailSubject = subject || 'Message Boxing Center';
    const tasks = [];

    if (channels.includes('whatsapp')) {
        tasks.push((async () => {
            if (!prom.telephone) {
                results.whatsapp.skipped++;
                return;
            }
            try {
                await sendWhatsAppMessage(prom.telephone, message, null, prom.id);
                results.whatsapp.sent++;
                results.destinations.push({
                    channel: 'whatsapp',
                    to: `+${normalizePhone(prom.telephone)}`,
                    promoter: prom.nom,
                });
            } catch (err) {
                results.whatsapp.failed++;
                results.errors.push({ promoter: prom.nom, channel: 'whatsapp', error: err.message });
            }
        })());
    }

    if (channels.includes('email')) {
        tasks.push((async () => {
            if (!prom.email) {
                results.email.skipped++;
                return;
            }
            try {
                const emailHtml = html || buildEmailHtml({
                    subject: mailSubject,
                    body: message,
                    recipientName: prom.nom,
                });
                await sendBrevoEmail({
                    to: prom.email,
                    subject: mailSubject,
                    html: emailHtml,
                    text: message,
                    promoterId: prom.id,
                    recipientName: prom.nom,
                });
                results.email.sent++;
                results.destinations.push({
                    channel: 'email',
                    to: prom.email,
                    promoter: prom.nom,
                });
            } catch (err) {
                results.email.failed++;
                results.errors.push({ promoter: prom.nom, channel: 'email', error: err.message });
            }
        })());
    }

    await Promise.all(tasks);
}

app.post('/api/send-to-promoteurs', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const {
        promoter_ids: promoterIds,
        message,
        subject,
        html,
        channels = ['whatsapp'],
        test_only: testOnly,
        broadcast,
    } = req.body;

    if (!message) return res.status(400).json({ error: 'message required' });
    if (!Array.isArray(channels) || !channels.length) {
        return res.status(400).json({ error: 'channels required' });
    }

    try {
        let promoteurs = [];
        if (testOnly) {
            const test = await fetchTestPromoteur();
            if (test) {
                promoteurs = [test];
            } else {
                const fallback = await fetchTestManager();
                promoteurs = fallback
                    ? [fallback]
                    : [{
                        nom: getTestContactLabel(),
                        email: TEST_TARGET_EMAIL,
                        telephone: TEST_TARGET_PHONE,
                        id: null,
                    }];
            }
        } else if (broadcast) {
            if (broadcast === 'email') {
                promoteurs = await fetchPromoteursForBroadcast('email');
            } else if (broadcast === 'phone' || broadcast === 'whatsapp') {
                promoteurs = await fetchPromoteursForBroadcast('whatsapp');
            } else if (broadcast === 'all') {
                promoteurs = await fetchPromoteurs({});
            } else {
                return res.status(400).json({ error: 'broadcast invalide (email, phone, all)' });
            }
        } else if (Array.isArray(promoterIds) && promoterIds.length) {
            for (const id of promoterIds) {
                const p = await fetchPromoteurById(id);
                if (p) promoteurs.push(p);
            }
        } else {
            return res.status(400).json({ error: 'promoter_ids, broadcast ou test_only requis' });
        }

        if (!promoteurs.length) {
            return res.status(400).json({ error: 'Aucun promoteur trouvé pour cet envoi' });
        }

        const results = {
            whatsapp: { sent: 0, failed: 0, skipped: 0 },
            email: { sent: 0, failed: 0, skipped: 0 },
            errors: [],
            destinations: [],
            warnings: [],
        };

        const ctx = { message, subject, html, channels, results };
        await runBulkDelivery(promoteurs, deliverToPromoteur, ctx, { testOnly });

        res.json({ success: true, promoteurs: promoteurs.length, ...results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function deliverToBoxeur(boxeur, { message, subject, html, channels, results }) {
    const mailSubject = subject || 'Message Boxing Center';
    const tasks = [];

    if (channels.includes('whatsapp')) {
        tasks.push((async () => {
            if (!boxeur.telephone) {
                results.whatsapp.skipped++;
                return;
            }
            try {
                await sendWhatsAppMessage(boxeur.telephone, message, null, null, boxeur.id);
                results.whatsapp.sent++;
                results.destinations.push({
                    channel: 'whatsapp',
                    to: `+${normalizePhone(boxeur.telephone)}`,
                    boxeur: boxeur.nom,
                });
            } catch (err) {
                results.whatsapp.failed++;
                results.errors.push({ boxeur: boxeur.nom, channel: 'whatsapp', error: err.message });
            }
        })());
    }

    if (channels.includes('email')) {
        tasks.push((async () => {
            if (!boxeur.email) {
                results.email.skipped++;
                return;
            }
            try {
                const emailHtml = html || buildEmailHtml({
                    subject: mailSubject,
                    body: message,
                    recipientName: boxeur.nom,
                });
                await sendBrevoEmail({
                    to: boxeur.email,
                    subject: mailSubject,
                    html: emailHtml,
                    text: message,
                    boxeurId: boxeur.id,
                    recipientName: boxeur.nom,
                });
                results.email.sent++;
                results.destinations.push({
                    channel: 'email',
                    to: boxeur.email,
                    boxeur: boxeur.nom,
                });
            } catch (err) {
                results.email.failed++;
                results.errors.push({ boxeur: boxeur.nom, channel: 'email', error: err.message });
            }
        })());
    }

    await Promise.all(tasks);
}

app.post('/api/send-to-boxeurs', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const {
        boxeur_ids: boxeurIds,
        message,
        subject,
        html,
        channels = ['whatsapp'],
        test_only: testOnly,
        broadcast,
        categorie,
    } = req.body;

    if (!message) return res.status(400).json({ error: 'message required' });
    if (!Array.isArray(channels) || !channels.length) {
        return res.status(400).json({ error: 'channels required' });
    }

    try {
        let boxeurs = [];
        if (testOnly) {
            const test = await fetchTestBoxeur();
            if (test) {
                boxeurs = [test];
            } else {
                const fallback = await fetchTestManager();
                boxeurs = fallback
                    ? [fallback]
                    : [{
                        nom: getTestContactLabel(),
                        email: TEST_TARGET_EMAIL,
                        telephone: TEST_TARGET_PHONE,
                        id: null,
                    }];
            }
        } else if (broadcast) {
            if (broadcast === 'email') {
                boxeurs = await fetchBoxeursForBroadcast('email', categorie || '');
            } else if (broadcast === 'phone' || broadcast === 'whatsapp') {
                boxeurs = await fetchBoxeursForBroadcast('whatsapp', categorie || '');
            } else if (broadcast === 'all') {
                boxeurs = await fetchBoxeurs({ categorie: categorie || '' });
            } else {
                return res.status(400).json({ error: 'broadcast invalide (email, phone, all)' });
            }
        } else if (Array.isArray(boxeurIds) && boxeurIds.length) {
            for (const id of boxeurIds) {
                const b = await fetchBoxeurById(id);
                if (b) boxeurs.push(b);
            }
        } else {
            return res.status(400).json({ error: 'boxeur_ids, broadcast ou test_only requis' });
        }

        if (!boxeurs.length) {
            return res.status(400).json({ error: 'Aucun boxeur trouvé pour cet envoi' });
        }

        const results = {
            whatsapp: { sent: 0, failed: 0, skipped: 0 },
            email: { sent: 0, failed: 0, skipped: 0 },
            errors: [],
            destinations: [],
            warnings: [],
        };

        const ctx = { message, subject, html, channels, results };
        await runBulkDelivery(boxeurs, deliverToBoxeur, ctx, { testOnly });

        res.json({ success: true, boxeurs: boxeurs.length, ...results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function deliverToGroupeChabaneContact(contact, { message, channels, results }) {
    const tasks = [];
    if (channels.includes('whatsapp')) {
        tasks.push((async () => {
            if (!contact.telephone) {
                results.whatsapp.skipped++;
                return;
            }
            try {
                await sendWhatsAppMessage(contact.telephone, message);
                results.whatsapp.sent++;
                results.destinations.push({
                    channel: 'whatsapp',
                    to: `+${normalizePhone(contact.telephone)}`,
                    contact: contact.nom || contact.telephone,
                });
            } catch (err) {
                results.whatsapp.failed++;
                results.errors.push({
                    contact: contact.nom || contact.telephone,
                    channel: 'whatsapp',
                    error: err.message,
                });
            }
        })());
    }
    await Promise.all(tasks);
}

app.post('/api/send-to-groupe-chabane', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const {
        contact_ids: contactIds,
        message,
        channels = ['whatsapp'],
        test_only: testOnly,
        broadcast,
    } = req.body;

    if (!message) return res.status(400).json({ error: 'message required' });
    if (!Array.isArray(channels) || !channels.length) {
        return res.status(400).json({ error: 'channels required' });
    }
    if (channels.includes('email')) {
        return res.status(400).json({ error: 'Groupe Chabane : WhatsApp uniquement' });
    }

    try {
        const contacts = resolveGroupeChabaneForSend({
            contact_ids: contactIds,
            test_only: testOnly,
            broadcast,
        });

        if (!contacts.length) {
            return res.status(400).json({
                error: 'contact_ids, broadcast=all ou test_only requis',
            });
        }

        const results = {
            whatsapp: { sent: 0, failed: 0, skipped: 0 },
            email: { sent: 0, failed: 0, skipped: 0 },
            errors: [],
            destinations: [],
            warnings: [],
        };

        const ctx = { message, channels, results };
        await runBulkDelivery(contacts, deliverToGroupeChabaneContact, ctx, { testOnly });

        res.json({ success: true, contacts: contacts.length, ...results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || process.env.SERVER_PORT || 3002;

function logBotUrlForVercel(port) {
    const botUrl = `http://us2.bot-hosting.net:${port}`;
    console.log('\n🌍 ==================================================');
    console.log('🌍 URL BOT pour Vercel (NEXT_PUBLIC_WHATSAPP_BOT_URL) :');
    console.log(`🌍   ${botUrl}`);
    try {
        const https = require('https');
        https
            .get('https://api.ipify.org', (res) => {
                let data = '';
                res.on('data', (c) => {
                    data += c;
                });
                res.on('end', () => {
                    console.log(`🌍   (IP : http://${data.trim()}:${port})`);
                    console.log('🌍 ==================================================\n');
                });
            })
            .on('error', () => {
                console.log('🌍 ==================================================\n');
            });
    } catch {
        console.log('🌍 ==================================================\n');
    }
}

app.listen(PORT, () => {
    console.log(`Boxing Center Bot — port ${PORT}`);
    console.log(`Site : ${SITE_URL}`);
    logBotUrlForVercel(PORT);
});
