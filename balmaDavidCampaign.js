'use strict';

/**
 * Mails Balma restants — 1 mail David (texte brut) par personne.
 * Campagne SQL balma_cession_2026 : ceux déjà envoyés (HTML) sont sautés.
 */

const { getSupabase } = require('./supabase');

const CAMPAIGN = 'balma_cession_2026';
const FROM_NAME = 'David';
const LIEN = 'https://aventure.boxingcenter.fr';
const FROM_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
const REPLY_TO = 'boxingcentertls@gmail.com';
const DELAY_MS = Math.max(300, parseInt(process.env.BALMA_DAVID_DELAY_MS || '700', 10) || 700);
const CONCURRENCY = Math.max(1, parseInt(process.env.BALMA_DAVID_CONCURRENCY || '2', 10) || 2);

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
  return { ...state, from: FROM_NAME, delayMs: DELAY_MS };
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

function isBalma(salle) {
  const v = String(salle || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return v.includes('balma');
}

function greetingName(prenom, nom) {
  const p = String(prenom || '').trim();
  if (p) return p;
  const n = String(nom || '').trim();
  if (n) return n.split(/\s+/)[0];
  return '';
}

function buildMail(prenom) {
  const name = String(prenom || '').trim();
  const subject = name ? `${name}, c’est David` : 'C’est David';
  const greeting = name ? `Salut ${name},` : 'Salut,';
  const text = [
    greeting,
    '',
    'C’est David, de Boxing Center.',
    '',
    'La salle de Balma Gramont n’est plus dans notre réseau. Elle est désormais gérée à part, par GOTA La Cour des Miracles.',
    '',
    'Si tu boxais surtout à Balma, tes cours là-bas continuent avec eux.',
    '',
    'Si tu veux garder nos cinq salles — Minimes, Ramonville, Saint-Cyprien, États-Unis, Portet — c’est un abonnement Boxing Center. 29 euros les 4 semaines, ou 259 euros les 12 mois.',
    '',
    'Le détail est ici :',
    LIEN,
    '',
    'Si tu as déjà payé plusieurs mois d’un coup, tu gardes les cinq salles jusqu’à la date déjà réglée.',
    '',
    'À plus tard,',
    'David de Boxing Center',
  ].join('\n');
  return { subject, text };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line) {
  console.log(`[balma-david] ${line}`);
}

async function fetchAllClients(sb) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('portet_clients')
      .select('id, prenom, nom, email, salle, created_at')
      .not('email', 'is', null)
      .neq('email', '')
      .ilike('salle', '%balma%')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchSet(sb, table, column, extra) {
  const out = new Set();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    let q = sb.from(table).select(column).range(from, from + pageSize - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) {
      if (/does not exist|relation|schema cache/i.test(error.message)) return out;
      throw error;
    }
    if (!data?.length) break;
    for (const row of data) {
      const v = String(row[column] || '')
        .trim()
        .toLowerCase();
      if (v) out.add(v);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function sendResend({ apiKey, to, subject, text, fromName }) {
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${FROM_EMAIL}>`,
        to: [to],
        subject,
        text,
        reply_to: REPLY_TO,
      }),
    });
  } catch (err) {
    throw new Error(err.message || 'fetch failed');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.name || `Resend HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data.id;
}

async function claim(sb, { campaign, email, clientId, subject, body }) {
  const { data, error } = await sb
    .from('outbound_messages')
    .insert({
      campaign,
      channel: 'email',
      recipient: email,
      client_id: clientId || null,
      subject,
      body: String(body || '').slice(0, 500),
      status: 'pending',
      bot_instance: process.env.BOT_INSTANCE_ID || 'sim3',
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
      return null;
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

async function sendOne(sb, apiKey, { client, mail }) {
  const row = await claim(sb, {
    campaign: CAMPAIGN,
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
        fromName: FROM_NAME,
      });
      await mark(sb, row.id, 'sent');
      return { ok: true, skipped: false };
    } catch (err) {
      lastErr = err.message || String(err);
      if (
        err.status === 429 ||
        /rate|limit|too many|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|socket/i.test(
          lastErr
        )
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

async function markStalePending(sb) {
  await sb
    .from('outbound_messages')
    .update({ status: 'failed', error: 'pending coupé — relance' })
    .eq('campaign', CAMPAIGN)
    .eq('channel', 'email')
    .eq('status', 'pending');
}

async function runJob({ apiKey }) {
  const sb = getSupabase();
  await markStalePending(sb);
  log(`SEND start — Balma restants, 1 mail David, concurrency=${CONCURRENCY} delay=${DELAY_MS}ms`);

  const [clients, unsubscribed, already] = await Promise.all([
    fetchAllClients(sb),
    fetchSet(sb, 'email_unsubscribes', 'email'),
    fetchSet(sb, 'outbound_messages', 'recipient', (q) =>
      q.eq('campaign', CAMPAIGN).eq('channel', 'email').in('status', ['sent', 'pending'])
    ),
  ]);

  const unique = [];
  const seen = new Set();
  for (const client of clients) {
    const email = String(client.email || '')
      .trim()
      .toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!isBalma(client.salle)) continue;
    if (isBlocked(email)) continue;
    if (unsubscribed.has(email)) continue;
    seen.add(email);
    unique.push({ ...client, email });
  }

  const queue = unique.filter((c) => !already.has(c.email));
  state.audience = unique.length;
  state.queue = queue.length;
  log(`audience=${unique.length} already=${already.size} queue=${queue.length}`);

  if (queue.some((c) => isBlocked(c.email))) {
    throw new Error('boxingcenter31 a fuité dans la file — abort');
  }

  let next = 0;
  let consecutiveFail = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= queue.length) return;
      const client = queue[i];
      try {
        const mail = buildMail(greetingName(client.prenom, client.nom));
        const r = await sendOne(sb, apiKey, { client, mail });
        if (r.ok) {
          state.sent += 1;
          consecutiveFail = 0;
          already.add(client.email);
        } else if (r.skipped) {
          state.skipped += 1;
          already.add(client.email);
        } else {
          state.failed += 1;
          consecutiveFail += 1;
          if (consecutiveFail >= 12) {
            throw new Error(`Trop d’échecs d’affilée (${consecutiveFail}) — stop`);
          }
        }
        state.done = i + 1;
        if ((state.sent + state.failed) % 25 === 0 || i === queue.length - 1) {
          log(`progress ${i + 1}/${queue.length} sent=${state.sent} failed=${state.failed}`);
        }
        if (i < queue.length - 1) await sleep(DELAY_MS);
      } catch (err) {
        const msg = err.message || String(err);
        if (/Trop d’échecs/i.test(msg)) throw err;
        log(`WORKER ${client.email} ${msg}`);
        await sleep(10000);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`DONE sent=${state.sent} failed=${state.failed} skipped=${state.skipped} queue=${queue.length}`);
}

function start({ resendApiKey } = {}) {
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY manquant' };
  }
  if (state.running) {
    return { ok: true, alreadyRunning: true, ...snapshot() };
  }

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.done = 0;
  state.sent = 0;
  state.failed = 0;
  state.skipped = 0;

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

module.exports = {
  start,
  status: snapshot,
};
