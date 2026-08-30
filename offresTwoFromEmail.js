'use strict';

/**
 * 2 mails par personne (pas 2 personnes) :
 *   1) De: David de Boxing Center
 *   2) 12 s plus tard, De: David
 * slice=first : première moitié (sim1).
 * slice=second : le reste hors Balma (sim3 / 20695).
 * Reprise via offres_promo_from1 / from2.
 */

const { getSupabase } = require('./supabase');

const CAMPAIGN_1 = 'offres_promo_from1';
const CAMPAIGN_2 = 'offres_promo_from2';
const FROM_1 = 'David de Boxing Center';
const FROM_2 = 'David';
const HUB = 'https://boutique.boxingcenter.fr/offres-speciales';
const FROM_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
const REPLY_TO = 'boxingcentertls@gmail.com';
const PAIR_GAP_MS = Math.max(1000, parseInt(process.env.OFFRES_PAIR_GAP_MS || '12000', 10) || 12000);
const DELAY_MS = Math.max(200, parseInt(process.env.OFFRES_HALF_DELAY_MS || '800', 10) || 800);
const CONCURRENCY = Math.max(1, parseInt(process.env.OFFRES_PAIR_CONCURRENCY || '2', 10) || 2);
/** Resend = 10 req/s sur la clé. 2 bots → ~3,5 req/s chacun. */
const MIN_GAP_MS = Math.max(150, parseInt(process.env.OFFRES_RESEND_MIN_GAP_MS || '280', 10) || 280);

let nextSlotAt = 0;
let slotChain = Promise.resolve();

function waitForResendSlot() {
  const run = slotChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlotAt - now);
    nextSlotAt = Math.max(nextSlotAt, now) + MIN_GAP_MS;
    if (wait) await sleep(wait);
  });
  slotChain = run.catch(() => {});
  return run;
}

function pauseResendSlots(ms) {
  nextSlotAt = Math.max(nextSlotAt, Date.now() + ms);
}

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  audience: 0,
  half: 0,
  queue: 0,
  needBoth: 0,
  needOnly1: 0,
  needOnly2: 0,
  done: 0,
  sent1: 0,
  sent2: 0,
  failed: 0,
  skipped: 0,
  slice: 'first',
};

function snapshot() {
  return {
    ...state,
    pair: '1 personne = 2 mails',
    from1: FROM_1,
    from2: FROM_2,
    gapMs: PAIR_GAP_MS,
    delayMs: DELAY_MS,
    concurrency: CONCURRENCY,
    minGapMs: MIN_GAP_MS,
  };
}

function resolveSlice(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'second' || v === 'rest' || v === '2') return 'second';
  return 'first';
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
    'C’est David. Il reste encore quelques places pour les deux formules en cours.',
    '',
    '29 euros les 4 semaines : sans engagement, sans préavis si tu pars, accès aux 5 salles, toutes les disciplines, tous les cours.',
    '',
    '259 euros les 12 mois : au lieu de 400 euros, tu peux payer en 4 fois sans frais. Mêmes salles, mêmes cours.',
    '',
    'Tout se passe ici :',
    HUB,
    '',
    '29 euros sans engagement, 259 euros pour l’année. Tant qu’il reste de la place.',
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
  console.log(`[offres-two-from] ${line}`);
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
  await waitForResendSlot();
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

async function sendOne(sb, apiKey, { client, mail, campaign, fromName }) {
  const row = await claim(sb, {
    campaign,
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
        fromName,
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
        const wait = 20000 * attempt + Math.floor(Math.random() * 8000);
        log(`RETRY ${fromName} ${client.email} wait ${wait}ms (${lastErr})`);
        if (err.status === 429 || /too many/i.test(lastErr)) pauseResendSlots(wait);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  await mark(sb, row.id, 'failed', lastErr);
  log(`FAIL ${fromName} ${client.email} ${lastErr}`);
  return { ok: false, skipped: false, error: lastErr };
}

async function markStalePending(sb, campaign) {
  const inst = String(process.env.BOT_INSTANCE_ID || '').trim();
  if (!inst) return;
  await sb
    .from('outbound_messages')
    .update({ status: 'failed', error: 'pending coupé — relance' })
    .eq('campaign', campaign)
    .eq('channel', 'email')
    .eq('status', 'pending')
    .eq('bot_instance', inst);
}

async function runJob({ apiKey, slice }) {
  const sb = getSupabase();
  await markStalePending(sb, CAMPAIGN_1);
  await markStalePending(sb, CAMPAIGN_2);

  log(
    `SEND start — slice=${slice} 1 personne = 2 mails, gap=${PAIR_GAP_MS}ms concurrency=${CONCURRENCY}`
  );

  const [clients, unsubscribed, already1, already2] = await Promise.all([
    fetchAllClients(sb),
    fetchSet(sb, 'email_unsubscribes', 'email'),
    fetchSet(sb, 'outbound_messages', 'recipient', (q) =>
      q.eq('campaign', CAMPAIGN_1).eq('channel', 'email').in('status', ['sent', 'pending'])
    ),
    fetchSet(sb, 'outbound_messages', 'recipient', (q) =>
      q.eq('campaign', CAMPAIGN_2).eq('channel', 'email').in('status', ['sent', 'pending'])
    ),
  ]);

  const unique = [];
  const seen = new Set();
  for (const client of clients) {
    const email = String(client.email || '')
      .trim()
      .toLowerCase();
    if (!email || seen.has(email)) continue;
    if (isBlocked(email)) continue;
    if (isBalma(client.salle)) continue;
    if (unsubscribed.has(email)) continue;
    seen.add(email);
    unique.push({ ...client, email });
  }

  const half = Math.floor(unique.length / 2);
  const pool = slice === 'second' ? unique.slice(half) : unique.slice(0, half);
  const queue = pool.filter((c) => !already1.has(c.email) || !already2.has(c.email));
  const needBoth = queue.filter((c) => !already1.has(c.email) && !already2.has(c.email)).length;
  const needOnly2 = queue.filter((c) => already1.has(c.email) && !already2.has(c.email)).length;
  const needOnly1 = queue.filter((c) => !already1.has(c.email) && already2.has(c.email)).length;

  state.audience = unique.length;
  state.half = pool.length;
  state.slice = slice;
  state.queue = queue.length;
  state.needBoth = needBoth;
  state.needOnly1 = needOnly1;
  state.needOnly2 = needOnly2;

  log(
    `audience=${unique.length} slice=${slice} pool=${pool.length} queue=${queue.length} need_both=${needBoth} need_only1=${needOnly1} need_only2=${needOnly2}`
  );

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
        if (isBlocked(client.email)) {
          state.skipped += 1;
          continue;
        }

        const mail = buildMail(greetingName(client.prenom, client.nom));
        const want1 = !already1.has(client.email);
        const want2 = !already2.has(client.email);

        if (want1) {
          const r1 = await sendOne(sb, apiKey, {
            client,
            mail,
            campaign: CAMPAIGN_1,
            fromName: FROM_1,
          });
          if (r1.ok) {
            state.sent1 += 1;
            consecutiveFail = 0;
            already1.add(client.email);
          } else if (r1.skipped) {
            already1.add(client.email);
          } else {
            state.failed += 1;
            consecutiveFail += 1;
            if (consecutiveFail >= 12) {
              throw new Error(`Trop d’échecs d’affilée (${consecutiveFail}) — stop`);
            }
            state.done = i + 1;
            continue;
          }
          if (want2) await sleep(PAIR_GAP_MS);
        }

        if (want2 && already1.has(client.email)) {
          const r2 = await sendOne(sb, apiKey, {
            client,
            mail,
            campaign: CAMPAIGN_2,
            fromName: FROM_2,
          });
          if (r2.ok) {
            state.sent2 += 1;
            consecutiveFail = 0;
            already2.add(client.email);
          } else if (!r2.skipped) {
            state.failed += 1;
            consecutiveFail += 1;
            if (consecutiveFail >= 12) {
              throw new Error(`Trop d’échecs d’affilée (${consecutiveFail}) — stop`);
            }
          }
        }

        state.done = i + 1;
        if ((state.sent1 + state.sent2 + state.failed) % 25 === 0 || i === queue.length - 1) {
          log(
            `progress ${i + 1}/${queue.length} sent1=${state.sent1} sent2=${state.sent2} failed=${state.failed}`
          );
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
  log(`DONE sent1=${state.sent1} sent2=${state.sent2} failed=${state.failed} queue=${queue.length}`);
}

function start({ resendApiKey, slice } = {}) {
  const apiKey = String(resendApiKey || process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY manquant' };
  }
  if (state.running) {
    return { ok: true, alreadyRunning: true, ...snapshot() };
  }

  const resolvedSlice = resolveSlice(slice);
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.done = 0;
  state.sent1 = 0;
  state.sent2 = 0;
  state.failed = 0;
  state.skipped = 0;
  state.slice = resolvedSlice;

  setImmediate(() => {
    runJob({ apiKey, slice: resolvedSlice })
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
