'use strict';

/**
 * Test mail Sport2000 David → une adresse.
 *   node scripts/send-sport2000-test.js ymanga03@gmail.com Raphael
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

// Forcer Reply-To campagne même si .env a une autre valeur
process.env.RESEND_REPLY_TO = 'boxingcentertls@gmail.com';

const campaign = require('../seanceOfferteSport2000');

async function main() {
  const to = String(process.argv[2] || 'ymanga03@gmail.com').trim().toLowerCase();
  const prenom = String(process.argv[3] || 'Raphael').trim();
  const result = await campaign.sendTest({ to, prenom });
  if (!result.ok) {
    console.error('FAIL', result.error);
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    id: result.id,
    to,
    subject: result.subject,
    from: `${result.fromName || 'David de Boxing Center'} <${result.from}>`,
    replyTo: result.replyTo,
    link: result.link,
  }, null, 2));
  console.log('--- BODY ---');
  console.log(result.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
