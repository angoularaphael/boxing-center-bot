const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const VCARD_BLOCK_RE = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;

function normalizePhoneDigits(input) {
    if (!input) return '';
    return String(input).replace(/\D/g, '');
}

function isValidPhoneDigits(digits) {
    return digits.length >= 9 && digits.length <= 15;
}

function parseVCardBlock(block) {
    const lines = String(block).split(/\r?\n/);
    let name = '';
    let phone = '';
    for (const line of lines) {
        const upper = line.toUpperCase();
        if (upper.startsWith('FN:')) {
            name = line.slice(3).trim();
        } else if (upper.startsWith('N:') && !name) {
            const parts = line.slice(2).split(';').map((p) => p.trim()).filter(Boolean);
            name = parts.join(' ').trim();
        } else if (upper.includes('TEL')) {
            const waid = line.match(/waid=(\d+)/i);
            const raw = waid ? waid[1] : line.split(':').pop();
            const digits = normalizePhoneDigits(raw);
            if (isValidPhoneDigits(digits)) phone = digits;
        }
    }
    if (!phone) return null;
    return { nom: name || '', telephone: phone };
}

function parseVCardsFromText(text) {
    const contacts = [];
    const blocks = String(text || '').match(VCARD_BLOCK_RE) || [];
    for (const block of blocks) {
        const parsed = parseVCardBlock(block);
        if (parsed) contacts.push(parsed);
    }
    return contacts;
}

function parseContactMessage(message) {
    const contacts = [];
    if (!message) return contacts;

    const single = message.contactMessage;
    if (single?.vcard) {
        const parsed = parseVCardBlock(single.vcard);
        if (parsed) {
            contacts.push({
                nom: parsed.nom || single.displayName || '',
                telephone: parsed.telephone,
            });
        }
    }

    const array = message.contactsArrayMessage;
    if (array?.contacts?.length) {
        for (const item of array.contacts) {
            if (!item?.vcard) continue;
            const parsed = parseVCardBlock(item.vcard);
            if (parsed) {
                contacts.push({
                    nom: parsed.nom || item.displayName || '',
                    telephone: parsed.telephone,
                });
            }
        }
    }

    return contacts;
}

function looksLikePhoneLine(line) {
    const digits = normalizePhoneDigits(line);
    return isValidPhoneDigits(digits);
}

function parsePlainTextContacts(text) {
    const contacts = [];
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!looksLikePhoneLine(line)) continue;
        const phone = normalizePhoneDigits(line);
        let name = '';
        const prev = lines[i - 1];
        const next = lines[i + 1];
        if (prev && !looksLikePhoneLine(prev) && !prev.startsWith('BEGIN:')) name = prev;
        else if (next && !looksLikePhoneLine(next) && !next.startsWith('END:')) name = next;
        contacts.push({ nom: name, telephone: phone });
    }

    const inline = String(text || '').match(PHONE_RE) || [];
    for (const match of inline) {
        const phone = normalizePhoneDigits(match);
        if (!isValidPhoneDigits(phone)) continue;
        contacts.push({ nom: '', telephone: phone });
    }

    return contacts;
}

function dedupeContacts(contacts) {
    const seen = new Set();
    const out = [];
    for (const c of contacts) {
        const phone = normalizePhoneDigits(c.telephone);
        if (!isValidPhoneDigits(phone) || seen.has(phone)) continue;
        seen.add(phone);
        out.push({
            nom: (c.nom || '').trim(),
            telephone: phone,
        });
    }
    return out;
}

function extractContactsFromWaMessage(message) {
    if (!message) return [];
    const fromCards = parseContactMessage(message);
    const textParts = [];
    if (message.conversation) textParts.push(message.conversation);
    if (message.extendedTextMessage?.text) textParts.push(message.extendedTextMessage.text);
    if (message.imageMessage?.caption) textParts.push(message.imageMessage.caption);
    const text = textParts.join('\n');
    const fromVcards = parseVCardsFromText(text);
    const fromPlain = parsePlainTextContacts(text);
    return dedupeContacts([...fromCards, ...fromVcards, ...fromPlain]);
}

function getQuotedMessage(msg) {
    const m = msg?.message;
    if (!m) return null;
    const ctx =
        m.extendedTextMessage?.contextInfo ||
        m.imageMessage?.contextInfo ||
        m.videoMessage?.contextInfo ||
        m.documentMessage?.contextInfo ||
        m.conversation?.contextInfo;
    return ctx?.quotedMessage || null;
}

function extractContactsFromIncomingMessage(msg, { preferQuoted = true } = {}) {
    const quoted = getQuotedMessage(msg);
    if (preferQuoted && quoted) {
        const fromQuoted = extractContactsFromWaMessage(quoted);
        if (fromQuoted.length) return fromQuoted;
    }
    return extractContactsFromWaMessage(msg.message);
}

function escapeCsvField(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function buildContactsCsv(contacts) {
    const lines = ['nom,telephone'];
    for (const c of contacts) {
        lines.push(`${escapeCsvField(c.nom || '')},${escapeCsvField(c.telephone)}`);
    }
    return `${lines.join('\n')}\n`;
}

function formatContactsCsvSummary(contacts) {
    const withName = contacts.filter((c) => c.nom).length;
    return [
        '📇 *Export contacts → CSV*',
        '',
        `Total : *${contacts.length}* contact${contacts.length > 1 ? 's' : ''}`,
        `Avec nom : ${withName}`,
        '',
        'Fichier CSV joint ci-dessous.',
    ].join('\n');
}

module.exports = {
    buildContactsCsv,
    extractContactsFromIncomingMessage,
    formatContactsCsvSummary,
    getQuotedMessage,
};
