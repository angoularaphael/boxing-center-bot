'use strict';

/**
 * Relance séance offerte — uniquement les gens qui ont ouvert le formulaire
 * et ont eu une erreur (pas toute la campagne mail/SMS/WA).
 */

const { getSupabase } = require('./supabase');
const offer = require('./seanceOfferteEmail');

const CAMPAIGN = 'seance_offerte_reviens_bug_2026';
const LINK =
  'https://seance-offerte.boxingcenter.fr/?src=email&utm_source=email&utm_medium=email&utm_campaign=seance_offerte_reviens_2026';
const FROM_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'comptaboxing@gmail.com';
const UNSUBSCRIBE_EMAIL = process.env.RESEND_UNSUBSCRIBE_EMAIL || REPLY_TO;
const DELAY_MS = Math.max(800, parseInt(process.env.SEANCE_OFFERTE_EMAIL_DELAY_MS || '2000', 10) || 2000);
const CONCURRENCY = 1;

let cancelRequested = false;
const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  audience: 0,
  queue: 0,
  remaining: 0,
  done: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  via: 'resend',
  slice: 'first',
  source: 'reviens_bug',
};
let jobConfig = { resendApiKey: '', slice: 'first' };

function snapshot() {
  return { ...state, campaign: CAMPAIGN, delayMs: DELAY_MS, link: LINK };
}

function log(line) {
  console.log(`[seance-offerte-reviens] ${line}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveSlice(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'all' || v === '*' || v === 'given') return 'all';
  if (v === 'second' || v === 'rest' || v === '2' || v === 'sim2') return 'second';
  return 'first';
}

function defaultSlice() {
  return 'all';
}

function sliceAudience(rows, slice) {
  const list = Array.isArray(rows) ? rows : [];
  const resolved = resolveSlice(slice);
  if (resolved === 'all') return list;
  const half = Math.floor(list.length / 2);
  return resolved === 'second' ? list.slice(half) : list.slice(0, half);
}

function firstName(prenom, subject, email) {
  const p = String(prenom || '').trim();
  if (p) return p.charAt(0).toUpperCase() + p.slice(1);
  const fromSubject = String(subject || '').split(',')[0].trim();
  if (fromSubject && fromSubject.length >= 2 && fromSubject.length <= 24 && !fromSubject.includes('@')) {
    return fromSubject.charAt(0).toUpperCase() + fromSubject.slice(1);
  }
  const local = String(email || '').split('@')[0];
  const beforeDot = local.split('.')[0];
  if (beforeDot && beforeDot.length >= 3 && !/^\d+$/.test(beforeDot)) {
    return beforeDot.charAt(0).toUpperCase() + beforeDot.slice(1).toLowerCase();
  }
  return '';
}

function buildMail(prenom, subject, email) {
  const who = firstName(prenom, subject, email);
  const greeting = who ? `Salut ${who},` : 'Salut,';
  const subjectLine = who ? `${who}, un mot de David` : 'Un mot de David';
  const text = [
    greeting,
    '',
    'C’est David du Boxing Center.',
    '',
    'Le message d’avant n’était pas clair : même si tu es déjà inscrit(e) au club, la séance d’essai t’est bien offerte. C’était un bug de notre côté.',
    '',
    'Tu peux t’inscrire ici :',
    LINK,
    '',
    'À bientôt,',
    '',
    'David',
    'Boxing Center',
  ].join('\n');
  return { subject: subjectLine, text, who };
}

async function paginate(sb, makeQuery) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function leadStatus(row) {
  return String(row?.meta?.status || '').toLowerCase();
}

function leadError(row) {
  return String(row?.meta?.last_error || row?.meta?.error || '').trim();
}

function formFailed(row) {
  const status = leadStatus(row);
  const err = leadError(row).toLowerCase();
  return status === 'error' || Boolean(err);
}

function formSucceededLater(row) {
  const status = leadStatus(row);
  return ['confirmed', 'queued', 'manager_notified'].includes(status) && !leadError(row);
}

async function loadAudience(sb) {
  const rows = await paginate(sb, () =>
    sb
      .from('tunnel_leads')
      .select('prenom,nom,email,telephone,meta,created_at')
      .eq('tunnel', 'seance_essai')
      .order('created_at', { ascending: true })
  );

  const byEmail = new Map();
  const succeeded = new Set();
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email.includes('@')) continue;
    if (formSucceededLater(row)) succeeded.add(email);
    if (!formFailed(row)) continue;
    if (offer._test.isExcluded({ email, prenom: row.prenom, nom: row.nom })) continue;
    byEmail.set(email, {
      email,
      prenom: String(row.prenom || '').trim(),
      nom: String(row.nom || '').trim(),
      telephone: String(row.telephone || '').trim(),
      subject: '',
    });
  }
  for (const email of succeeded) byEmail.delete(email);
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

async function fetchSentEmails(sb) {
  const out = new Set();
  const rows = await paginate(sb, () =>
    sb
      .from('outbound_messages')
      .select('recipient')
      .eq('campaign', CAMPAIGN)
      .eq('channel', 'email')
      .eq('status', 'sent')
  );
  for (const row of rows) {
    const email = String(row.recipient || '').trim().toLowerCase();
    if (email) out.add(email);
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

async function claim(sb, { email, subject, body }) {
  const { data, error } = await sb
    .from('outbound_messages')
    .insert({
      campaign: CAMPAIGN,
      channel: 'email',
      recipient: email,
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
      const { error: reuseError } = await sb
        .from('outbound_messages')
        .update({
          status: 'pending',
          error: null,
          subject,
          body: String(body || '').slice(0, 500),
          bot_instance: process.env.BOT_INSTANCE_ID || 'sim1',
        })
        .eq('id', existing.id);
      if (reuseError) throw reuseError;
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
  const mail = buildMail(client.prenom, client.subject, client.email);
  const row = await claim(sb, { email: client.email, subject: mail.subject, body: mail.text });
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
  const audience = await loadAudience(sb);
  if (audience.length > 50) {
    throw new Error(
      `Audience trop large (${audience.length}) : relance limitée aux erreurs formulaire`
    );
  }
  const slice = resolveSlice(jobConfig.slice);
  const pool = sliceAudience(audience, slice);
  const sent = await fetchSentEmails(sb);
  const queue = pool.filter((c) => !sent.has(c.email));

  state.audience = audience.length;
  state.slice = slice;
  state.queue = queue.length;
  state.remaining = 0;
  log(`START audience=${audience.length} slice=${slice} pool=${pool.length} send=${queue.length}`);

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
      } catch (err) {
        state.done++;
        state.failed++;
        log(`ERR ${client.email} ${err.message || err}`);
      }
      if (i < queue.length - 1) await sleep(DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`DONE sent=${state.sent} failed=${state.failed} skipped=${state.skipped} queue=${queue.length}`);
}

function stop() {
  cancelRequested = true;
  state.running = false;
  return { ok: true, stopped: true, ...snapshot() };
}

function start({ resendApiKey, slice, force } = {}) {
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY manquant' };
  if (state.running) {
    if (force) stop();
    else return { ok: true, alreadyRunning: true, ...snapshot() };
  }
  cancelRequested = false;
  jobConfig = { resendApiKey: apiKey, slice: resolveSlice(slice || defaultSlice()) };
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
  state.slice = jobConfig.slice;

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
  loadAudience,
  _test: {
    buildMail,
    resolveSlice,
    sliceAudience,
    formFailed,
    formSucceededLater,
    CAMPAIGN,
    LINK,
  },
};
