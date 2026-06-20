const SHOP_URL =
  process.env.OFFRE_ETE_SHOP_URL ||
  'https://boutique.boxingcenter.fr/accueil/156-2424-offre-ete-2026-3-mois-illimites-a-89-.html#/31-salle_principale_d_entrainement-toulouse_st_cyprien';

function greetingNameOrFallback(prenom, nom, fallback) {
  const p = String(prenom || '').trim();
  if (p) return p;
  const n = String(nom || '').trim();
  if (n) return n.split(/\s+/)[0];
  return fallback;
}

/** 13 variantes WhatsApp — message clair : 89€ = abonnement + t-shirt inclus. */
const OFFRE_ETE_WHATSAPP_TEMPLATES = [
  `Salut {prenom} 👋

*89€ tout compris* chez Boxing Center :
• 3 mois illimités (5 salles, tous les cours)
• 1 t-shirt offert — *tu ne le paies pas en plus*

Tu paies *89€ une seule fois*, c'est tout.

👉 {lien}`,

  `Bonjour {prenom},

Tu paies *89€ une fois*. Tu reçois *3 mois illimités* + *1 t-shirt offert* inclus.
Rien d'autre à payer.

Commander :
{lien}`,

  `{prenom}, offre été Boxing Center ☀️

*89€ = abonnement 3 mois + t-shirt offert.*
Pas de supplément pour le t-shirt.

{lien}`,

  `Hey {prenom} !

Boxing Center : *89€ tout compris*
→ 3 mois illimités (boxe, MMA, cross…)
→ T-shirt offert inclus

Une seule commande à 89€ :
{lien}`,

  `Coucou {prenom},

*Tu paies 89€.* Tu as *3 mois* dans nos 5 salles + *le t-shirt offert*.
Le t-shirt est inclus, pas en plus.

{lien}`,

  `{prenom}, c'est simple 🥊

*89€ une fois* = abonnement 3 mois + t-shirt Boxing Center offert.

{lien}`,

  `Bonjour {prenom},

Offre été : *89€ tout compris*
• Abonnement 3 mois illimité
• T-shirt offert (inclus dans les 89€)

{lien}`,

  `{prenom} ! Offre Boxing Center ☀️

Pas d'ambiguïté : *89€* = *3 mois* + *t-shirt offert*.
Tu ne paies pas le t-shirt en plus.

{lien}`,

  `Salut {prenom},

*89€* pour *3 mois illimités* chez Boxing Center.
Le *t-shirt est offert* et inclus dans le prix.

{lien}`,

  `{prenom}, prêt(e) pour l'été ? 💪

*89€ tout compris* : abonnement 3 mois + t-shirt offert.
Une commande, un paiement.

{lien}`,

  `Hello {prenom},

Boxing Center — *89€ = 3 mois + t-shirt offert*.
Rien à payer en plus du t-shirt.

{lien}`,

  `{prenom}, info claire :

Tu paies *89€ une seule fois*.
Tu reçois *3 mois illimités* + *1 t-shirt offert*.

{lien}`,

  `Bonjour {prenom} 👊

Offre été :
• *89€ tout compris*
• *3 mois* — 5 salles, tous les cours
• *T-shirt offert* inclus

👉 {lien}`,

  `{prenom}, {salle_line}

*89€ tout compris* — 3 mois + t-shirt offert.

{lien}`,
];

function salleLine(salle) {
  const s = String(salle || '').trim();
  if (!s) return '';
  return `Ta salle : ${s}.`;
}

function formatOffreEteWhatsAppMessage(template, { prenom, nom, salle } = {}) {
  const name = greetingNameOrFallback(prenom, nom, 'toi');
  return template
    .replace(/\{prenom\}/g, name)
    .replace(/\{lien\}/g, SHOP_URL)
    .replace(/\{salle_line\}/g, salleLine(salle));
}

function pickRandomOffreEteWhatsAppMessage({ prenom, nom, salle } = {}) {
  const template =
    OFFRE_ETE_WHATSAPP_TEMPLATES[
      Math.floor(Math.random() * OFFRE_ETE_WHATSAPP_TEMPLATES.length)
    ];
  return formatOffreEteWhatsAppMessage(template, { prenom, nom, salle });
}

module.exports = {
  OFFRE_ETE_WHATSAPP_TEMPLATES,
  OFFRE_ETE_WHATSAPP_VARIANT_COUNT: OFFRE_ETE_WHATSAPP_TEMPLATES.length,
  formatOffreEteWhatsAppMessage,
  pickRandomOffreEteWhatsAppMessage,
};
