'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const campaign = require('../seanceOfferteEmail');

test('le mail reste en texte perso avec le lien traceur src=email', () => {
  const mail = campaign._test.buildMail('Alice', '', 'alice@example.com');
  assert.equal(mail.subject, 'Alice, un petit mot de David');
  assert.match(mail.text, /^Salut Alice,/);
  assert.match(mail.text, /src=email/);
  assert.match(mail.text, /utm_source=email/);
  assert.equal(mail.html, undefined);
  assert.doesNotMatch(mail.text, /<html|<a\s|<p>/i);
});

test('wave 0 / all = toute l’audience', () => {
  assert.equal(campaign._test.resolveWaveSize(0), 0);
  assert.equal(campaign._test.resolveWaveSize('all'), 0);
  assert.equal(campaign._test.resolveWaveSize('500'), 500);
});

test('exclut les contacts listés sans toucher le reste', () => {
  const { isExcluded } = campaign._test;
  assert.equal(isExcluded({ email: 'contact@axelgele.fr', prenom: 'Axel', nom: 'GELE' }), true);
  assert.equal(isExcluded({ email: 'marine82@live.fr', prenom: 'Marine', nom: 'Bara' }), true);
  assert.equal(isExcluded({ email: 'martindavid@hotmail.fr', prenom: 'Maelie', nom: 'Matin-Sioen' }), true);
  assert.equal(isExcluded({ email: 'benedicte.escaich@edf.fr', prenom: 'Fleur', nom: 'Escaich' }), true);
  assert.equal(isExcluded({ email: 'pascaleveros@wanadoo.fr', prenom: 'Tiago', nom: 'Cerrato - Veros' }), true);
  assert.equal(isExcluded({ email: 'ramin410@yahoo.com', prenom: 'Omid', nom: 'Ghobadi' }), true);
  assert.equal(isExcluded({ email: 'amelie.gillet.ag@orange.fr', prenom: 'Leo', nom: 'Andrieu-Gillet' }), true);
  assert.equal(isExcluded({ email: 'zoe.almaer@hotmail.com', prenom: 'Zoé', nom: 'Almaer' }), true);
  assert.equal(isExcluded({ email: 'alice@example.com', prenom: 'Zoé', nom: 'Almaer' }), true);
  assert.equal(isExcluded({ email: 'ameliebedry@hotmail.fr', prenom: 'Amélie', nom: 'Bedry' }), true);
  assert.equal(isExcluded({ email: 'x@y.fr', prenom: 'Soumia', nom: 'Otsmane' }), true);
  assert.equal(isExcluded({ email: 'x@y.fr', prenom: 'Stef', nom: 'Stef' }), true);
  assert.equal(isExcluded({ email: 'x@y.fr', prenom: 'Yasmina', nom: 'Harkat' }), true);
  assert.equal(isExcluded({ email: 'marine.aubry@live.fr', prenom: 'Marine', nom: 'Aubry' }), false);
  assert.equal(isExcluded({ email: 'stefanpetkov91@gmail.com', prenom: 'Stefan', nom: 'Petkov' }), false);
  assert.equal(isExcluded({ email: 'alice@example.com', prenom: 'Alice', nom: 'Martin' }), false);
});

test('slice first / second coupe l’audience en deux', () => {
  const rows = [{ email: 'a@x.fr' }, { email: 'b@x.fr' }, { email: 'c@x.fr' }, { email: 'd@x.fr' }];
  assert.deepEqual(
    campaign._test.sliceAudience(rows, 'first').map((r) => r.email),
    ['a@x.fr', 'b@x.fr']
  );
  assert.deepEqual(
    campaign._test.sliceAudience(rows, 'second').map((r) => r.email),
    ['c@x.fr', 'd@x.fr']
  );
  assert.equal(campaign._test.resolveSlice('sim2'), 'second');
});

test('Resend vise Principal : texte brut, pas de HTML ni Precedence bulk', async () => {
  const previousFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ id: 'email-test' }) };
  };

  try {
    const id = await campaign._test.sendResend({
      apiKey: 're_test',
      to: 'alice@example.com',
      subject: 'Bonjour',
      text: 'Texte',
    });
    assert.equal(id, 'email-test');
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.body.from, `David <${campaign._test.FROM_EMAIL}>`);
    assert.equal(request.body.reply_to, campaign._test.REPLY_TO);
    assert.equal(request.body.html, undefined);
    assert.equal(request.body.headers.Precedence, undefined);
    assert.match(request.body.headers['List-Unsubscribe'], /^<mailto:/);
  } finally {
    global.fetch = previousFetch;
  }
});
