/// AI chatbot hook (later phase). Called for every inbound message on a
/// conversation whose status is "bot". Return:
///   - null                      -> no reply; the conversation is handed to staff (status "open")
///   - a string or { text }      -> sent as a free-form reply (inside the 24h window)
///   - { text, handover: true }  -> reply, then hand the conversation to staff
/// `conversation` and `message` are the saved WaConversation / WaMessage documents.
// eslint-disable-next-line no-unused-vars
export const autoReply = async (conversation, message) => null;
