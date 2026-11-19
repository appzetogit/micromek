import { ApiError } from '../../../utils/ApiError.js';
import { notificationTemplate, waConfig } from '../config.js';
import { Lead } from '../models/Lead.js';
import { MESSAGE_STATUS_RANK, OPEN_LEAD_STATUSES } from '../models/constants.js';
import { WaBroadcast } from '../models/WaBroadcast.js';
import { WaContact } from '../models/WaContact.js';
import { WaConversation } from '../models/WaConversation.js';
import { WaMessage } from '../models/WaMessage.js';
import { WaTemplate } from '../models/WaTemplate.js';
import {
  assertServiceWindow,
  assertTextBody,
  assertWhatsAppEnabled,
  bodyParams,
  isWhatsAppEnabled,
  listTemplates,
  markRead,
  sendTemplate,
  sendText,
} from '../whatsapp/client.js';
import { isOptIn, isOptOut, parseCloudWebhook } from '../whatsapp/webhook.js';
import { autoReply } from './chatbot.js';
import { activity, createLead, findOpenLeadByPhone, phoneOf, pushActivity } from './leadService.js';

const log = (...args) => console.log('[leads/whatsapp]', ...args);
const warn = (...args) => console.warn('[leads/whatsapp]', ...args);

// ---------- contacts & conversations ----------

export const upsertContact = async (waId, { name = '', profileName = '', inboundAt = null } = {}) => {
  const update = {
    $setOnInsert: { wa_id: waId, phone: waId, name: name || profileName || '' },
  };
  if (profileName) update.$set = { profile_name: profileName };
  if (inboundAt) update.$max = { last_inbound_at: inboundAt };
  try {
    return await WaContact.findOneAndUpdate({ wa_id: waId }, update, { upsert: true, returnDocument: 'after' });
  } catch (error) {
    // Two webhooks racing on a brand-new number.
    if (error?.code !== 11000) throw error;
    const { $setOnInsert: _inserted, ...rest } = update;
    return Object.keys(rest).length
      ? WaContact.findOneAndUpdate({ wa_id: waId }, rest, { returnDocument: 'after' })
      : WaContact.findOne({ wa_id: waId });
  }
};

export const findActiveConversation = (contactId) =>
  WaConversation.findOne({ contact: contactId, status: { $ne: 'closed' } }).sort({ updatedAt: -1 });

const touchConversation = async (conversationId, message, { inbound = false } = {}) => {
  if (!conversationId) return;
  const update = {
    $set: {
      last_message: { direction: message.direction, type: message.type, body: String(message.body || '').slice(0, 500), at: message.wa_timestamp || new Date() },
    },
  };
  if (inbound) {
    update.$inc = { unread_count: 1 };
    update.$max = { last_inbound_at: message.wa_timestamp || new Date() };
  }
  await WaConversation.updateOne({ _id: conversationId }, update);
};

export const setOptIn = async (contact, status, source) => {
  contact.opt_in = { status, at: new Date(), source };
  await contact.save();
  const lead = await findOpenLeadByPhone(contact.wa_id);
  if (lead) {
    pushActivity(lead, activity('system', { note: status === 'opted_out' ? 'Customer opted out of WhatsApp messages' : 'Customer opted in to WhatsApp messages' }));
    await lead.save();
  }
  return contact;
};

// ---------- template rendering (for the inbox) ----------

const bodyTextOf = (components = []) =>
  (Array.isArray(components) ? components : []).find((c) => String(c?.type).toUpperCase() === 'BODY')?.text || '';

export const countBodyParams = (components) => {
  const nums = [...bodyTextOf(components).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
};

const renderTemplate = async (name, language, components = []) => {
  const tpl = await WaTemplate.findOne({ name, language }).lean();
  const text = bodyTextOf(tpl?.components);
  if (!text) return `[template: ${name}]`;
  const params = (components || []).find((c) => c?.type === 'body')?.parameters || [];
  return text.replace(/\{\{(\d+)\}\}/g, (m, n) => params[Number(n) - 1]?.text ?? m);
};

// ---------- outbound ----------

/// Sends a text or template and records it. Text needs an open 24h window.
/// Returns the WaMessage, or null when `dedupeKey` was already used.
export const sendOutbound = async ({
  contact, conversation = null, text, template, origin = 'staff', by = null, dedupeKey, broadcast = null,
}) => {
  assertWhatsAppEnabled();
  if (!text && !template?.name) throw new ApiError(400, 'Provide text or template');
  if (text) {
    assertTextBody(text);
    assertServiceWindow(contact.last_inbound_at);
  }
  if (contact.opt_in?.status === 'opted_out' && origin !== 'staff' && origin !== 'bot') {
    throw new ApiError(409, 'Contact has opted out of WhatsApp messages', { code: 'OPTED_OUT' });
  }
  const language = template?.language || waConfig().templateLanguage;
  let message;
  try {
    message = await WaMessage.create({
      contact: contact._id,
      conversation: conversation?._id || null,
      wa_id: contact.wa_id,
      direction: 'out',
      type: text ? 'text' : 'template',
      body: text ? String(text).trim() : await renderTemplate(template.name, language, template.components),
      template: text ? undefined : { name: template.name, language, components: template.components || [] },
      status: 'queued',
      statuses: [{ status: 'queued', at: new Date() }],
      sent_by: by,
      origin,
      broadcast,
      ...(dedupeKey ? { dedupe_key: dedupeKey } : {}),
    });
  } catch (error) {
    if (error?.code === 11000 && dedupeKey) return null;
    throw error;
  }

  try {
    const result = text
      ? await sendText(contact.wa_id, text, { lastInboundAt: contact.last_inbound_at })
      : await sendTemplate(contact.wa_id, template.name, language, template.components || []);
    if (result.id) message.wa_message_id = result.id;
    message.status = 'accepted';
    message.statuses.push({ status: 'accepted', at: new Date() });
    await message.save();
  } catch (error) {
    message.status = 'failed';
    message.error = { code: error.details?.graph_code ?? error.details?.code ?? null, message: error.message, details: error.details || null };
    message.statuses.push({ status: 'failed', at: new Date(), error: message.error });
    await message.save();
    error.waMessage = message;
    throw error;
  }

  await WaContact.updateOne({ _id: contact._id }, { $set: { last_outbound_at: new Date() } });
  await touchConversation(conversation?._id, message);
  return message;
};

/// Automated customer notification from a commerce event. Never throws:
/// disabled, unconfigured, opted-out and duplicate sends are logged and skipped.
export const notifyCustomer = async (kind, { phone, name = '', ctx = {}, dedupeKey }) => {
  const tpl = notificationTemplate(kind);
  if (!tpl?.name) return log(`skip ${kind}: ${tpl?.env || kind} not set`);
  if (!isWhatsAppEnabled()) return log(`skip ${kind}: WhatsApp disabled`);
  const waId = phoneOf(phone);
  if (!waId) return log(`skip ${kind}: no usable phone`, dedupeKey || '');
  try {
    const contact = await upsertContact(waId, { name });
    if (contact.opt_in?.status === 'opted_out') return log(`skip ${kind}: ${waId} opted out`);
    if (waConfig().requireOptIn && contact.opt_in?.status !== 'opted_in') return log(`skip ${kind}: ${waId} has not opted in`);
    const conversation = await findActiveConversation(contact._id);
    const values = tpl.params.map((key) => ctx[key] ?? '');
    const message = await sendOutbound({
      contact,
      conversation,
      template: { name: tpl.name, language: tpl.language, components: bodyParams(values) },
      origin: 'event',
      dedupeKey,
    });
    if (!message) return log(`skip ${kind}: already sent (${dedupeKey})`);
    return message;
  } catch (error) {
    warn(`${kind} to ${waId} failed:`, error.message);
    return null;
  }
};

// ---------- inbound ----------

const maybeAutoReply = async (conversation, message, contact) => {
  if (conversation.status !== 'bot') return;
  let reply = null;
  try {
    reply = await autoReply(conversation, message);
  } catch (error) {
    warn('autoReply failed', error.message);
  }
  const text = typeof reply === 'string' ? reply : reply?.text;
  if (text && isWhatsAppEnabled()) {
    try {
      await sendOutbound({ contact, conversation, text, origin: 'bot' });
    } catch (error) {
      warn('bot reply failed', error.message);
    }
  }
  if (!text || reply?.handover) {
    await WaConversation.updateOne({ _id: conversation._id, status: 'bot' }, { $set: { status: 'open', handed_over_at: new Date() } });
  }
};

const leadFromInbound = async ({ msg, contact, conversation }) => {
  let lead = conversation.lead ? await Lead.findOne({ _id: conversation.lead, status: { $in: OPEN_LEAD_STATUSES }, deletedAt: null }) : null;
  if (!lead) lead = await findOpenLeadByPhone(contact.wa_id);
  if (!lead) {
    const fromAd = msg.referral && (msg.referral.source_id || msg.referral.ctwa_clid);
    lead = await createLead({
      source: fromAd ? 'meta_ads' : 'whatsapp',
      name: contact.name || contact.profile_name || '',
      phone: contact.wa_id,
      requirement: String(msg.body || '').slice(0, 2000),
      contact: contact._id,
      conversation: conversation._id,
      campaign: fromAd
        ? { ad_id: msg.referral.source_type === 'ad' ? msg.referral.source_id : '', source_url: msg.referral.source_url, ad_name: msg.referral.headline }
        : undefined,
    });
  } else {
    let dirty = false;
    if (!lead.contact) { lead.contact = contact._id; dirty = true; }
    if (String(lead.conversation || '') !== String(conversation._id)) { lead.conversation = conversation._id; dirty = true; }
    if (dirty) await lead.save();
  }
  const set = { lead: lead._id };
  if (!conversation.assigned_to && lead.assigned_to) set.assigned_to = lead.assigned_to;
  await WaConversation.updateOne({ _id: conversation._id }, { $set: set });
  return lead;
};

/// One inbound Cloud API message (already normalised by parseCloudWebhook).
/// Idempotent on the WhatsApp message id.
export const handleInboundMessage = async (msg) => {
  if (await WaMessage.exists({ wa_message_id: msg.id })) return { duplicate: true };
  const waId = phoneOf(msg.from) || String(msg.from);
  const contact = await upsertContact(waId, { profileName: msg.profile_name, inboundAt: msg.timestamp });

  let conversation = await findActiveConversation(contact._id);
  if (!conversation) {
    conversation = await WaConversation.create({
      contact: contact._id, wa_id: waId, status: waConfig().botEnabled ? 'bot' : 'open',
    });
  }

  let message;
  try {
    message = await WaMessage.create({
      contact: contact._id,
      conversation: conversation._id,
      wa_id: waId,
      direction: 'in',
      type: msg.type,
      body: msg.body,
      media: msg.media || undefined,
      location: msg.location || undefined,
      interactive: msg.interactive || undefined,
      context: msg.context || undefined,
      referral: msg.referral || undefined,
      wa_message_id: msg.id,
      status: 'received',
      statuses: [{ status: 'received', at: msg.timestamp }],
      origin: 'customer',
      wa_timestamp: msg.timestamp,
    });
  } catch (error) {
    if (error?.code === 11000) return { duplicate: true };
    throw error;
  }
  await touchConversation(conversation._id, message, { inbound: true });

  const keywordable = ['text', 'button', 'interactive'].includes(msg.type);
  if (keywordable && isOptOut(msg.body)) {
    await setOptIn(contact, 'opted_out', 'keyword');
    const reply = waConfig().optOutReply;
    if (reply && isWhatsAppEnabled()) {
      // Confirmation is a staff-class message so the opt-out guard lets it through.
      await sendOutbound({ contact, conversation, text: reply, origin: 'bot' }).catch((e) => warn('opt-out reply failed', e.message));
    }
    return { message, contact, conversation, optedOut: true };
  }
  if (keywordable && isOptIn(msg.body)) await setOptIn(contact, 'opted_in', 'keyword');

  const lead = await leadFromInbound({ msg, contact, conversation });
  await maybeAutoReply(conversation, message, contact);
  return { message, contact, conversation, lead };
};

/// Delivery receipts for messages we sent.
export const applyStatusUpdate = async (s) => {
  const message = await WaMessage.findOne({ wa_message_id: s.id });
  if (!message) return { unknown: true };
  if (message.statuses.some((x) => x.status === s.status)) return { duplicate: true };
  const error = s.errors?.[0] || null;
  message.statuses.push({ status: s.status, at: s.timestamp, error });
  if (s.status === 'failed') {
    message.status = 'failed';
    message.error = error || { message: 'failed' };
  } else if (message.status !== 'failed' && (MESSAGE_STATUS_RANK[s.status] ?? 0) > (MESSAGE_STATUS_RANK[message.status] ?? 0)) {
    message.status = s.status;
  }
  await message.save();
  if (s.status === 'failed' && message.broadcast) {
    await WaBroadcast.updateOne(
      { _id: message.broadcast, recipients: { $elemMatch: { wa_message_id: s.id, status: 'sent' } } },
      { $set: { 'recipients.$.status': 'failed', 'recipients.$.error': error?.message || error?.title || 'failed' }, $inc: { 'totals.sent': -1, 'totals.failed': 1 } },
    );
  }
  return { message };
};

/// Processes a whole verified webhook body. Per-item failures are logged so
/// one bad message never makes Meta retry the batch forever.
export const processCloudWebhook = async (body) => {
  const { messages, statuses } = parseCloudWebhook(body);
  const result = { messages: 0, statuses: 0, errors: 0 };
  for (const msg of messages) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await handleInboundMessage(msg);
      result.messages += 1;
    } catch (error) {
      result.errors += 1;
      warn(`inbound ${msg.id} failed:`, error.message);
    }
  }
  for (const s of statuses) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await applyStatusUpdate(s);
      result.statuses += 1;
    } catch (error) {
      result.errors += 1;
      warn(`status ${s.id} failed:`, error.message);
    }
  }
  return result;
};

/// Clears the unread badge and sends a read receipt for the latest inbound message.
export const markConversationRead = async (conversation) => {
  if (!conversation.unread_count) return;
  await WaConversation.updateOne({ _id: conversation._id }, { $set: { unread_count: 0 } });
  if (!isWhatsAppEnabled()) return;
  const last = await WaMessage.findOne({ conversation: conversation._id, direction: 'in', wa_message_id: { $type: 'string' } })
    .sort({ createdAt: -1 }).select('wa_message_id').lean();
  if (last?.wa_message_id) await markRead(last.wa_message_id).catch((e) => warn('markRead failed', e.message));
};

// ---------- templates ----------

export const syncTemplates = async () => {
  const items = await listTemplates();
  const now = new Date();
  const seen = [];
  for (const t of items) {
    if (!t?.name || !t?.language) continue;
    seen.push(`${t.name}|${t.language}`);
    // eslint-disable-next-line no-await-in-loop
    await WaTemplate.updateOne(
      { name: t.name, language: t.language },
      {
        $set: {
          wa_template_id: String(t.id || ''),
          status: String(t.status || ''),
          category: String(t.category || ''),
          components: t.components || [],
          rejected_reason: String(t.rejected_reason || ''),
          body_param_count: countBodyParams(t.components),
          synced_at: now,
        },
      },
      { upsert: true },
    );
  }
  // Templates removed from the WABA stay for history but can't be used.
  const removed = await WaTemplate.updateMany({ synced_at: { $lt: now }, status: { $ne: 'DELETED' } }, { $set: { status: 'DELETED' } });
  return {
    total: seen.length,
    approved: items.filter((t) => t.status === 'APPROVED').length,
    marked_deleted: removed.modifiedCount || 0,
    synced_at: now,
  };
};

export const assertApprovedTemplate = async (name, language) => {
  const tpl = await WaTemplate.findOne({ name, language: language || waConfig().templateLanguage }).lean();
  if (!tpl) throw new ApiError(400, `Template ${name} (${language || waConfig().templateLanguage}) not found; sync templates first`);
  if (tpl.status !== 'APPROVED') throw new ApiError(400, `Template ${name} is ${tpl.status || 'not approved'}`);
  return tpl;
};
