'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  seanceOfferteLink,
  sport2000SmsTemplate,
} = require('../lib/sport2000-seance-offerte');

test('lien seance offerte — src email vs sms', () => {
  assert.equal(
    seanceOfferteLink('email'),
    'https://seance-offerte.boxingcenter.fr/?src=email'
  );
  assert.equal(seanceOfferteLink('sms'), 'https://seance-offerte.boxingcenter.fr/?src=sms');
});

test('SMS Sport2000 partage la meme URL que le mail, src=sms', () => {
  const sms = sport2000SmsTemplate();
  assert.match(sms, /\?src=sms/);
  assert.doesNotMatch(sms, /\?src=email/);
});
