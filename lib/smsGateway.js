'use strict';

const DEFAULT_SMS_GATEWAY_URL = 'http://prem-eu2.bot-hosting.net:21724';

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

async function sendSmsGatewayMessage(phone, message, { timeoutMs = 20000, source = 'bot' } = {}) {
  const base = smsGatewayUrl();
  if (!base) throw new Error('SMS_GATEWAY_URL manquant');
  const telephone = toE164(phone);
  if (!telephone) throw new Error(`Numéro invalide : ${phone}`);
  const secret = smsSecret();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(secret ? { 'x-api-secret': secret } : {}),
      },
      body: JSON.stringify({ telephone, message, source }),
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
    return { sent: true, via: 'sms', ...data };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { smsGatewayUrl, toE164, sendSmsGatewayMessage };
