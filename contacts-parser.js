/**
 * Parse WhatsApp contacts (vCard, contactMessage, texte collé) → { name, phone }[]
 */

function digitsOnly(input) {
    return String(input || '').replace(/\D/g, '');
}

function formatPhoneInternational(input) {
    let d = digitsOnly(input);
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('33')) return `+${d}`;
    if (d.length === 12 && d.startsWith('237')) return `+${d}`;
    if (d.length === 10 && d.startsWith('0')) return `+33${d.slice(1)}`;
    if (d.length === 9 && /^[67]/.test(d)) return `+33${d}`;
    if (d.length >= 9 && d.length <= 15) return `+${d}`;
    return '';
}

function parseVcard(vcard, displayName = '') {
    if (!vcard) {
        const phone = formatPhoneInternational(displayName);
        if (phone) return [{ name: '', phone }];
        return displayName ? [{ name: displayName, phone: '' }] : [];
    }
    const raw = String(vcard);
    const fn =
        raw.match(/^FN:(.+)$/im)?.[1]?.trim()
        || displayName
        || raw.match(/^N:;?([^;]*)/im)?.[1]?.trim()
        || '';
    const telMatches = [...raw.matchAll(/^TEL[^:]*:(.+)$/gim)].map((m) => m[1].trim());
    if (!telMatches.length) {
        const waid = raw.match(/waid=(\d+)/i);
        if (waid) telMatches.push(waid[1]);
    }
    if (!telMatches.length) {
        return fn ? [{ name: fn, phone: '' }] : [];
    }
    return telMatches.map((tel) => ({
        name: fn,
        phone: formatPhoneInternational(tel),
    })).filter((c) => c.phone || c.name);
}

const PHONE_RE = /(?:\+?(?:33|237)\s?)?(?:0\s?(?:[67])(?:[\s.\-]?\d{2}){4}|[67](?:[\s.\-]?\d{2}){4}|\d{2}(?:[\s.\-]?\d{2}){4,5})/gi;

function parseContactText(text) {
    if (!text || !String(text).trim()) return [];
    const results = [];
    const str = String(text);

    const vcardBlocks = str.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [];
    for (const block of vcardBlocks) {
        results.push(...parseVcard(block));
    }

    const withoutVcards = str.replace(/BEGIN:VCARD[\s\S]*?END:VCARD/gi, '\n');
    for (const line of withoutVcards.split(/\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const phones = [...trimmed.matchAll(PHONE_RE)].map((m) => m[0]);
        if (!phones.length) continue;
        for (const rawPhone of phones) {
            const phone = formatPhoneInternational(rawPhone);
            if (!phone) continue;
            let name = trimmed;
            for (const p of phones) {
                name = name.split(p).join(' ');
            }
            name = name
                .replace(/^(contact|nom|name|tel|tél|telephone|téléphone)\s*[:#-]?\s*/i, '')
                .replace(/[-–—|,:;#]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            results.push({ name, phone });
        }
    }
    return dedupeContacts(results);
}

function extractContactsFromProto(proto) {
    if (!proto || typeof proto !== 'object') return [];
    const results = [];

    if (proto.contactsArrayMessage?.contacts?.length) {
        for (const c of proto.contactsArrayMessage.contacts) {
            results.push(...parseVcard(c.vcard, c.displayName));
        }
    }
    if (proto.contactMessage) {
        const cm = proto.contactMessage;
        results.push(...parseVcard(cm.vcard, cm.displayName));
    }

    const text =
        proto.conversation
        || proto.extendedTextMessage?.text
        || proto.imageMessage?.caption
        || '';
    if (text) results.push(...parseContactText(text));

    return dedupeContacts(results);
}

function getQuotedMessage(msg) {
    const m = msg?.message;
    if (!m) return null;
    const types = ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage'];
    for (const t of types) {
        const ctx = m[t]?.contextInfo;
        if (ctx?.quotedMessage) return ctx.quotedMessage;
    }
    return null;
}

function dedupeContacts(list) {
    const seen = new Set();
    const out = [];
    for (const c of list) {
        const key = digitsOnly(c.phone) || c.name.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
            name: (c.name || '').trim(),
            phone: c.phone || '',
        });
    }
    return out;
}

function contactsToCsv(contacts) {
    const lines = ['\ufeffnom,telephone,groupe'];
    for (const c of contacts) {
        const name = (c.name || '').replace(/"/g, '""');
        const phone = c.phone || '';
        lines.push(`"${name}","${phone}","Groupe Chabane"`);
    }
    return lines.join('\n');
}

function summarizeContacts(contacts) {
    const withPhone = contacts.filter((c) => c.phone).length;
    const withName = contacts.filter((c) => c.name).length;
    return { total: contacts.length, withPhone, withName };
}

module.exports = {
    parseVcard,
    parseContactText,
    extractContactsFromProto,
    getQuotedMessage,
    dedupeContacts,
    contactsToCsv,
    summarizeContacts,
    formatPhoneInternational,
};
