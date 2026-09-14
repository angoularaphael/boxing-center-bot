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
