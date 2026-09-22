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

/** Lien court SMS (redirige vers ?src=sms sur seance-offerte). */
function seanceOfferteSmsLink() {
  return 'https://seance-offerte.boxingcenter.fr/s';
}

/** GSM 7-bit : pas d’accents. Même promesse que le mail Sport2000 (débutant / jamais fait de boxe). */
function sport2000SmsTemplate() {
  const link = seanceOfferteSmsLink();
  const site = SITE_LINK.replace(/^https?:\/\//, '');
  return [
    "Salut {prenom}, c'est David du Boxing Center a Toulouse.",
    'On te contacte via ton fichier client Sport2000, nos salles sont a Toulouse.',
    `Jamais fait de boxe? Seance offerte, debutant OK : ${link}`,
    `Site officiel : ${site}.`,
    'STOP: reponds STOP',
  ].join(' ');
}

module.exports = {
  SITE_LINK,
  seanceOfferteLink,
  seanceOfferteSmsLink,
  sport2000SmsTemplate,
};
