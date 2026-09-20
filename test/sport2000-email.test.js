'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const campaign = require('../seanceOfferteSport2000');

test('mail Sport2000 — format promo (HTML + désabo → Promotions)', () => {
  const mail = campaign._test.buildMail('Jeremy', 'Fidge', 'jeremyfidge@gmail.com');
  assert.equal(mail.subject, 'Jeremy, séance d’essai Boxing Center');
  assert.match(mail.text, /séance d’essai/);
  assert.match(mail.text, /Désinscription/);
  assert.match(mail.text, /boxingcenter\.fr/);
  assert.match(mail.html, /Réserver ma séance/);
  assert.match(mail.html, /List-Unsubscribe|Desinscription|stop/i);
  assert.equal(campaign._test.FROM_NAME, 'Boxing Center');
  assert.equal(campaign._test.LINK, 'https://seance-offerte.boxingcenter.fr/?src=email');
  assert.equal(campaign._test.SITE_LINK, 'https://boxingcenter.fr');
  assert.equal(campaign._test.REPLY_TO, 'boxingcentertls@gmail.com');
});

test('slice first/second', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ email: `a${i}@x.fr` }));
  assert.equal(campaign._test.sliceAudience(rows, 'first').length, 5);
  assert.equal(campaign._test.sliceAudience(rows, 'second').length, 5);
});
