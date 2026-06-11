const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
let publicUrl = null;
let tunnelChild = null;

function isEnabled() {
    const raw = process.env.CLOUDFLARE_TUNNEL;
    if (raw == null || raw === '') return false;
    return !['0', 'false', 'no', 'off'].includes(String(raw).toLowerCase());
}

function getTunnelPublicUrl() {
    return publicUrl;
}

function cloudflaredAsset() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    if (process.platform === 'win32') return `cloudflared-windows-${arch}.exe`;
    if (process.platform === 'darwin') return `cloudflared-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}`;
    return `cloudflared-linux-${arch}`;
}

function tryCloudflaredBin() {
    try {
        execFileSync('cloudflared', ['--version'], { stdio: 'ignore' });
        return 'cloudflared';
    } catch {
        return null;
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const request = (targetUrl) => {
            https
                .get(targetUrl, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        request(res.headers.location);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`Téléchargement cloudflared HTTP ${res.statusCode}`));
                        return;
                    }
                    res.pipe(file);
                    file.on('finish', () => {
                        file.close(() => resolve());
                    });
                })
                .on('error', reject);
        };
        request(url);
    });
}

async function ensureCloudflaredBin() {
    const fromPath = tryCloudflaredBin();
    if (fromPath) return fromPath;

    const binDir = path.join(__dirname, 'bin');
    const asset = cloudflaredAsset();
    const binName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    const binPath = path.join(binDir, binName);

    if (fs.existsSync(binPath)) {
        try {
            fs.chmodSync(binPath, 0o755);
        } catch {
            /* Windows */
        }
        return binPath;
    }

    fs.mkdirSync(binDir, { recursive: true });
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
    console.log(`⬇️  Téléchargement cloudflared (${asset})…`);
    await downloadFile(url, binPath);
    try {
        fs.chmodSync(binPath, 0o755);
    } catch {
        /* Windows */
    }
    return binPath;
}

function announceTunnelUrl(url) {
    publicUrl = url.replace(/\/$/, '');
    console.log('\n🔒 Tunnel Cloudflare HTTPS (pour Vercel) :');
    console.log(`   ${publicUrl}`);
    console.log('\n   → Variables Vercel (Production + Preview) :');
    console.log(`   WHATSAPP_BOT_URL=${publicUrl}`);
    console.log(`   NEXT_PUBLIC_WHATSAPP_BOT_URL=${publicUrl}`);
    console.log('   Puis redéployez gestion-manager.\n');
}

function parseTunnelOutput(text) {
    const match = String(text).match(TUNNEL_URL_RE);
    if (!match) return;
    const url = match[0];
    if (url !== publicUrl) announceTunnelUrl(url);
}

function startCloudflareTunnel(localPort) {
    if (!isEnabled()) return;

    const localUrl = `http://127.0.0.1:${localPort}`;

    (async () => {
        try {
            const bin = await ensureCloudflaredBin();
            tunnelChild = spawn(bin, ['tunnel', '--url', localUrl, '--no-autoupdate'], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            tunnelChild.stdout.on('data', (chunk) => parseTunnelOutput(chunk.toString()));
            tunnelChild.stderr.on('data', (chunk) => parseTunnelOutput(chunk.toString()));

            tunnelChild.on('error', (err) => {
                console.warn('⚠️  Tunnel Cloudflare :', err.message);
            });

            tunnelChild.on('exit', (code) => {
                if (code != null && code !== 0) {
                    console.warn(`⚠️  Tunnel Cloudflare arrêté (code ${code})`);
                }
            });

            const stop = () => {
                if (tunnelChild && !tunnelChild.killed) tunnelChild.kill();
            };
            process.on('exit', stop);
            process.on('SIGINT', stop);
            process.on('SIGTERM', stop);
        } catch (err) {
            console.warn('⚠️  Tunnel Cloudflare non démarré :', err.message);
            console.warn('   Activez avec CLOUDFLARE_TUNNEL=true ou installez cloudflared.');
        }
    })();
}

module.exports = { startCloudflareTunnel, getTunnelPublicUrl, isEnabled };
