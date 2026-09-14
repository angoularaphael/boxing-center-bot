'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const campaign = require('../seanceOfferteEmail');

test('le mail reste en texte brut et personnalisé', () => {
  const mail = campaign._test.buildMail('Alice', '', 'alice@example.com');
  assert.equal(mail.subject, 'Alice, un petit mot de David');
  assert.match(mail.text, /^Salut Alice,/);
  assert.match(mail.text, /https:\/\/seance-offerte\.boxingcenter\.fr\/\?src=email/);
  assert.doesNotMatch(mail.text, /<html|<a\s/i);
});

test('Resend utilise David/no-reply, reply-to et List-Unsubscribe', async () => {
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
    assert.match(request.body.headers['List-Unsubscribe'], /^<mailto:/);
    assert.equal(request.body.html, undefined);
  } finally {
    global.fetch = previousFetch;
  }
});
