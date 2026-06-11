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

const ENV_KEYS = [
    'PORT',
    'SITE_API_SECRET',
    'NEXT_PUBLIC_SITE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MANDATORY_ADMIN_PHONE',
    'BREVO_API_KEY',
    'BREVO_SENDER_EMAIL',
    'BREVO_SENDER_NAME',
];

console.log('=== BOXING CENTER BOT — BOTHOSTING ===');

try {
    const https = require('https');
    https.get('https://api.ipify.org', (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
            const port = process.env.PORT || '3002';
            console.log(`\n🌍 URL BOT pour Vercel (NEXT_PUBLIC_WHATSAPP_BOT_URL) : http://${data.trim()}:${port}\n`);
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
    for (const key of ENV_KEYS) {
        const val = process.env[key];
        if (val != null && val !== '') {
            lines.push(/[\s#]/.test(val) ? `${key}="${String(val).replace(/"/g, '\\"')}"` : `${key}=${val}`);
        }
    }
    if (!lines.some((l) => l.startsWith('PORT='))) lines.push('PORT=3002');
    if (!lines.some((l) => l.startsWith('BREVO_SENDER_EMAIL='))) {
        lines.push('BREVO_SENDER_EMAIL=boxingcenter31@gmail.com');
    }
    if (!lines.some((l) => l.startsWith('BREVO_SENDER_NAME='))) {
        lines.push('BREVO_SENDER_NAME=Boxing Center');
    }
    return `${lines.join('\n')}\n`;
}

async function bootstrap() {
    if (!fs.existsSync(APP_DIR)) {
        if (!runCommand(`git clone ${GITHUB_REPO_URL} ${APP_DIR_NAME}`)) process.exit(1);
    } else {
        runCommand('git pull', APP_DIR);
    }

    fs.writeFileSync(path.join(APP_DIR, '.env'), buildEnv(), 'utf8');
    console.log('✅ .env généré');

    if (!runCommand('npm install --omit=dev', APP_DIR)) process.exit(1);

    let usePM2 = false;
    try { execSync('pm2 -v', { stdio: 'ignore' }); usePM2 = true; } catch { /* */ }

    if (usePM2) {
        const eco = `module.exports = { apps: [{ name: 'boxing-center-bot', script: './index.js', cwd: ${JSON.stringify(APP_DIR)}, autorestart: true, max_memory_restart: '400M' }] };`;
        fs.writeFileSync(path.join(APP_DIR, 'ecosystem.config.js'), eco, 'utf8');
        runCommand('pm2 startOrRestart ecosystem.config.js', APP_DIR);
        console.log('✅ Bot démarré (PM2)');
    } else {
        process.chdir(APP_DIR);
        require('./index.js');
    }
}

bootstrap();
