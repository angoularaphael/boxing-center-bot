-- Autoriser le canal SMS dans outbound_messages
ALTER TABLE outbound_messages DROP CONSTRAINT IF EXISTS outbound_messages_channel_check;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_channel_check
  CHECK (channel IN ('whatsapp', 'email', 'sms'));
