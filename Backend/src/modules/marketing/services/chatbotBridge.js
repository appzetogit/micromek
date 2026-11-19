import { answerQuestion } from './kbService.js';

/// Optional bridge for leads/services/chatbot.js#autoReply(conversation, message).
/// Returns null (hand to staff) unless MKT_WA_BOT_AUTO_REPLY=true, since AI output
/// is meant to be reviewed. When enabled: a confident KB answer is sent; a weak one
/// sends the fallback text and hands the conversation over to staff.
export const whatsappAutoReply = async (conversation, message) => {
  if (String(process.env.MKT_WA_BOT_AUTO_REPLY || '').toLowerCase() !== 'true') return null;
  const question = String(message?.body || message?.text || '').trim();
  if (!question) return null;
  try {
    const res = await answerQuestion(question, {
      actor: { kind: 'system', id: `wa:${conversation?._id || ''}`, name: 'whatsapp-bot' },
      purpose: 'whatsapp_bot',
    });
    return { text: res.answer, handover: res.needs_human };
  } catch {
    return null; // provider missing / limit reached: staff take over
  }
};
