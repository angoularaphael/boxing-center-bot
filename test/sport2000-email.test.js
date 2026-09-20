'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const campaign = require('../seanceOfferteSport2000');

test('paire Sport2000 — hi puis David, même objet, david@, sans adresse', () => {
  const hi = campaign._test.buildHiMail('Yanis', '', 'stariayanis422@gmail.com');
  const david = campaign._test.buildDavidMail('Yanis', '', 'stariayanis422@gmail.com');
  assert.equal(hi.subject, 'Salut Yanis');
  assert.equal(david.subject, hi.subject);
  assert.match(hi.text, /Comment tu vas/);
  assert.doesNotMatch(hi.text, /https?:\/\//);
  assert.match(david.text, /C’est David du Boxing Center/);
  assert.match(david.text, /seance-offerte\.boxingcenter\.fr/);
  assert.match(david.text, /boxingcenter\.fr/);
  assert.doesNotMatch(david.text, /Languedoc|31000|rue du/i);
  assert.equal(campaign._test.FROM_EMAIL, 'david@boxingcenter.fr');
  assert.equal(campaign._test.FROM_NAME, 'David');
  assert.equal(campaign._test.PAIR_GAP_MS, 7000);
  assert.equal(campaign._test.REPLY_TO, 'boxingcentertls@gmail.com');
});

test('slice first/second', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ email: `a${i}@x.fr` }));
  assert.equal(campaign._test.sliceAudience(rows, 'first').length, 5);
  assert.equal(campaign._test.sliceAudience(rows, 'second').length, 5);
});
