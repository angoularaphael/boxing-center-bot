'use strict';

/**
 * Campagne mail stage vacances — adhérents Deciplus (Brevo, repo stage-boxing).
 * Fichiers Deciplus : data/stage-adherents-membres/membres (20).csv + membres (15).xls
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = process.env.STAGE_MAIL_REPO || 'https://github.com/angoularaphael/stage-boxing.git';
const BRANCH = process.env.STAGE_MAIL_BRANCH || 'main';
const APP = path.join(__dirname, 'data', 'stage-boxeur-app');
const MEMBRES_DIR = path.join(__dirname, 'data', 'stage-adherents-membres');

let child = null;

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  pid: null,
  logTail: '',
};

function snapshot() {
  return {
    ...state,
    repo: REPO,
    branch: BRANCH,
    membresDir: MEMBRES_DIR,
    replyTo: process.env.BREVO_REPLY_TO || 'boxingcentertls@gmail.com',
  };
}

function log(line) {
  console.log(`[stage-adherents-mail] ${line}`);
}

function appendLog(chunk) {
  const s = String(chunk || '');
  state.logTail = (state.logTail + s).slice(-4000);
  for (const line of s.split(/\r?\n/)) {
    if (line.trim()) log(line.trim());
  }
}

function membresPaths() {
  return {
    csv: path.join(MEMBRES_DIR, 'membres (20).csv'),
    xls: path.join(MEMBRES_DIR, 'membres (15).xls'),
  };
}

function uploadMembres({ csv_b64, xls_b64 } = {}) {
  fs.mkdirSync(MEMBRES_DIR, { recursive: true });
  const paths = membresPaths();
  if (csv_b64) fs.writeFileSync(paths.csv, Buffer.from(String(csv_b64), 'base64'));
  if (xls_b64) fs.writeFileSync(paths.xls, Buffer.from(String(xls_b64), 'base64'));
  const ok = fs.existsSync(paths.csv) && fs.existsSync(paths.xls);
  return {
    ok,
    paths,
    csvBytes: fs.existsSync(paths.csv) ? fs.statSync(paths.csv).size : 0,
    xlsBytes: fs.existsSync(paths.xls) ? fs.statSync(paths.xls).size : 0,
  };
}

function ensureRepo() {
  const script = path.join(APP, 'scripts', 'send-mail-adherents-campaign.mjs');
  if (fs.existsSync(script)) {
    try {
      execSync(`git fetch origin && git reset --hard origin/${BRANCH}`, {
        cwd: APP,
        stdio: 'pipe',
        timeout: 120000,
        shell: true,
      });
    } catch (err) {
      log(`git update ignore: ${String(err.message || err).slice(0, 120)}`);
    }
    return;
  }
  log(`Clone ${REPO}...`);
  if (fs.existsSync(APP)) fs.rmSync(APP, { recursive: true, force: true });
  execSync(
    `git clone --depth 1 --single-branch --branch ${BRANCH} "${REPO}" "${APP}"`,
    { stdio: 'inherit', shell: true, timeout: 300000 }
  );
}

function start({ now = true, start = '15:30', end = '17:30', force = false } = {}) {
  if (state.running && child && !force) {
    return { ok: false, error: 'campagne déjà en cours', alreadyRunning: true };
  }
  if (child && force) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    child = null;
  }

  const paths = membresPaths();
  if (!fs.existsSync(paths.csv) || !fs.existsSync(paths.xls)) {
    return { ok: false, error: 'membres (20).csv / membres (15).xls manquants sur le serveur' };
  }

  try {
    ensureRepo();
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }

  const script = path.join(APP, 'scripts', 'send-mail-adherents-campaign.mjs');
  if (!fs.existsSync(script)) {
    return { ok: false, error: 'script campagne introuvable après clone' };
  }

  const args = [
    script,
    '--run',
    `--start=${start}`,
    `--end=${end}`,
    `--data-root=${MEMBRES_DIR}`,
  ];
  if (now) args.push('--now');

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.logTail = '';

  child = spawn(process.execPath, args, {
    cwd: APP,
    env: {
      ...process.env,
      BREVO_SENDER_NAME: 'David — Boxing Center',
      BREVO_REPLY_TO: process.env.BREVO_REPLY_TO || 'boxingcentertls@gmail.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.pid = child.pid;

  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('error', (err) => {
    state.error = err.message || String(err);
    state.running = false;
    state.finishedAt = new Date().toISOString();
    child = null;
  });
  child.on('exit', (code) => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    if (code && code !== 0) state.error = state.error || `exit ${code}`;
    child = null;
    log(`process exit ${code}`);
  });

  return { ok: true, pid: state.pid, now: Boolean(now), end, dataRoot: MEMBRES_DIR };
}

function stop() {
  if (!child) {
    state.running = false;
    return { ok: true, stopped: false, note: 'aucun processus' };
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  state.running = false;
  state.finishedAt = new Date().toISOString();
  return { ok: true, stopped: true };
}

function status() {
  return snapshot();
}

module.exports = { start, stop, status, uploadMembres, membresPaths };
