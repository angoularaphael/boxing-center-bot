'use strict';

/**
 * Campagne séance offerte — texte David via Resend.
 * Suivi : outbound_messages (campaign) + lien ?src=email sur seance-offerte.
 */

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('./supabase');

const CAMPAIGN = 'seance_offerte_email_2026';
const LINK = 'https://seance-offerte.boxingcenter.fr/?src=email';
const FROM_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'comptaboxing@gmail.com';
const UNSUBSCRIBE_EMAIL = process.env.RESEND_UNSUBSCRIBE_EMAIL || REPLY_TO;
const EXTRA_RECIPIENTS = [
  { email: 'johnsonsuffo@gmail.com', prenom: 'Johnson', nom: '' },
];
function audienceFilePath() {
  const bot = String(process.env.BOT_INSTANCE_ID || 'sim1').trim();
  const byBot = path.join(__dirname, 'data', `seance-offerte-${bot}.json`);
  if (fs.existsSync(byBot)) return byBot;
  const legacy = path.join(__dirname, 'data', 'bd-triee-audience.json');
  if (fs.existsSync(legacy)) return legacy;
  return byBot;
}
const DELAY_MS = Math.max(3000, parseInt(process.env.SEANCE_OFFERTE_EMAIL_DELAY_MS || '8000', 10) || 8000);
const WAVE_SIZE = Math.max(50, parseInt(process.env.SEANCE_OFFERTE_WAVE_SIZE || '500', 10) || 500);
const CONCURRENCY = 1;

let cancelRequested = false;

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  audience: 0,
  queue: 0,
  waveSize: WAVE_SIZE,
  waveDone: 0,
  remaining: 0,
  done: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  via: 'resend',
};

let jobConfig = {
  recipients: null,
  resendApiKey: '',
};

function snapshot() {
  return {
    ...state,
    campaign: CAMPAIGN,
    delayMs: DELAY_MS,
    waveLimit: WAVE_SIZE,
    link: LINK,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line) {
  console.log(`[seance-offerte-email] ${line}`);
}

function titleCase(word) {
  const s = String(word || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].toLowerCase();
  if (!local) return '';
  const known = {
    angoularaphael05: 'Raphael',
    boxingcenterportet: 'Portet',
    johnsonsuffo: 'Johnson',
  };
  if (known[local]) return known[local];
  if (local.includes('angoularaphael')) return 'Raphael';
  if (local.startsWith('junior.')) return 'Junior';
  const beforeDot = local.split('.')[0];
  if (beforeDot && beforeDot.length >= 3 && !/^\d+$/.test(beforeDot)) {
    if (['boxingcenter', 'contact', 'info', 'admin', 'club', 'noreply', 'no-reply'].includes(beforeDot)) return '';
    return titleCase(beforeDot);
  }
  const chunks = local.replace(/\d+/g, '').match(/[a-z]{3,}/gi) || [];
  const skip = new Set(['gmail', 'yahoo', 'hotmail', 'outlook', 'boxingcenter', 'center']);
  const pick = chunks.find((c) => !skip.has(c.toLowerCase()));
  return pick ? titleCase(pick) : '';
}

function firstName(prenom, nom, email) {
  const p = titleCase(prenom);
  if (p) return p;
  const n = String(nom || '').trim();
  if (n) return titleCase(n.split(/\s+/)[0]);
  return nameFromEmail(email);
}

function buildMail(prenom, nom, email) {
  const who = firstName(prenom, nom, email);
  const greeting = who ? `Salut ${who},` : 'Salut,';
  const subject = who ? `${who}, un petit mot de David` : 'Un petit mot de David';
  const text = [
    greeting,
    '',
    'C’est David du Boxing Center.',
    '',
    'Je voulais te faire profiter d’une séance d’essai au club. Elle est offerte, sa valeur habituelle est de 10 €.',
    '',
    'Tu peux choisir ta séance ici :',
    LINK,
    '',
    'Si tu es déjà inscrit(e), ou si ce n’est pas le bon moment pour toi, tu peux simplement transmettre ce lien à quelqu’un de ton entourage.',
    '',
    'À bientôt,',
    '',
    'David',
    'Boxing Center',
  ].join('\n');
  return { subject, text, who };
}

function normalizeRecipients(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw
    .map((row) => ({
      id: coerceClientId(row.id),
      prenom: String(row.prenom || row.name || '').trim(),
      nom: String(row.nom || '').trim(),
      email: String(row.email || '')
        .trim()
        .toLowerCase(),
      ville: String(row.ville || '').trim(),
    }))
    .filter((row) => row.email.includes('@'));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function coerceClientId(value) {
  const id = String(value || '').trim();
  return UUID_RE.test(id) ? id : null;
}

function isBlocked(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || !e.includes('@')) return true;
  if (e === 'boxingcenter31@gmail.com') return true;
  const local = e.split('@')[0];
  return local === 'boxingcenter31' || local.includes('boxingcenter31');
}

function mergeExtraRecipients(rows) {
  const byEmail = new Map();
  for (const row of rows || []) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email || isBlocked(email)) continue;
    byEmail.set(email, row);
  }
  for (const extra of EXTRA_RECIPIENTS) {
    const email = String(extra.email || '').trim().toLowerCase();
    if (!email || isBlocked(email) || byEmail.has(email)) continue;
    byEmail.set(email, {
      id: null,
      prenom: String(extra.prenom || '').trim(),
      nom: String(extra.nom || '').trim(),
      email,
      ville: String(extra.ville || '').trim(),
    });
  }
  return [...byEmail.values()];
}

function loadAudience() {
  if (Array.isArray(jobConfig.recipients) && jobConfig.recipients.length <= 50) {
    return mergeExtraRecipients(jobConfig.recipients.filter((row) => !isBlocked(row.email)));
  }
  const audienceFile = audienceFilePath();
  if (!fs.existsSync(audienceFile)) {
    throw new Error(`Audience manquante: ${audienceFile} (git pull + build-seance-offerte-audience.js)`);
  }
  const raw = JSON.parse(fs.readFileSync(audienceFile, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Audience JSON invalide');
  return mergeExtraRecipients(
    raw
      .map((row) => ({
        id: coerceClientId(row.id),
        prenom: String(row.prenom || '').trim(),
        nom: String(row.nom || '').trim(),
        email: String(row.email || '')
          .trim()
          .toLowerCase(),
        ville: String(row.ville || '').trim(),
      }))
      .filter((row) => row.email.includes('@') && !isBlocked(row.email))
  );
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
      .eq('status', 'sent')
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
      from: `David <${FROM_EMAIL}>`,
      to: [to],
      subject,
      text,
      reply_to: REPLY_TO,
      headers: {
        'List-Unsubscribe': `<mailto:${UNSUBSCRIBE_EMAIL}?subject=Desinscription>`,
      },
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
      client_id: coerceClientId(clientId),
      subject,
      body: String(body || '').slice(0, 500),
      status: 'pending',
      bot_instance: process.env.BOT_INSTANCE_ID || 'sim1',
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
      const { data: existing, error: existingError } = await sb
        .from('outbound_messages')
        .select('id,status')
        .eq('campaign', CAMPAIGN)
        .eq('channel', 'email')
        .eq('recipient', email)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing || existing.status === 'sent') return null;
      await sb
        .from('outbound_messages')
        .update({ status: 'pending', error: null })
        .eq('id', existing.id);
      return existing;
    }
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
  const mail = buildMail(client.prenom, client.nom, client.email);
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
      await sendResend({
        apiKey,
        to: client.email,
        subject: mail.subject,
        text: mail.text,
      });
      await mark(sb, row.id, 'sent');
      return { ok: true, skipped: false };
    } catch (err) {
      lastErr = err.message || String(err);
      if (
        err.status === 429 ||
        /rate|limit|too many|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|socket|fetch failed/i.test(lastErr)
      ) {
        const wait = 20000 * attempt + Math.floor(Math.random() * 8000);
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

async function runJob({ resendApiKey }) {
  const sb = getSupabase();
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw new Error('RESEND_API_KEY manquant');
  const audience = loadAudience();
  const sent = await fetchSentEmails(sb);
  const pending = audience.filter((c) => !sent.has(c.email));
  const waveLimit = Math.max(1, Number(jobConfig.waveSize) || WAVE_SIZE);
  const queue = pending.slice(0, waveLimit);

  state.audience = audience.length;
  state.queue = pending.length;
  state.waveSize = waveLimit;
  state.remaining = Math.max(0, pending.length - queue.length);
  log(
    `START audience=${audience.length} pending=${pending.length} wave=${queue.length} reste=${state.remaining} from=${FROM_EMAIL}`
  );

  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= queue.length) return;
      if (cancelRequested) return;
      const client = queue[i];
      try {
        const result = await sendOne(sb, apiKey, client);
        state.done++;
        if (result.skipped) state.skipped++;
        else if (result.ok) state.sent++;
        else state.failed++;
        state.waveDone = state.done;
        if (state.done % 25 === 0) {
          log(`PROGRESS vague ${state.done}/${queue.length} sent=${state.sent} failed=${state.failed}`);
        }
        if (i < queue.length - 1) await sleep(DELAY_MS);
      } catch (err) {
        state.failed++;
        state.done++;
        log(`WORKER ${client.email} ${err.message || err}`);
        await sleep(15000);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(
    `WAVE_DONE sent=${state.sent} failed=${state.failed} skipped=${state.skipped} wave=${queue.length} reste=${state.remaining}`
  );
}

function stop() {
  cancelRequested = true;
  state.running = false;
  return { ok: true, stopped: true, ...snapshot() };
}

function start({ resendApiKey, recipients, waveSize, force } = {}) {
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY manquant' };
  if (state.running) {
    if (force) stop();
    else return { ok: true, alreadyRunning: true, ...snapshot() };
  }
  cancelRequested = false;

  jobConfig = {
    recipients:
      Array.isArray(recipients) && recipients.length <= 50 ? normalizeRecipients(recipients) : null,
    resendApiKey: apiKey,
    waveSize: Math.max(50, parseInt(waveSize || process.env.SEANCE_OFFERTE_WAVE_SIZE || WAVE_SIZE, 10) || WAVE_SIZE),
  };

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
    runJob({ resendApiKey: apiKey })
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

module.exports = {
  start,
  stop,
  status: snapshot,
  CAMPAIGN,
  LINK,
  _test: { buildMail, sendResend, FROM_EMAIL, REPLY_TO },
};
