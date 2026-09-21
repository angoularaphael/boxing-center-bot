'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const campaign = require('../seanceOfferteSport2000');

test('mail Sport2000 — 1 message David depuis no-reply@', () => {
  const mail = campaign._test.buildMail('Jeremy', '', 'jeremyfidge@gmail.com');
  assert.equal(mail.subject, 'Salut Jeremy');
  assert.match(mail.text, /C’est David du Boxing Center/);
  assert.match(mail.text, /jamais fait de boxe|débutant/i);
  assert.match(mail.text, /pas besoin d’expérience|matériel/i);
  assert.match(mail.text, /seance-offerte\.boxingcenter\.fr/);
  assert.match(mail.text, /boxingcenter\.fr/);
  assert.doesNotMatch(mail.text, /Comment tu vas|Languedoc|31000/i);
  assert.equal(campaign._test.FROM_EMAIL, 'no-reply@boxingcenter.fr');
  assert.equal(campaign._test.FROM_NAME, 'David');
  assert.equal(campaign._test.CAMPAIGN, 'sport2000_noreply_2026');
  assert.equal(typeof campaign._test.buildHiMail, 'undefined');
});

test('slice first/second', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ email: `a${i}@x.fr` }));
  assert.equal(campaign._test.sliceAudience(rows, 'first').length, 5);
  assert.equal(campaign._test.sliceAudience(rows, 'second').length, 5);
});
