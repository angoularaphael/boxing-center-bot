'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const campaign = require('../seanceOfferteSport2000');

test('mail Sport2000 — texte soft + lien court + reply tls', () => {
  const mail = campaign._test.buildMail('Raphael', 'Angoula', 'ymanga03@gmail.com');
  assert.equal(mail.subject, 'Raphael, c’est David');
  assert.match(mail.text, /n’importe lequel de nos clubs/);
  assert.match(mail.text, /seance-offerte\.boxingcenter\.fr\/\?src=email/);
  assert.doesNotMatch(mail.text, /10\s*€|valeur habituelle|séance offerte/i);
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
