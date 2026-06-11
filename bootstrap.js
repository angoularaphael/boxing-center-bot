/**
 * Boxing Center — Bootstrap Bothosting (comme NYC Cookies)
 * Renommez en index.js à la racine du projet Bothosting.
 *
 * Important : on lance le bot en processus principal (pas PM2 en arrière-plan),
 * sinon Pterodactyl marque le serveur « offline ».
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GITHUB_REPO_URL = process.env.BOT_GITHUB_REPO || 'https://github.com/angoularaphael/boxing-center-bot.git';
const APP_DIR_NAME = process.env.BOT_APP_DIR || 'boxing-center-bot-app';
const APP_DIR = path.join(__dirname, APP_DIR_NAME);
const BOT_PORT = process.env.SERVER_PORT || process.env.PORT || '20042';

const ENV_KEYS = [
    'PORT',
    'SITE_API_SECRET',
    'NEXT_PUBLIC_SITE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MANDATORY_ADMIN_PHONE',
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
    'BOT_PUBLIC_URL',
    'RECEPTION_EMAIL',
    'BREVO_REPLY_TO',
    'SERVER_PORT',
];

console.log('=== BOXING CENTER BOT — BOTHOSTING ===');

try {
    const https = require('https');
    https.get('https://api.ipify.org', (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
            console.log(`\n🌍 URL BOT pour Vercel (NEXT_PUBLIC_WHATSAPP_BOT_URL) :`);
            console.log(`   http://us2.bot-hosting.net:${BOT_PORT}`);
            console.log(`   (IP interne : http://${data.trim()}:${BOT_PORT})\n`);
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
    const portLine = `PORT=${BOT_PORT}`;
    lines.push(portLine);

    for (const key of ENV_KEYS) {
        if (key === 'PORT') continue;
        const val = process.env[key];
        if (val != null && val !== '') {
            lines.push(/[\s#]/.test(val) ? `${key}="${String(val).replace(/"/g, '\\"')}"` : `${key}=${val}`);
        }
    }
    if (!lines.some((l) => l.startsWith('BREVO_SENDER_EMAIL='))) {
        lines.push('BREVO_SENDER_EMAIL=suzinabot@gmail.com');
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

const ROOT_ENV = path.join(__dirname, '.env');
const APP_ENV = path.join(APP_DIR, '.env');

/** Utilise /home/container/.env si présent (éditeur Files Bothosting). */
function syncEnvFile() {
    if (fs.existsSync(ROOT_ENV)) {
        fs.copyFileSync(ROOT_ENV, APP_ENV);
        console.log(`✅ .env — copié depuis ${ROOT_ENV}`);
        try {
            require('dotenv').config({ path: ROOT_ENV });
        } catch { /* dotenv optionnel dans bootstrap */ }
        return;
    }
    fs.writeFileSync(APP_ENV, buildEnv(), 'utf8');
    console.log('✅ .env — généré depuis variables panneau (pas de .env racine)');
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
