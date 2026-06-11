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
    fetchUnreadInbound,
    fetchInboundMessages,
    fetchOutboundMessages,
    saveInboundMessage,
    markInboundRead,
    createOutboundMessage,
    updateOutboundMessage,
} = require('./supabase');
const { sendBrevoEmail, buildEmailHtml, verifyEmailSetup } = require('./email');

const app = express();
app.use(cors());
app.use(express.json());

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
const RECEPTION_EMAIL = process.env.RECEPTION_EMAIL || process.env.BREVO_REPLY_TO || 'angoularaphael05@gmail.com';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'suzinabot@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Boxing Center';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const TEST_TARGET_PHONE = '237693646080';
const TEST_TARGET_EMAIL = 'linuxcam05@gmail.com';
const WA_MAX_LEN = 3800;

function normalizePhone(input) {
    if (!input) return '';
    return String(input).split('@')[0].split(':')[0].replace(/\D/g, '');
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

function getAllAuthorizedPhones() {
    const extra = (botConfig.authorizedPhones || [])
        .map(normalizePhone)
        .filter((p) => p && p !== MANDATORY_ADMIN_PHONE);
    return [...new Set([MANDATORY_ADMIN_PHONE, ...extra])];
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
    '.nonlus', '.unread',
    '.stats',
    '.authorise', '.authorize', '.autorise',
    '.unauthorise', '.unauthorize', '.unautorise',
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
        '',
        '*Managers*',
        '`.numeros`',
        '`.emails`',
        '`.stats`',
        '`.nonlus`',
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
        '',
        '*Managers*',
        '• `.numeros` / `.phones` — Managers avec téléphone',
        '• `.emails` — Managers avec email',
        '• `.stats` — Statistiques contacts',
        '• `.nonlus` / `.unread` — Messages WhatsApp non lus',
        '',
        '*Tests & admin*',
        `• \`.test\` — Envoi test WA + email (atangana : ${TEST_TARGET_PHONE} / ${TEST_TARGET_EMAIL})`,
        '• `.authorise NUMERO` — Autoriser un admin WhatsApp',
        '• `.unauthorise NUMERO` — Retirer un admin',
        '',
        '*Console web*',
        `• ${SITE_URL}`,
        `• Emails managers via Brevo (${SENDER_EMAIL})`,
        `• Réponses / contact : ${RECEPTION_EMAIL}`,
        '',
        '*Exemples*',
        '`.authorise 33762641473`',
        '`.stats`',
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
    const name = testMgr?.nom || 'atangana';
    const subject = 'Test Boxing Center';
    const message = '🥊 Test d\'envoi Boxing Center — si vous recevez ce message, le canal fonctionne.';

    const results = { whatsapp: '—', email: '—' };

    try {
        await sendWhatsAppMessage(phone, message, managerId);
        results.whatsapp = `✅ +${phone}`;
    } catch (err) {
        results.whatsapp = `❌ ${err.message}`;
    }

    try {
        const html = buildEmailHtml({ subject, body: message, recipientName: name });
        await sendBrevoEmail({ to: email, subject, html, text: message, managerId });
        results.email = `✅ ${email}`;
    } catch (err) {
        results.email = `❌ ${err.message}`;
    }

    return { results, phone, email, name };
}

function formatPhoneList(rows, total) {
    const lines = [`📞 *Managers avec téléphone* — ${total} au total`, ''];
    if (!rows.length) {
        lines.push('Aucun manager avec numéro.');
        return lines.join('\n');
    }
    rows.forEach((r, i) => {
        lines.push(`${i + 1}. *${r.nom}* — ${r.telephone || '—'}`);
    });
    if (total > rows.length) {
        lines.push('', `_(échantillon ${rows.length}/${total})_`);
    }
    return lines.join('\n');
}

function formatEmailList(rows, total) {
    const lines = [`📧 *Managers avec email* — ${total} au total`, ''];
    if (!rows.length) {
        lines.push('Aucun manager avec email.');
        return lines.join('\n');
    }
    rows.forEach((r, i) => {
        lines.push(`${i + 1}. *${r.nom}* — ${r.email || '—'}`);
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

function formatStats(stats) {
    return [
        '📊 *Statistiques managers*',
        '',
        `Total : *${stats.total}*`,
        `Avec téléphone : *${stats.withPhone}*`,
        `Avec email : *${stats.withEmail}*`,
        `Les deux : *${stats.both}*`,
        `Téléphone seul : *${stats.phoneOnly}*`,
        `Email seul : *${stats.emailOnly}*`,
        `Sans contact : *${stats.none}*`,
    ].join('\n');
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

async function sendWhatsAppMessage(phone, message, managerId = null) {
    if (!isConnected || !sock) {
        throw new Error('WhatsApp non connecté');
    }
    const cleanNumber = normalizePhone(phone);
    const record = await createOutboundMessage({
        manager_id: managerId,
        channel: 'whatsapp',
        recipient: cleanNumber,
        subject: null,
        body: message,
        status: 'pending',
    });
    try {
        const jid = `${cleanNumber}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        await updateOutboundMessage(record.id, {
            status: 'sent',
            sent_at: new Date().toISOString(),
        });
        return { success: true, id: record.id, phone: cleanNumber };
    } catch (err) {
        await updateOutboundMessage(record.id, {
            status: 'failed',
            error: err.message,
        });
        throw err;
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
                if (!isSenderAuthorized(msg)) {
                    await sock.sendMessage(sender, { text: '⛔ Non autorisé. Tapez `.menu`.' });
                    continue;
                }
                await sendGuide(sender);
                continue;
            }

            if (cmd === '.ping') {
                await sock.sendMessage(sender, {
                    text: `🏓 Pong — Boxing Center Bot en ligne.\nConsole : ${SITE_URL}`,
                });
                continue;
            }

            if (!isSenderAuthorized(msg)) {
                await sock.sendMessage(sender, { text: '⛔ Non autorisé.' });
                continue;
            }

            if (cmd === '.numeros' || cmd === '.phones') {
                const stats = await fetchManagerStats();
                const sample = await fetchManagersWithPhone(10);
                await sendLongMessage(sender, formatPhoneList(sample, stats.withPhone));
            } else if (cmd === '.emails') {
                const stats = await fetchManagerStats();
                const sample = await fetchManagersWithEmail(10);
                await sendLongMessage(sender, formatEmailList(sample, stats.withEmail));
            } else if (cmd === '.nonlus' || cmd === '.unread') {
                const unread = await fetchUnreadInbound();
                await sendLongMessage(sender, formatUnreadList(unread));
            } else if (cmd === '.stats') {
                const stats = await fetchManagerStats();
                await sendLongMessage(sender, formatStats(stats));
            } else if (cmd === '.test' || cmd === '.testenvoi') {
                await sock.sendMessage(sender, { text: '🧪 Envoi test en cours (atangana)…' });
                const { results, phone, email, name } = await runTestEnvoi();
                await sock.sendMessage(sender, {
                    text: [
                        '🧪 *Test envoi — atangana*',
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

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            browser: ['Boxing Center Bot', 'Chrome', '120.0.0.0'],
            qrTimeout: 60000,
            connectTimeoutMs: 60000,
        });

        if (method === 'pairing_code' && phoneNumber && !sock.authState.creds.me) {
            setTimeout(async () => {
                if (!sock || isConnected) return;
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
                } catch (err) {
                    qrError = 'Code d\'association impossible.';
                    isLinking = false;
                }
            }, 3000);
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
                if (isQrExpiredError(lastDisconnect?.error)) {
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
    if (method === 'pairing_code' && !phone) {
        return res.status(400).json({ error: 'Phone required for pairing code' });
    }
    cancelScheduledReconnect();
    reconnectAttempts = 0;
    qrError = null;
    const useMethod = method || 'qr';

    // Réponse immédiate — évite timeout Vercel et bouton bloqué sur « Démarrage… »
    res.json({ success: true, message: 'Started connection process' });

    connectToWhatsApp(useMethod, phone || '', {
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
    const results = { sent: 0, failed: 0, errors: [] };
    for (const phone of phones) {
        try {
            await sendWhatsAppMessage(phone, message);
            results.sent++;
            await new Promise((r) => setTimeout(r, 1500));
        } catch (err) {
            results.failed++;
            results.errors.push({ phone, error: err.message });
        }
    }
    res.json({ success: true, ...results });
});

app.post('/api/send-email', async (req, res) => {
    if (!verifyApiSecret(req, res)) return;
    const { to, subject, html, text, manager_id: managerId } = req.body;
    if (!to) return res.status(400).json({ error: 'to required' });
    try {
        const result = await sendBrevoEmail({ to, subject, html, text, managerId });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
        let managers = [];
        if (testOnly) {
            const test = await fetchTestManager();
            if (test) {
                managers = [test];
            } else {
                managers = [{
                    nom: 'atangana',
                    email: TEST_TARGET_EMAIL,
                    telephone: TEST_TARGET_PHONE,
                    id: null,
                }];
            }
        } else if (broadcast) {
            if (broadcast === 'email') {
                managers = await fetchManagersForBroadcast('email');
            } else if (broadcast === 'phone' || broadcast === 'whatsapp') {
                managers = await fetchManagersForBroadcast('whatsapp');
            } else if (broadcast === 'all') {
                managers = await fetchManagers({});
            } else {
                return res.status(400).json({ error: 'broadcast invalide (email, phone, all)' });
            }
        } else if (Array.isArray(managerIds) && managerIds.length) {
            for (const id of managerIds) {
                const m = await fetchManagerById(id);
                if (m) managers.push(m);
            }
        } else {
            return res.status(400).json({ error: 'manager_ids, broadcast ou test_only requis' });
        }

        if (!managers.length) {
            return res.status(400).json({ error: 'Aucun manager trouvé pour cet envoi' });
        }

        const results = {
            whatsapp: { sent: 0, failed: 0, skipped: 0 },
            email: { sent: 0, failed: 0, skipped: 0 },
            errors: [],
            destinations: [],
        };

        for (const mgr of managers) {
            if (channels.includes('whatsapp')) {
                if (!mgr.telephone) {
                    results.whatsapp.skipped++;
                } else {
                    try {
                        await sendWhatsAppMessage(mgr.telephone, message, mgr.id);
                        results.whatsapp.sent++;
                        results.destinations.push({
                            channel: 'whatsapp',
                            to: `+${normalizePhone(mgr.telephone)}`,
                            manager: mgr.nom,
                        });
                        await new Promise((r) => setTimeout(r, 1500));
                    } catch (err) {
                        results.whatsapp.failed++;
                        results.errors.push({ manager: mgr.nom, channel: 'whatsapp', error: err.message });
                    }
                }
            }
            if (channels.includes('email')) {
                if (!mgr.email) {
                    results.email.skipped++;
                } else {
                    try {
                        const emailHtml = html || buildEmailHtml({
                            subject: subject || 'Message Boxing Center',
                            body: message,
                            recipientName: mgr.nom,
                        });
                        await sendBrevoEmail({
                            to: mgr.email,
                            subject: subject || 'Message Boxing Center',
                            html: emailHtml,
                            text: message,
                            managerId: mgr.id,
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
                }
            }
        }

        if (testOnly && channels.includes('email') && RECEPTION_EMAIL) {
            const copyTo = RECEPTION_EMAIL.trim().toLowerCase();
            const alreadySent = results.destinations.some(
                (d) => d.channel === 'email' && d.to?.toLowerCase() === copyTo
            );
            if (!alreadySent) {
                try {
                    const copyHtml = html || buildEmailHtml({
                        subject: subject || 'Message Boxing Center',
                        body: message,
                        recipientName: 'Copie test',
                    });
                    await sendBrevoEmail({
                        to: RECEPTION_EMAIL,
                        subject: `[Copie test] ${subject || 'Message Boxing Center'}`,
                        html: copyHtml,
                        text: message,
                        managerId: null,
                    });
                    results.email.sent++;
                    results.destinations.push({
                        channel: 'email',
                        to: RECEPTION_EMAIL,
                        manager: 'copie réception (test)',
                    });
                } catch (err) {
                    results.email.failed++;
                    results.errors.push({ manager: 'copie réception', channel: 'email', error: err.message });
                }
            }
        }

        res.json({ success: true, managers: managers.length, ...results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || process.env.SERVER_PORT || 3002;
app.listen(PORT, () => {
    console.log(`Boxing Center Bot — port ${PORT}`);
    console.log(`Site : ${SITE_URL}`);
});
