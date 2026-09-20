'use strict';

/**
 * Réchauffage david@boxingcenter.fr → temp-mails (mail.tm), PAS la BD Sport2000.
 *
 *   node scripts/warm-david-tempmails.js
 *   node scripts/warm-david-tempmails.js --count=80 --gap=90
 *
 * Défaut : 80 mails, 1 toutes les 90 s (~2 h), messages courts sans lien.
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const ROOT = path.join(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '..', 'BOXPLUS', '.env'));
loadEnvFile(path.join(ROOT, '..', 'gestion-manager', '.env'));

const FROM_NAME = 'David';
const FROM_EMAIL = 'david@boxingcenter.fr';
const REPLY_TO = 'boxingcentertls@gmail.com';
const API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const MAILTM = 'https://api.mail.tm';

const COUNT = Math.max(
  1,
  parseInt(process.argv.find((a) => a.startsWith('--count='))?.slice(8) || '80', 10) || 80
);
const GAP_SEC = Math.max(
  30,
  parseInt(process.argv.find((a) => a.startsWith('--gap='))?.slice(6) || '90', 10) || 90
);

const FIRST_NAMES = [
  'Alex',
  'Sam',
  'Jordan',
  'Chris',
  'Morgan',
  'Taylor',
  'Casey',
  'Riley',
  'Jamie',
  'Avery',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line) {
  console.log(`[warm-david] ${line}`);
}

async function mailTmJson(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${MAILTM}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data['hydra:description'] || data.message || `mail.tm HTTP ${res.status}`);
  }
  return data;
}

async function createTempMailbox() {
  const domains = await mailTmJson('/domains');
  const list = domains['hydra:member'] || [];
  const active = list.find((d) => d.isActive) || list[0];
  if (!active?.domain) throw new Error('mail.tm: aucun domaine');
  const local = `bcw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const address = `${local}@${active.domain}`.toLowerCase();
  const password = `W${Math.random().toString(36).slice(2)}A1!`;
  await mailTmJson('/accounts', { method: 'POST', body: { address, password } });
  return address;
}

function warmBody(prenom, i) {
  const variants = [
    [
      `Salut ${prenom},`,
      '',
      'C’est David du Boxing Center.',
      '',
      'Je teste juste mon adresse mail, tu peux ignorer ce message.',
      '',
      'David',
    ],
    [
      `Bonjour ${prenom},`,
      '',
      'David — Boxing Center Toulouse.',
      '',
      'Petit message de test, rien à faire de ton côté.',
      '',
      'À plus,',
      'David',
    ],
    [
      `${prenom},`,
      '',
      'C’est David.',
      '',
      'Je vérifie que les mails partent bien. Tu peux supprimer.',
      '',
      'David — Boxing Center',
    ],
  ];
  return variants[i % variants.length].join('\n');
}

async function sendOne(to, prenom, i) {
  const subject = i % 2 === 0 ? `Salut ${prenom}` : `${prenom}, c’est David`;
  const text = warmBody(prenom, i);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
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

async function main() {
  if (!API_KEY) {
    console.error('RESEND_API_KEY manquant');
    process.exit(1);
  }

  log(`START count=${COUNT} gap=${GAP_SEC}s from=${FROM_EMAIL} (mail.tm temp only, pas la BD)`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < COUNT; i++) {
    const prenom = FIRST_NAMES[i % FIRST_NAMES.length];
    let to = '';
    try {
      to = await createTempMailbox();
      const id = await sendOne(to, prenom, i);
      sent++;
      log(`OK ${sent}/${COUNT} → ${to} id=${id}`);
    } catch (err) {
      failed++;
      log(`FAIL ${to || 'mailbox'} ${err.message}`);
      if (err.status === 429 || /rate|too many/i.test(err.message || '')) {
        log('rate limit — pause 60s');
        await sleep(60000);
      } else {
        await sleep(5000);
      }
    }
    if (i < COUNT - 1) await sleep(GAP_SEC * 1000);
  }

  log(`DONE sent=${sent} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
