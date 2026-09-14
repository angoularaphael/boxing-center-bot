'use strict';

/**
 * Campagne séance offerte — texte David (Gmail SMTP, comme les tests inbox).
 * Suivi : outbound_messages (campaign) + lien ?src=email sur seance-offerte.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { getSupabase } = require('./supabase');

const CAMPAIGN = 'seance_offerte_email_2026';
const LINK = 'https://seance-offerte.boxingcenter.fr/?src=email';
const AUDIENCE_FILE = path.join(__dirname, 'data', 'bd-triee-audience.json');
const DELAY_MS = Math.max(3000, parseInt(process.env.SEANCE_OFFERTE_EMAIL_DELAY_MS || '8000', 10) || 8000);
const CONCURRENCY = 1;

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
  via: 'gmail',
};

let jobConfig = {
  recipients: null,
  gmailUser: '',
  gmailPass: '',
};

function snapshot() {
  return { ...state, campaign: CAMPAIGN, delayMs: DELAY_MS, link: LINK };
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

function loadAudience() {
  if (Array.isArray(jobConfig.recipients) && jobConfig.recipients.length) {
    return jobConfig.recipients.filter((row) => !isBlocked(row.email));
  }
  if (!fs.existsSync(AUDIENCE_FILE)) {
    throw new Error(`Audience manquante: ${AUDIENCE_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(AUDIENCE_FILE, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Audience JSON invalide');
  return raw
    .map((row) => ({
      id: coerceClientId(row.id),
      prenom: String(row.prenom || '').trim(),
      nom: String(row.nom || '').trim(),
      email: String(row.email || '')
        .trim()
        .toLowerCase(),
      ville: String(row.ville || '').trim(),
    }))
    .filter((row) => row.email.includes('@') && !isBlocked(row.email));
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

function createTransport({ gmailUser, gmailPass }) {
  const user = String(gmailUser || process.env.CAMPAIGN_GMAIL_USER || '').trim();
  const pass = String(gmailPass || process.env.CAMPAIGN_GMAIL_PASS || '')
    .replace(/\s+/g, '');
  if (!user || !pass) throw new Error('CAMPAIGN_GMAIL_USER / CAMPAIGN_GMAIL_PASS manquants');
  return {
    user,
    transport: nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user, pass },
    }),
  };
}

async function sendGmail({ transport, user, to, subject, text }) {
  const info = await transport.sendMail({
    from: `David <${user}>`,
    to,
    replyTo: user,
    subject,
    text,
  });
  return info.messageId;
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

async function sendOne(sb, transport, gmailUser, client) {
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
      await sendGmail({
        transport,
        user: gmailUser,
        to: client.email,
        subject: mail.subject,
        text: mail.text,
      });
      await mark(sb, row.id, 'sent');
      return { ok: true, skipped: false };
    } catch (err) {
      lastErr = err.message || String(err);
      if (/rate|limit|too many|421|450|daily|quota|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|socket/i.test(lastErr)) {
        const wait = 60000 * attempt;
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

async function runJob({ gmailUser, gmailPass }) {
  const sb = getSupabase();
  const { user, transport } = createTransport({ gmailUser, gmailPass });
  const audience = loadAudience();
  const sent = await fetchSentEmails(sb);
  const queue = audience.filter((c) => !sent.has(c.email));

  state.audience = audience.length;
  state.queue = queue.length;
  log(`START audience=${audience.length} pending=${queue.length} from=${user.replace(/.(?=.{4}@)/g, '*')}`);

  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= queue.length) return;
      const client = queue[i];
      try {
        const result = await sendOne(sb, transport, user, client);
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
        await sleep(15000);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`DONE sent=${state.sent} failed=${state.failed} skipped=${state.skipped} queue=${queue.length}`);
}

function start({ gmailUser, gmailPass, recipients } = {}) {
  const user = String(gmailUser || process.env.CAMPAIGN_GMAIL_USER || '').trim();
  const pass = String(gmailPass || process.env.CAMPAIGN_GMAIL_PASS || '')
    .replace(/\s+/g, '');
  if (!user || !pass) return { ok: false, error: 'CAMPAIGN_GMAIL_USER / CAMPAIGN_GMAIL_PASS manquants' };
  if (state.running) return { ok: true, alreadyRunning: true, ...snapshot() };

  jobConfig = {
    recipients: normalizeRecipients(recipients),
    gmailUser: user,
    gmailPass: pass,
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
    runJob({ gmailUser: user, gmailPass: pass })
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

module.exports = { start, status: snapshot, CAMPAIGN, LINK };
