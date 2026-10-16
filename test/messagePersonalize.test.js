const test = require('node:test');
const assert = require('node:assert/strict');
const { personalizeOutboundMessage } = require('../lib/messagePersonalize');

test('personalizeOutboundMessage remplace {nom}', () => {
  const out = personalizeOutboundMessage('Hello {nom}, test', 'Jean');
  assert.equal(out, 'Hello Jean, test');
});

test('personalizeOutboundMessage sans nom utilise there', () => {
  const out = personalizeOutboundMessage('Hello {nom}', '');
  assert.equal(out, 'Hello there');
});
