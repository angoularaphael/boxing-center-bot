'use strict';

/** Hub managers / promoteurs — prem-eu4:21357 (Bothosting gestion-manager-1). */
const DEFAULT_HOST = 'prem-eu4.bot-hosting.net';
const DEFAULT_PORT = '21357';
const DEFAULT_DISPLAY_NAME = 'BC-Manager-Hub';

function botPublicHost() {
    return String(process.env.BOT_PUBLIC_HOST || DEFAULT_HOST).trim();
}

function botPublicPort() {
    const raw = process.env.SERVER_PORT || process.env.PORT || DEFAULT_PORT;
    return String(raw).trim();
}

function botPublicUrl() {
    const fromEnv = String(process.env.BOT_PUBLIC_URL || '').trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return `http://${botPublicHost()}:${botPublicPort()}`;
}

function botDisplayName() {
    return String(process.env.BOT_DISPLAY_NAME || DEFAULT_DISPLAY_NAME).trim();
}

module.exports = {
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_DISPLAY_NAME,
    botPublicHost,
    botPublicPort,
    botPublicUrl,
    botDisplayName,
};
