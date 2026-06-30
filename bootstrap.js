/**
 * Boxing Center — Bootstrap Bothosting (comme NYC Cookies)
 * Renommez en index.js à la racine du projet Bothosting.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GITHUB_REPO_URL = process.env.BOT_GITHUB_REPO || 'https://github.com/angoularaphael/boxing-center-bot.git';
const APP_DIR_NAME = process.env.BOT_APP_DIR || 'boxing-center-bot-app';
const APP_DIR = path.join(__dirname, APP_DIR_NAME);
const ROOT_ENV = path.join(__dirname, '.env');

/** Charge le .env racine (Bothosting) avant de lire PORT — évite le fallback 20042. */
function loadRootEnvIntoProcess() {
    if (!fs.existsSync(ROOT_ENV)) return;
    const text = fs.readFileSync(ROOT_ENV, 'utf8');
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (process.env[key] == null || process.env[key] === '') {
            process.env[key] = val;
        }
    }
}

function resolveBotPort() {
    const raw = process.env.SERVER_PORT || process.env.PORT;
    const port = raw != null ? String(raw).trim() : '';
    if (port && /^\d+$/.test(port)) return port;
    console.error(
        '❌ SERVER_PORT ou PORT manquant — ajoutez-le dans .env à côté de index.js ' +
            '(ex. 21334 Minimes, 20405 Saint-Cyprien, 21357 Ramonville).'
    );
    process.exit(1);
}

loadRootEnvIntoProcess();
const BOT_PORT = resolveBotPort();

const ENV_KEYS = [
    'PORT',
    'SERVER_PORT',
    'BOT_INSTANCE_ID',
    'BOT_PUBLIC_HOST',
    'SITE_API_SECRET',
    'NEXT_PUBLIC_SITE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'MANDATORY_ADMIN_PHONE',
    'CAMPAIGN_TEST_PHONE',
    'CAMPAIGN_TEST_EMAIL',
    'WA_BULK_WINDOW_MS',
    'WA_BULK_MAX_PER_WINDOW',
    'WA_BULK_MAX_PER_HOUR',
    'WA_BULK_DELAY_MS',
    'WA_BULK_DELAY_JITTER_MS',
    'BREVO_API_KEY',
    'BREVO_SMTP_LOGIN',
    'BREVO_SMTP_KEY',
    'BREVO_SMTP_HOST',
    'BREVO_SMTP_PORT',
    'BREVO_SENDER_EMAIL',
    'BREVO_SENDER_NAME',
    'BOXING_CENTER_SITE_URL',
    'BOXING_CENTER_CONTACT_EMAIL',
    'BOXING_CENTER_LOGO_URL',
    'RECEPTION_EMAIL',
    'BREVO_REPLY_TO',
];

console.log('=== BOXING CENTER BOT — BOTHOSTING ===');

try {
    const https = require('https');
    https.get('https://api.ipify.org', (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
            const host = String(process.env.BOT_PUBLIC_HOST || process.env.BOT_HOST || '').trim();
            console.log('\n🌍 ==================================================');
            console.log('🌍 URL BOT pour Vercel (WHATSAPP_BOT_URL_*) :');
            if (host) {
                console.log(`🌍   http://${host}:${BOT_PORT}`);
            }
            console.log(`🌍   http://${data.trim()}:${BOT_PORT}`);
            console.log('🌍 ==================================================\n');
        });
    }).on('error', () => {});
} catch { /* ignore */ }

function runCommand(cmd, cwd = __dirname) {
    console.log(`> ${cmd}`);
    try {
        execSync(cmd, { cwd, stdio: 'inherit' });
        return true;
    } catch (e) {
        console.error(e.message);
        return false;
    }
}

function buildEnv() {
    const lines = ['# Auto-generated bootstrap Boxing Center'];
    lines.push(`PORT=${BOT_PORT}`);

    for (const key of ENV_KEYS) {
        if (key === 'PORT') continue;
        const val = process.env[key];
        if (val != null && val !== '') {
            lines.push(/[\s#]/.test(val) ? `${key}="${String(val).replace(/"/g, '\\"')}"` : `${key}=${val}`);
        }
    }
    if (!lines.some((l) => l.startsWith('BREVO_SENDER_EMAIL='))) {
        lines.push('BREVO_SENDER_EMAIL=suzinabot@11426075.brevosend.com');
    }
    if (!lines.some((l) => l.startsWith('BREVO_SENDER_NAME='))) {
        lines.push('BREVO_SENDER_NAME=Boxing Center');
    }
    if (!lines.some((l) => l.startsWith('RECEPTION_EMAIL='))) {
        lines.push('RECEPTION_EMAIL=boxingcenter31@gmail.com');
    }
    if (!lines.some((l) => l.startsWith('BREVO_REPLY_TO='))) {
        lines.push('BREVO_REPLY_TO=boxingcenter31@gmail.com');
    }
    if (!lines.some((l) => l.startsWith('SERVER_PORT='))) {
        lines.push(`SERVER_PORT=${BOT_PORT}`);
    }
    return `${lines.join('\n')}\n`;
}

const APP_ENV = path.join(APP_DIR, '.env');

function syncEnvFile() {
    if (fs.existsSync(ROOT_ENV)) {
        fs.copyFileSync(ROOT_ENV, APP_ENV);
        console.log(`✅ .env — copié depuis ${ROOT_ENV}`);
        return;
    }
    fs.writeFileSync(APP_ENV, buildEnv(), 'utf8');
    console.log('✅ .env — généré depuis variables panneau');
}

async function bootstrap() {
    if (!fs.existsSync(APP_DIR)) {
        if (!runCommand(`git clone ${GITHUB_REPO_URL} ${APP_DIR_NAME}`)) process.exit(1);
    } else {
        runCommand('git pull', APP_DIR);
    }

    syncEnvFile();

    if (!runCommand('npm install --omit=dev', APP_DIR)) process.exit(1);

    console.log('🚀 Démarrage du bot (processus principal — ne pas quitter)...');
    process.chdir(APP_DIR);
    require(path.join(APP_DIR, 'index.js'));
}

bootstrap();
