'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const campaign = require('../seanceOfferteReviens');

test('le mail relance dit que c’était un bug et garde le lien', () => {
  const mail = campaign._test.buildMail('Martin', 'Martin, un petit mot de David', 'martin.dufou@gmail.com');
  assert.equal(mail.subject, 'Martin, un mot de David');
  assert.match(mail.text, /^Salut Martin,/);
  assert.match(mail.text, /bug/);
  assert.match(mail.text, /déjà inscrit/);
  assert.match(mail.text, /src=email/);
  assert.match(mail.text, /seance_offerte_reviens_2026/);
  assert.doesNotMatch(mail.text, /transmettre ce lien|entourage/);
});

test('formulaire en erreur vs inscription ensuite OK', () => {
  assert.equal(campaign._test.formFailed({ meta: { status: 'error', last_error: 'fetch failed' } }), true);
  assert.equal(campaign._test.formSucceededLater({ meta: { status: 'queued' } }), true);
  assert.equal(campaign._test.formSucceededLater({ meta: { status: 'error', last_error: 'fetch failed' } }), false);
});

test('slice first / second', () => {
  const rows = [{ email: 'a@x.fr' }, { email: 'b@x.fr' }, { email: 'c@x.fr' }, { email: 'd@x.fr' }];
  assert.deepEqual(
    campaign._test.sliceAudience(rows, 'first').map((r) => r.email),
    ['a@x.fr', 'b@x.fr']
  );
  assert.deepEqual(
    campaign._test.sliceAudience(rows, 'second').map((r) => r.email),
    ['c@x.fr', 'd@x.fr']
  );
});
