const AVENTURE_URL = process.env.AVENTURE_URL || 'https://aventure.boxingcenter.fr';
const COUR = 'contactgotatoulouse@gmail.com';

const BALMA_WA = [
  `Salut {prenom} 👋\n\nRentrée Boxing Center : *29,99€ / 4 semaines* ou *259€ / 12 mois*.\n\nEn parallèle : mail à ${COUR} pour résilier chez Cour des Miracles.\n\nBascule : {lien}`,
  `Bonjour {prenom},\n\n29,99€ / 4 sem. ou 259€ / an.\nRésilie : ${COUR}\nLien : {lien}`,
  `{prenom}, Boxing Center continue.\n*29,99€ / 4 sem.* ou *259€ / 12 mois*.\nMail : ${COUR}\n{lien}`,
  `Hey {prenom} !\nOffre *29€* ou *259€*.\nRésiliation : ${COUR}\n{lien}`,
  `Coucou {prenom},\n1. 29,99€ / 4 sem. ou 259€ / an\n2. Mail : ${COUR}\n3. {lien}`,
  `{prenom} 🥊\nRentrée : *29,99€* ou *259€*. 5 salles.\n${COUR}\n{lien}`,
  `Bonjour {prenom},\nOffres 29,99€ / 259€.\nRésiliation : ${COUR}\n{lien}`,
  `{prenom} ! Boxing Center t’attend.\n*29,99€ / 4 semaines* ou *259€ / 12 mois*.\n${COUR}\n{lien}`,
  `Salut {prenom},\n5 salles : 29,99€ ou 259€.\n${COUR}\n{lien}`,
  `{prenom}, info claire.\n29,99€ / 4 sem. · 259€ / an.\n${COUR}\n{lien}`,
  `Hello {prenom} 👊\nRentrée 29,99€ ou 259€.\n${COUR}\n{lien}`,
  `{prenom}, on continue l’aventure.\n29,99€ / 4 sem. ou 259€ / 12 mois.\n${COUR}\n{lien}`,
];

const PORTET_WA = [
  `Salut {prenom} 👋\n\nRentrée Portet : *29,99€ / 4 semaines* ou *259€ / 12 mois*.\n\n👉 {lien}`,
  `Bonjour {prenom},\n29,99€ sans engagement ou 259€ l’année.\n{lien}`,
  `{prenom}, c’est le moment 🥊\n*29,99€ / 4 semaines* · *259€ / 12 mois*\n{lien}`,
  `Hey {prenom} !\nRentrée 2026 : 29,99€ ou 259€.\n{lien}`,
  `Coucou {prenom},\n29,99€ / 4 sem. ou 259€ l’année.\n{lien}`,
  `{prenom}, offre rentrée Boxing Center.\n29,99€ ou 259€ / 12 mois.\n{lien}`,
  `Bonjour {prenom},\n29,99€ les 4 semaines, ou 259€ l’année.\n{lien}`,
  `{prenom} ! Rentrée boxe 👊\n29,99€ / 4 sem. · 259€ / an.\n{lien}`,
  `Salut {prenom},\nOffres rentrée : 29,99€ ou 259€.\n{lien}`,
  `{prenom}, info rentrée :\n29,99€ / 4 semaines ou 259€ / 12 mois.\n{lien}`,
  `Hello {prenom},\nBoxing Center — 29,99€ ou 259€.\n{lien}`,
  `{prenom}, on t’attend.\n29,99€ / 4 sem. ou 259€ / 12 mois → {lien}`,
];

function fill(template, { prenom, lien } = {}) {
  return String(template || '')
    .replace(/\{prenom\}/g, String(prenom || '').trim() || 'toi')
    .replace(/\{lien\}/g, lien || AVENTURE_URL);
}

function pick(list, seed = Date.now()) {
  return list[Math.abs(Number(seed) || Date.now()) % list.length];
}

function pickCampaignWhatsApp(kind, ctx = {}) {
  const k = String(kind || '').toLowerCase();
  const list = k === 'portet' ? PORTET_WA : BALMA_WA;
  const lien =
    ctx.lien ||
    (k === 'portet'
      ? 'https://boutique.boxingcenter.fr/inscription?product=offre-duo'
      : AVENTURE_URL);
  return fill(pick(list, ctx.seed), { prenom: ctx.prenom, lien });
}

module.exports = {
  AVENTURE_URL,
  BALMA_WA,
  PORTET_WA,
  pickCampaignWhatsApp,
  fill,
};
