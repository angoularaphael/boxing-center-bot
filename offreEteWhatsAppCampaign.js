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

/** 13 variantes WhatsApp — 89€ : 3 mois cours + accès libre (5 salles). */
const OFFRE_ETE_WHATSAPP_TEMPLATES = [
  `Salut {prenom} 👋

*Offre été Boxing Center* — Toulouse & agglo ☀️

*89€* au lieu de 150€ :
• *3 mois* de cours illimités
• *Accès libre* à la salle
• *5 salles* — boxe, MMA, muay thai, cross…

👉 {lien}`,

  `Bonjour {prenom},

Tu paies *89€ une fois* (au lieu de 150€).
*3 mois* de cours + *accès libre* dans nos *5 salles*.

Commander :
{lien}`,

  `{prenom}, offre été Boxing Center ☀️

*89€ = 3 mois cours + accès libre.*
Économise *61€* sur l'été.

{lien}`,

  `Hey {prenom} !

Boxing Center : *89€* (~~150€~~)
→ *3 mois* cours illimités
→ *Accès libre* salle
→ *5 salles* Toulouse & agglo

{lien}`,

  `Coucou {prenom},

*Tu paies 89€.* Tu as *3 mois* : tous les cours + accès libre dans *5 salles*.

{lien}`,

  `{prenom}, c'est simple 🥊

*89€ une fois* = *3 mois cours + accès libre* chez Boxing Center.

{lien}`,

  `Bonjour {prenom},

Offre été *89€* (au lieu de 150€) :
• Cours illimités *3 mois*
• *Accès libre*
• *5 salles*

{lien}`,

  `{prenom} ! Offre Boxing Center ☀️

*89€* pour *3 mois* : cours + accès libre. *5 salles*, une seule commande.

{lien}`,

  `Salut {prenom},

*89€* — *3 mois* cours & accès libre. Boxe, MMA, cross… *5 salles*.

{lien}`,

  `{prenom}, prêt(e) pour l'été ? 💪

*89€ tout compris* : *3 mois* cours + accès libre. Économise *61€*.

{lien}`,

  `Hello {prenom},

Boxing Center — *89€ = 3 mois cours + accès libre*.
5 salles, tous les cours inclus.

{lien}`,

  `{prenom}, info claire :

Tu paies *89€ une seule fois* (au lieu de 150€).
*3 mois* cours illimités + accès libre.

{lien}`,

  `Bonjour {prenom} 👊

Offre été 2026 :
• *89€* (~~150€~~)
• *3 mois* — cours + accès libre
• *5 salles* Toulouse & agglo

👉 {lien}`,

  `{prenom}, {salle_line}

*89€* — *3 mois cours + accès libre* (5 salles).

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
