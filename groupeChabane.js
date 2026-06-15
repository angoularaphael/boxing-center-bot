const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'groupe-chabane-contacts.json');

let cached = null;

function loadRaw() {
    if (cached) return cached;
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    cached = JSON.parse(raw);
    return cached;
}

function getGroupeChabaneContacts() {
    return loadRaw().contacts || [];
}

function getGroupeChabaneContactById(id) {
    const key = String(id || '').replace(/\D/g, '');
    if (!key) return null;
    return getGroupeChabaneContacts().find((c) => c.id === key) || null;
}

function resolveGroupeChabaneForSend({ contact_ids: contactIds, test_only: testOnly, broadcast }) {
    const all = getGroupeChabaneContacts();
    if (testOnly) {
        const first = all[0];
        return first ? [first] : [];
    }
    if (broadcast === 'all') return all;
    if (Array.isArray(contactIds) && contactIds.length) {
        const wanted = new Set(contactIds.map((id) => String(id).replace(/\D/g, '')));
        return all.filter((c) => wanted.has(c.id));
    }
    return [];
}

module.exports = {
    getGroupeChabaneContacts,
    getGroupeChabaneContactById,
    resolveGroupeChabaneForSend,
};
