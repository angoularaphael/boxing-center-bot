'use strict';

function normalizePhoneDigits(input) {
    if (!input) return '';
    let digits = String(input).replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) {
        digits = `33${digits.slice(1)}`;
    }
    return digits;
}

function normalizeEmail(input) {
    const e = String(input || '').trim().toLowerCase();
    if (!e || !e.includes('@')) return '';
    return e;
}

function computeContactType(hasPhone, hasEmail) {
    if (hasPhone && hasEmail) return 'both';
    if (hasPhone) return 'phone_only';
    if (hasEmail) return 'email_only';
    return 'none';
}

function buildContactRow({ nom, telephone, email }) {
    const cleanNom = String(nom || '').trim();
    if (!cleanNom) throw new Error('nom requis');

    const cleanEmail = normalizeEmail(email) || null;
    const cleanPhone = normalizePhoneDigits(telephone) || null;
    const has_phone = Boolean(cleanPhone);
    const has_email = Boolean(cleanEmail);

    return {
        nom: cleanNom,
        email: cleanEmail,
        telephone: cleanPhone,
        adresse: null,
        localisation: null,
        url_profil: null,
        has_phone,
        has_email,
        contact_type: computeContactType(has_phone, has_email),
        is_test: false,
    };
}

function parseSaveTargets(text) {
    const lower = String(text || '').toLowerCase();
    const hasManager = /\bmanager?s?\b/.test(lower);
    const hasPromo = /\bpromo(teur|teurs|ter)?s?\b/.test(lower);
    if (hasManager && !hasPromo) return { managers: true, promoteurs: false };
    if (hasPromo && !hasManager) return { managers: false, promoteurs: true };
    return { managers: true, promoteurs: true };
}

function contactDisplayName(c) {
    const name = String(c.nom || '').trim();
    if (name) return name;
    const phone = normalizePhoneDigits(c.telephone);
    return phone ? `+${phone}` : 'Contact';
}

module.exports = {
    buildContactRow,
    parseSaveTargets,
    contactDisplayName,
    normalizePhoneDigits,
};
