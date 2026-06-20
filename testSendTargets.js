function getTestSendEmail() {
  return (
    process.env.CAMPAIGN_TEST_EMAIL ||
    process.env.TEST_SEND_EMAIL ||
    'giffareno237@gmail.com'
  )
    .trim()
    .toLowerCase();
}

function getTestSendPhone() {
  return (process.env.CAMPAIGN_TEST_PHONE || process.env.TEST_SEND_PHONE || '237693646080').trim();
}

function getTestContactLabel() {
  const email = getTestSendEmail();
  return email.split('@')[0] || 'test';
}

module.exports = {
  getTestSendEmail,
  getTestSendPhone,
  getTestContactLabel,
};
