#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BD = [path.join(ROOT, 'BD-ENFANTS-1.xls'), path.join(ROOT, 'bd-enfants-2.csv')];

function parseSemicolonCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ';') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || (ch === '\r' && next === '\n')) {
      if (ch === '\r') i++;
      row.push(field);
      field = '';
      if (row.some((c) => String(c || '').trim())) rows.push(row);
      row = [];
      continue;
    }
    if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => String(c || '').trim())) rows.push(row);
  }
  return rows;
}

function normEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function titleCase(raw) {
  const s = String(raw || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

const byId = new Map();
for (const file of BD) {
  if (!fs.existsSync(file)) {
    console.warn('missing', file);
    continue;
  }
  const rows = parseSemicolonCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const header = rows.shift() || [];
  const idx = (name) => header.findIndex((h) => String(h).replace(/"/g, '') === name);
  const iId = idx('Id_client');
  const iPrenom = idx('Prénom');
  const iNom = idx('Nom');
  const iEmail = idx('E-mail');
  const iMailing = idx('OK.mailing');
  for (const row of rows) {
    const id = String(row[iId] || '').replace(/"/g, '').trim();
    if (!id) continue;
    const okMailing = String(row[iMailing] || 'O').replace(/"/g, '').trim().toUpperCase();
    const email = okMailing === 'O' ? normEmail(row[iEmail]) : '';
    if (!email) continue;
    byId.set(id, {
      id,
      prenom: titleCase(String(row[iPrenom] || '').replace(/"/g, '')),
      nom: String(row[iNom] || '').replace(/"/g, '').trim(),
      email,
    });
  }
}

const emailSeen = new Set();
const out = [];
for (const row of byId.values()) {
  if (emailSeen.has(row.email)) continue;
  emailSeen.add(row.email);
  out.push(row);
}

const dest = path.join(__dirname, '..', 'data', 'enfants-audience.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(JSON.stringify({ written: out.length, dest }, null, 2));
