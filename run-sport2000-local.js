'use strict';

/**
 * Relance Sport2000 locale — no-reply, campagne sport2000_noreply_2026 (à 0).
 * Split via BOT_INSTANCE_ID=sim1|sim2 + slice.
 *
 *   set BOT_INSTANCE_ID=sim1 && node run-sport2000-local.js
 *   set BOT_INSTANCE_ID=sim2 && node run-sport2000-local.js
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

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, '..', 'BOXPLUS', '.env'));
loadEnvFile(path.join(__dirname, '..', 'gestion-manager', '.env'));

const sliceArg = process.argv.find((a) => a.startsWith('--slice='))?.slice(8);
const slice = sliceArg || (String(process.env.BOT_INSTANCE_ID || '').includes('2') ? 'second' : 'first');
process.env.BOT_INSTANCE_ID = process.env.BOT_INSTANCE_ID || (slice === 'second' ? 'sim2' : 'sim1');

const campaign = require('./seanceOfferteSport2000');
const started = campaign.start({
  slice,
  force: true,
  resendApiKey: process.env.RESEND_API_KEY,
});
console.log('START SPORT2000', JSON.stringify(started));
if (!started.ok) process.exit(1);

setInterval(() => {
  const s = campaign.status();
  console.log(
    `[sport2000-${slice}] running=${s.running} queue=${s.queue} sent=${s.sent} failed=${s.failed} done=${s.done} from=${s.from} err=${s.error || ''}`
  );
  if (!s.running && s.finishedAt) {
    console.log('DONE', JSON.stringify(s));
    process.exit(0);
  }
}, 15000);
