/** Remplace {nom} dans les modèles gestion-manager / campagnes. */
function personalizeOutboundMessage(template, nom) {
    const name = String(nom || '').trim() || 'there';
    return String(template || '').replace(/\{nom\}/gi, name);
}

module.exports = { personalizeOutboundMessage };
