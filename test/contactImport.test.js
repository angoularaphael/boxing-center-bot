'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContactRow, parseSaveTargets, contactDisplayName } = require('../lib/contactImport');

test('parseSaveTargets — manager seul', () => {
  const t = parseSaveTargets('.savecontacts manager');
  assert.equal(t.managers, true);
  assert.equal(t.promoteurs, false);
});

test('parseSaveTargets — les deux par defaut', () => {
  const t = parseSaveTargets('.savecontacts');
  assert.equal(t.managers, true);
  assert.equal(t.promoteurs, true);
});

test('buildContactRow — telephone FR', () => {
  const row = buildContactRow({ nom: 'Test Manager', telephone: '0612345678' });
  assert.equal(row.telephone, '33612345678');
  assert.equal(row.has_phone, true);
  assert.equal(row.contact_type, 'phone_only');
});

test('contactDisplayName — fallback telephone', () => {
  assert.equal(contactDisplayName({ nom: '', telephone: '33612345678' }), '+33612345678');
});
