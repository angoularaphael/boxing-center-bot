'use strict';

/**
 * Campagne mails enfants — audience BD-ENFANTS-1 + bd-enfants-2 (data/enfants-audience.json).
 */

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('./supabase');

const CAMPAIGN = 'enfants_cours_2026';
const FROM_NAME = 'David de Boxing Center';
const FROM_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'boxingcentertls@gmail.com';
const HUB = 'https://boutique.boxingcenter.fr/abonnements#enfants';
const DELAY_MS = Math.max(300, parseInt(process.env.ENFANTS_EMAIL_DELAY_MS || '450', 10) || 450);
const CONCURRENCY = Math.max(1, parseInt(process.env.ENFANTS_EMAIL_CONCURRENCY || '2', 10) || 2);
const AUDIENCE_FILE = path.join(__dirname, 'data', 'enfants-audience.json');

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  audience: 0,
  queue: 0,
  done: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
};

function snapshot() {
  return { ...state, from: FROM_NAME, delayMs: DELAY_MS, campaign: CAMPAIGN };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line) {
  console.log(`[enfants-email] ${line}`);
}

function firstName(prenom, nom) {
  const p = String(prenom || '').trim();
  if (p) return p;
  const n = String(nom || '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

function buildMail(prenom) {
  const who = firstName(prenom);
  const subject = who ? `${who}, c'est David` : "C'est David";
  const greeting = who ? `Salut ${who},` : 'Salut,';
  const text = [
    greeting,
    '',
    "C'est David de Boxing Center. Les cours enfants ont repris dans nos 5 clubs.",
    '',
    'Baby Boxe dès 3 ans — samedi 14h15-15h.',
    'Boxe éducative 7/11 et 12/16 ans — mercredi et samedi 15h/16h et 16h/17h.',
    'Vacances scolaires incluses.',
    '',
    "Séance d'essai offerte pour les enfants.",
    '',
    'Horaires et inscriptions ici :',
    HUB,
    '',
    'À bientôt,',
    'David de Boxing Center',
    '',
    'Boxing Center — 2 rue du Languedoc, 31000 Toulouse',
    '',
    'Répondre à ce mail ou écrire à boxingcentertls@gmail.com',
    'Pour ne plus recevoir ce type de message : répondez « désinscription ».',
  ].join('\n');
  return { subject, text };
}

function loadAudience() {
  if (!fs.existsSync(AUDIENCE_FILE)) {
    throw new Error(`Audience manquante: ${AUDIENCE_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(AUDIENCE_FILE, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Audience JSON invalide');
  return raw
    .map((row) => ({
      id: String(row.id || '').trim(),
      prenom: String(row.prenom || '').trim(),
      nom: String(row.nom || '').trim(),
      email: String(row.email || '')
        .trim()
        .toLowerCase(),
    }))
    .filter((row) => row.email && row.email.includes('@'));
}

async function fetchSentEmails(sb) {
  const out = new Set();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('outbound_messages')
      .select('recipient')
      .eq('campaign', CAMPAIGN)
      .eq('channel', 'email')
      .in('status', ['sent', 'pending'])
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const email = String(row.recipient || '')
        .trim()
        .toLowerCase();
      if (email) out.add(email);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function sendResend({ apiKey, to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      text,
      reply_to: REPLY_TO,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.name || `Resend HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data.id;
}

async function claim(sb, { email, clientId, subject, body }) {
  const { data, error } = await sb
    .from('outbound_messages')
    .insert({
      campaign: CAMPAIGN,
      channel: 'email',
      recipient: email,
      client_id: clientId || null,
      subject,
      body: String(body || '').slice(0, 500),
      status: 'pending',
      bot_instance: process.env.BOT_INSTANCE_ID || 'sim1',
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) return null;
    throw error;
  }
  return data;
}

async function mark(sb, id, status, errorMessage) {
  if (!id) return;
  const patch =
    status === 'sent'
      ? { status: 'sent', sent_at: new Date().toISOString(), error: null }
      : { status: 'failed', error: String(errorMessage || 'échec').slice(0, 500) };
  await sb.from('outbound_messages').update(patch).eq('id', id);
}

async function sendOne(sb, apiKey, client) {
  const mail = buildMail(client.prenom);
  const row = await claim(sb, {
    email: client.email,
    clientId: client.id,
    subject: mail.subject,
    body: mail.text,
  });
  if (!row) return { ok: false, skipped: true };

  let lastErr = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await sendResend({ apiKey, to: client.email, subject: mail.subject, text: mail.text });
      await mark(sb, row.id, 'sent');
      return { ok: true, skipped: false };
    } catch (err) {
      lastErr = err.message || String(err);
      if (
        err.status === 429 ||
        /rate|limit|too many|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|socket/i.test(lastErr)
      ) {
        const wait = 15000 * attempt;
        log(`RETRY ${client.email} wait ${wait}ms (${lastErr})`);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  await mark(sb, row.id, 'failed', lastErr);
  log(`FAIL ${client.email} ${lastErr}`);
  return { ok: false, skipped: false, error: lastErr };
}

async function runJob({ apiKey }) {
  const sb = getSupabase();
  const audience = loadAudience();
  const sent = await fetchSentEmails(sb);
  const queue = audience.filter((c) => !sent.has(c.email));

  state.audience = audience.length;
  state.queue = queue.length;
  log(`START audience=${audience.length} pending=${queue.length}`);

  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= queue.length) return;
      const client = queue[i];
      try {
        const result = await sendOne(sb, apiKey, client);
        state.done++;
        if (result.skipped) state.skipped++;
        else if (result.ok) state.sent++;
        else state.failed++;
        if (state.done % 25 === 0) {
          log(`PROGRESS ${state.done}/${queue.length} sent=${state.sent} failed=${state.failed}`);
        }
        if (i < queue.length - 1) await sleep(DELAY_MS);
      } catch (err) {
        state.failed++;
        state.done++;
        log(`WORKER ${client.email} ${err.message || err}`);
        await sleep(10000);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`DONE sent=${state.sent} failed=${state.failed} skipped=${state.skipped} queue=${queue.length}`);
}

function start({ resendApiKey } = {}) {
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY manquant' };
  if (state.running) return { ok: true, alreadyRunning: true, ...snapshot() };

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.done = 0;
  state.sent = 0;
  state.failed = 0;
  state.skipped = 0;
  state.audience = 0;
  state.queue = 0;

  setImmediate(() => {
    runJob({ apiKey })
      .catch((err) => {
        state.error = err.message || String(err);
        log(`ABORT ${state.error}`);
      })
      .finally(() => {
        state.running = false;
        state.finishedAt = new Date().toISOString();
      });
  });

  return { ok: true, accepted: true, ...snapshot() };
}

module.exports = { start, status: snapshot };
