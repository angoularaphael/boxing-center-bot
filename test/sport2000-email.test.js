'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const campaign = require('../seanceOfferteSport2000');

test('mail Sport2000 — anti-spam (marque claire, 1 lien https, adresse)', () => {
  const mail = campaign._test.buildMail('Raphael', 'Angoula', 'ymanga03@gmail.com');
  assert.equal(mail.subject, 'Raphael — Boxing Center');
  assert.match(mail.text, /Minimes|Ramonville|Portet/);
  assert.match(mail.text, /seance-offerte\.boxingcenter\.fr\/\?src=email/);
  assert.match(mail.text, /boxingcenter\.fr/);
  assert.match(mail.text, /2 rue du Languedoc/);
  assert.doesNotMatch(mail.text, /https:\/\/boxingcenter\.fr/);
  assert.doesNotMatch(mail.text, /10\s*€|valeur habituelle|séance offerte|c’est David/i);
  assert.equal(campaign._test.FROM_NAME, 'David de Boxing Center');
  assert.equal(campaign._test.LINK, 'https://seance-offerte.boxingcenter.fr/?src=email');
  assert.equal(campaign._test.REPLY_TO, 'boxingcentertls@gmail.com');
  assert.equal(campaign._test.DELAY_MS, 3000);
});

test('slice first/second', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ email: `a${i}@x.fr` }));
  assert.equal(campaign._test.sliceAudience(rows, 'first').length, 5);
  assert.equal(campaign._test.sliceAudience(rows, 'second').length, 5);
  assert.equal(campaign._test.sliceAudience(rows, 'all').length, 10);
});
