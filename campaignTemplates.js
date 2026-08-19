const AVENTURE_URL = process.env.AVENTURE_URL || 'https://aventure.boxingcenter.fr';
const OFFRES_URL =
  process.env.OFFRES_SHOP_URL ||
  'https://boutique.boxingcenter.fr/inscription?product=offre-duo';
const BALMA_WA = require('./balma-wa-14.json');
const OFFRES_WA = require('./offres-wa-14.json');

function fill(template, { prenom, lien } = {}) {
  return String(template || '')
    .replace(/\{prenom\}/g, String(prenom || '').trim() || 'toi')
    .replace(/\{lien\}/g, lien || AVENTURE_URL);
}

function pick(list, seed = Date.now()) {
  return list[Math.abs(Number(seed) || Date.now()) % list.length];
}

function isOffresKind(kind) {
  const k = String(kind || '').toLowerCase();
  return k === 'offres' || k === 'portet' || k === 'promo';
}

function pickCampaignWhatsApp(kind, ctx = {}) {
  const offres = isOffresKind(kind);
  const list = offres ? OFFRES_WA : BALMA_WA;
  const lien = ctx.lien || (offres ? OFFRES_URL : AVENTURE_URL);
  return fill(pick(list, ctx.seed), { prenom: ctx.prenom, lien });
}

module.exports = {
  AVENTURE_URL,
  OFFRES_URL,
  BALMA_WA,
  OFFRES_WA,
  PORTET_WA: OFFRES_WA,
  pickCampaignWhatsApp,
  fill,
};
