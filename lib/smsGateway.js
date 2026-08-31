'use strict';

const DEFAULT_SMS_GATEWAY_URL = 'http://prem-eu2.bot-hosting.net:21724';

let cachedToken = null;
let cachedTokenAt = 0;

function smsGatewayUrl() {
  const raw = process.env.SMS_GATEWAY_URL || DEFAULT_SMS_GATEWAY_URL;
  let url = String(raw || '').trim().replace(/\/$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

function smsSecret() {
  return String(process.env.SMS_GATEWAY_SECRET || process.env.OUTBOUND_API_SECRET || '').trim();
}

function toE164(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length === 10) digits = `33${digits.slice(1)}`;
  if (digits.startsWith('330') && digits.length === 12) digits = `33${digits.slice(3)}`;
  if (!digits.startsWith('33') && digits.length === 9) digits = `33${digits}`;
  return digits.length >= 10 ? `+${digits.replace(/^\+/, '')}` : null;
}

function toGsmSafe(text) {
  return String(text || '')
    .replace(/€/g, 'euros')
    .replace(/[‘’‚‛‹›]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ê/g, 'e')
    .replace(/Ê/g, 'E')
    .replace(/î/g, 'i')
    .replace(/Î/g, 'I')
    .replace(/ô/g, 'o')
    .replace(/Ô/g, 'O')
    .replace(/â/g, 'a')
    .replace(/Â/g, 'A')
    .replace(/\*/g, '')
    .replace(/~/g, '-')
    .replace(/[🚀🔥💥⏳🥊🚨]/g, '')
    .replace(/ +/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

async function smsJson(path, { method = 'GET', body, timeoutMs = 20000, token, secret } = {}) {
  const base = smsGatewayUrl();
  if (!base) throw new Error('SMS_GATEWAY_URL manquant');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (secret) headers['x-api-secret'] = secret;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 180) || `HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function smsGatewayToken(timeoutMs = 18000) {
  if (cachedToken && Date.now() - cachedTokenAt < 50 * 60 * 1000) return cachedToken;
  const email = String(process.env.SMS_GATEWAY_EMAIL || process.env.ADMIN_EMAIL || 'angoularaphael05@gmail.com').trim();
  const password = String(process.env.SMS_GATEWAY_PASSWORD || process.env.ADMIN_PASSWORD || 'Fareno12').trim();
  const data = await smsJson('/api/auth/login', {
    method: 'POST',
    timeoutMs,
    body: { email, password },
  });
  if (!data?.token) throw new Error('Login SMS gateway sans token');
  cachedToken = data.token;
  cachedTokenAt = Date.now();
  return cachedToken;
}

async function sendViaCampaignQueue(telephone, message, { timeoutMs = 25000, source = 'bot' } = {}) {
  const text = toGsmSafe(message);
  if (!text) throw new Error('Message vide');
  const token = await smsGatewayToken(timeoutMs);
  const campaign = await smsJson('/api/campaigns', {
    method: 'POST',
    token,
    timeoutMs,
    body: {
      name: `Bot SMS ${source} ${Date.now()}`.slice(0, 80),
      message: text,
    },
  });
  if (!campaign?.id) throw new Error('Création campagne SMS échouée');
  await smsJson(`/api/campaigns/${campaign.id}/contacts`, {
    method: 'POST',
    token,
    timeoutMs,
    body: { prenom: 'Client', nom: source || '-', telephone: String(telephone).replace(/\D/g, '') },
  });
  const start = await smsJson(`/api/campaigns/${campaign.id}/start`, {
    method: 'POST',
    token,
    timeoutMs,
  });
  if (!start?.queued) throw new Error('SMS non mis en file (campagne)');
  return {
    sent: true,
    queued: true,
    via: 'sms-campaign',
    campaignId: campaign.id,
    telephone,
    queuedCount: start.queued,
  };
}

async function sendSmsGatewayMessage(phone, message, { timeoutMs = 20000, source = 'bot' } = {}) {
  const telephone = toE164(phone);
  if (!telephone) throw new Error(`Numéro invalide : ${phone}`);
  const secret = smsSecret();
  try {
    const data = await smsJson('/api/messages/send', {
      method: 'POST',
      timeoutMs,
      secret,
      body: { telephone, message, source },
    });
    return { sent: true, via: 'sms', ...data };
  } catch (err) {
    return sendViaCampaignQueue(telephone, message, { timeoutMs: Math.max(timeoutMs, 25000), source });
  }
}

module.exports = { smsGatewayUrl, toE164, sendSmsGatewayMessage };
