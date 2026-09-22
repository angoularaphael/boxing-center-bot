'use strict';

/**
 * Offre séance offerte David — Sport2000 et relances SMS.
 * Même parcours que seance-offerte.boxingcenter.fr ; seul ?src= change (email / sms).
 */

const SITE_LINK = 'https://boxingcenter.fr';

function seanceOfferteLink(src = 'email') {
  const s = String(src || 'email')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const key = s || 'email';
  return `https://seance-offerte.boxingcenter.fr/?src=${encodeURIComponent(key)}`;
}

/** GSM 7-bit : pas d’accents. Même promesse que le mail Sport2000 (débutant / jamais fait de boxe). */
function sport2000SmsTemplate() {
  const link = seanceOfferteLink('sms');
  return [
    "Salut {prenom}, c'est David du Boxing Center.",
    `Jamais fait de boxe? Tu as droit a une seance offerte, debutant OK : ${link}`,
    'STOP: reponds STOP',
  ].join(' ');
}

module.exports = {
  SITE_LINK,
  seanceOfferteLink,
  sport2000SmsTemplate,
};
