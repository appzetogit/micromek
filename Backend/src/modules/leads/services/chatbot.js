/// AI chatbot hook. Called for every inbound message on a conversation whose
/// status is "bot" (new conversations start there only with WA_BOT_ENABLED=true).
/// Return:
///   - null                      -> no reply; the conversation is handed to staff (status "open")
///   - a string or { text }      -> sent as a free-form reply (inside the 24h window)
///   - { text, handover: true }  -> reply, then hand the conversation to staff
///
/// Answers come from the marketing knowledge base (marketing/services/chatbotBridge.js).
/// It replies only with MKT_WA_BOT_AUTO_REPLY=true and a configured AI provider;
/// otherwise it returns null and staff take over.
export { whatsappAutoReply as autoReply } from '../../marketing/services/chatbotBridge.js';
