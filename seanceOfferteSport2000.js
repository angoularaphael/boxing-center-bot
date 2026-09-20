'use strict';

/**
 * Campagne séance — audience Sport2000 (xlsx → JSON), texte David via Resend.
 * Objectif : Principale / au pire Promotions. From no-reply, Reply-To boxingcentertls.
 */

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('./supabase');

const CAMPAIGN = 'seance_offerte_email_sport2000_2026';
const LINK = 'https://seance-offerte.boxingcenter.fr/?src=email';
const SITE_LINK = 'https://boxingcenter.fr';
const FROM_NAME = 'Boxing Center';
const FROM_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
const REPLY_TO = 'boxingcentertls@gmail.com';
const UNSUBSCRIBE_EMAIL = process.env.RESEND_UNSUBSCRIBE_EMAIL || REPLY_TO;
const DELAY_MS = Math.max(800, parseInt(process.env.SPORT2000_EMAIL_DELAY_MS || '3000', 10) || 3000);
const WAVE_SIZE = resolveWaveSize(process.env.SPORT2000_WAVE_SIZE);
const CONCURRENCY = 1;
const AUDIENCE_FILE = path.join(__dirname, 'data', 'sport2000-audience.json');

function resolveWaveSize(raw) {
  if (raw == null || raw === '' || /^all$/i.test(String(raw))) return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function resolveSlice(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'all' || v === '*' || v === 'given') return 'all';
  if (v === 'second' || v === 'rest' || v === '2' || v === 'sim2') return 'second';
  return 'first';
}

function defaultSlice() {
  const id = String(process.env.BOT_INSTANCE_ID || 'sim1').trim().toLowerCase();
  return id === 'sim2' ? 'second' : 'first';
}

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
  slice: defaultSlice(),
  source: 'sport2000',
};

let jobConfig = {
  recipients: null,
  resendApiKey: '',
  resendAll: false,
  waveSize: WAVE_SIZE,
  slice: defaultSlice(),
};

function snapshot() {
  return {
    ...state,
    campaign: CAMPAIGN,
    delayMs: DELAY_MS,
    waveLimit: jobConfig.waveSize || 0,
    resendAll: Boolean(jobConfig.resendAll),
    link: LINK,
    siteLink: SITE_LINK,
    replyTo: REPLY_TO,
    from: FROM_EMAIL,
    fromName: FROM_NAME,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line) {
  console.log(`[sport2000-email] ${line}`);
}

function titleCase(word) {
  const s = String(word || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function firstName(prenom, nom, email) {
  const p = titleCase(prenom);
  if (p) return p;
  const n = String(nom || '').trim();
  if (n) return titleCase(n.split(/\s+/)[0]);
  const local = String(email || '').split('@')[0] || '';
  const beforeDot = local.split('.')[0];
  if (beforeDot && beforeDot.length >= 3 && !/^\d+$/.test(beforeDot)) {
    return titleCase(beforeDot);
  }
  return '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMail(prenom, nom, email) {
  const who = firstName(prenom, nom, email);
  const greeting = who ? `Bonjour ${who},` : 'Bonjour,';
  // Volontairement promo → onglet Promotions (pas spoof perso → spam)
  const subject = who
    ? `${who}, séance d’essai Boxing Center`
    : 'Séance d’essai Boxing Center';
  const text = [
    greeting,
    '',
    'Boxing Center — clubs de boxe à Toulouse.',
    '',
    'On t’invite à une séance d’essai dans l’un de nos 5 clubs : Minimes, Ramonville, Saint-Cyprien, États-Unis ou Portet.',
    '',
    `Réserver : ${LINK}`,
    '',
    `Site : ${SITE_LINK}`,
    '',
    'À bientôt,',
    'L’équipe Boxing Center',
    '2 rue du Languedoc, 31000 Toulouse',
    '',
    `Désinscription : répondre « stop » ou écrire à ${UNSUBSCRIBE_EMAIL}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e5e5;">
        <tr><td style="padding:20px 24px;background:#111;color:#fff;font-size:18px;font-weight:bold;">Boxing Center</td></tr>
        <tr><td style="padding:24px;font-size:16px;line-height:1.5;">
          <p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px;">On t’invite à une <strong>séance d’essai</strong> dans l’un de nos 5 clubs à Toulouse : Minimes, Ramonville, Saint-Cyprien, États-Unis ou Portet.</p>
          <p style="margin:0 0 24px;">
            <a href="${LINK}" style="display:inline-block;background:#e10600;color:#fff;text-decoration:none;padding:12px 20px;font-weight:bold;">Réserver ma séance</a>
          </p>
          <p style="margin:0 0 16px;font-size:14px;">Site : <a href="${SITE_LINK}" style="color:#111;">boxingcenter.fr</a></p>
          <p style="margin:0;font-size:14px;color:#444;">L’équipe Boxing Center<br>2 rue du Languedoc, 31000 Toulouse</p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#777;">
          Tu reçois ce message de Boxing Center. Pour te désinscrire, réponds « stop » ou écris à
          <a href="mailto:${UNSUBSCRIBE_EMAIL}?subject=Desinscription" style="color:#777;">${escapeHtml(UNSUBSCRIBE_EMAIL)}</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html, who };
}

function normalizeRecipients(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw
    .map((row) => ({
      prenom: String(row.prenom || row.name || '').trim(),
      nom: String(row.nom || '').trim(),
      email: String(row.email || '')
        .trim()
        .toLowerCase(),
    }))
    .filter((row) => row.email.includes('@'));
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

function sliceAudience(rows, slice) {
  const list = Array.isArray(rows) ? rows : [];
  const resolved = resolveSlice(slice);
  if (resolved === 'all') return list;
  const half = Math.floor(list.length / 2);
  return resolved === 'second' ? list.slice(half) : list.slice(0, half);
}

function loadAudienceFromFile() {
  if (!fs.existsSync(AUDIENCE_FILE)) {
    throw new Error(`Audience manquante: ${AUDIENCE_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(AUDIENCE_FILE, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Audience JSON invalide');
  const byEmail = new Map();
  for (const row of raw) {
    const email = String(row.email || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@') || isBlocked(email)) continue;
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      prenom: String(row.prenom || '').trim(),
      nom: String(row.nom || '').trim(),
      email,
    });
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

async function loadAudience() {
  if (Array.isArray(jobConfig.recipients) && jobConfig.recipients.length) {
    return jobConfig.recipients.filter((row) => !isBlocked(row.email));
  }
  return loadAudienceFromFile();
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

async function sendResend({ apiKey, to, subject, text, html }) {
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
      html,
      reply_to: REPLY_TO,
      headers: {
        'List-Unsubscribe': `<mailto:${UNSUBSCRIBE_EMAIL}?subject=Desinscription>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        Precedence: 'bulk',
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
      client_id: null,
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
      if (!existing) return null;
      if (existing.status === 'sent' && !jobConfig.resendAll) return null;
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
  const mail = buildMail(client.prenom, client.nom, client.email);
  const row = await claim(sb, {
    email: client.email,
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
        html: mail.html,
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
  const audience = await loadAudience();
  const slice = resolveSlice(jobConfig.slice);
  const pool = sliceAudience(audience, slice);
  const sent = jobConfig.resendAll ? new Set() : await fetchSentEmails(sb);
  const pending = pool.filter((c) => !sent.has(c.email));
  const waveLimit = resolveWaveSize(jobConfig.waveSize);
  const queue = waveLimit > 0 ? pending.slice(0, waveLimit) : pending;

  state.audience = audience.length;
  state.slice = slice;
  state.queue = pending.length;
  state.waveSize = waveLimit;
  state.remaining = Math.max(0, pending.length - queue.length);
  log(
    `START source=sport2000 audience=${audience.length} slice=${slice} pool=${pool.length} pending=${pending.length} send=${queue.length} reste=${state.remaining} delay=${DELAY_MS}ms from=${FROM_EMAIL} reply=${REPLY_TO}`
  );

  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= queue.length) return;
      if (cancelRequested) return;
      const client = queue[i];
      try {
        if (isBlocked(client.email)) {
          state.skipped++;
          state.done++;
          continue;
        }
        const result = await sendOne(sb, apiKey, client);
        state.done++;
        if (result.skipped) state.skipped++;
        else if (result.ok) state.sent++;
        else state.failed++;
        state.waveDone = state.done;
        if (state.done % 25 === 0) {
          log(`PROGRESS ${state.done}/${queue.length} sent=${state.sent} failed=${state.failed}`);
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
    `DONE sent=${state.sent} failed=${state.failed} skipped=${state.skipped} queue=${queue.length} reste=${state.remaining}`
  );
}

function stop() {
  cancelRequested = true;
  state.running = false;
  return { ok: true, stopped: true, ...snapshot() };
}

function start({ resendApiKey, recipients, waveSize, force, resendAll, slice } = {}) {
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY manquant' };
  if (state.running) {
    if (force) stop();
    else return { ok: true, alreadyRunning: true, ...snapshot() };
  }
  cancelRequested = false;

  const normalized = normalizeRecipients(recipients);
  jobConfig = {
    recipients: normalized && normalized.length <= 50 ? normalized : null,
    resendApiKey: apiKey,
    resendAll: resendAll === true,
    waveSize: resolveWaveSize(waveSize ?? process.env.SPORT2000_WAVE_SIZE),
    slice: resolveSlice(slice || defaultSlice()),
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

/** Envoi direct d’un mail de test (sans file d’attente campagne). */
async function sendTest({ resendApiKey, to, prenom, nom } = {}) {
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY manquant' };
  const email = String(to || '')
    .trim()
    .toLowerCase();
  if (!email.includes('@')) return { ok: false, error: 'email invalide' };
  const mail = buildMail(prenom || '', nom || '', email);
  const id = await sendResend({
    apiKey,
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return {
    ok: true,
    id,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    from: FROM_EMAIL,
    fromName: FROM_NAME,
    replyTo: REPLY_TO,
    link: LINK,
    siteLink: SITE_LINK,
  };
}

module.exports = {
  start,
  stop,
  status: snapshot,
  sendTest,
  CAMPAIGN,
  LINK,
  SITE_LINK,
  _test: {
    buildMail,
    sendResend,
    resolveWaveSize,
    resolveSlice,
    sliceAudience,
    FROM_EMAIL,
    FROM_NAME,
    REPLY_TO,
    LINK,
    SITE_LINK,
    CAMPAIGN,
    DELAY_MS,
  },
};
