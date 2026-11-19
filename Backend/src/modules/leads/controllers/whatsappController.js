import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok, paged } from '../../shared/guards.js';
import { assertObjectId, parsePaging } from '../../franchise/services/franchiseService.js';
import { leadsConfig, metaConfig, NOTIFICATION_KINDS, notificationTemplate, waConfig } from '../config.js';
import { WaBroadcast } from '../models/WaBroadcast.js';
import { WaContact } from '../models/WaContact.js';
import { WaConversation } from '../models/WaConversation.js';
import { WaMessage } from '../models/WaMessage.js';
import { WaTemplate } from '../models/WaTemplate.js';
import { OPT_IN_STATUS } from '../models/constants.js';
import { adminId, escapeRegex, isSuperadmin, scopeFilter } from '../services/access.js';
import { assertAssignableAdmin } from '../services/assignmentService.js';
import {
  approveBroadcast,
  cancelBroadcast,
  createBroadcast,
  deleteBroadcast,
  getBroadcastOr404,
  runBroadcast,
  updateBroadcast,
} from '../services/broadcastService.js';
import { runLeadJobsOnce } from '../services/jobs.js';
import { markResponded } from '../services/leadService.js';
import {
  assertApprovedTemplate,
  markConversationRead,
  sendOutbound,
  setOptIn,
  syncTemplates,
} from '../services/whatsappService.js';
import { getPhoneNumberInfo, isWhatsAppEnabled, missingWhatsAppConfig } from '../whatsapp/client.js';
import { withinServiceWindow, windowExpiresAt } from '../whatsapp/webhook.js';

const CONTACT_FIELDS = 'wa_id name profile_name opt_in last_inbound_at last_outbound_at';

const getConversationOr404 = async (id, auth) => {
  const conversation = await WaConversation.findOne({ _id: assertObjectId(id, 'conversation id'), ...scopeFilter(auth) });
  if (!conversation) throw new ApiError(404, 'Conversation not found');
  return conversation;
};

const windowInfo = (contact) => ({
  open: withinServiceWindow(contact?.last_inbound_at),
  expires_at: windowExpiresAt(contact?.last_inbound_at),
});

// ---------- conversations ----------

export const listConversations = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { ...scopeFilter(req.auth) };
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  else filter.status = { $ne: 'closed' };
  if (req.query.assigned_to && isSuperadmin(req.auth)) {
    filter.assigned_to = req.query.assigned_to === 'unassigned' ? null
      : req.query.assigned_to === 'me' ? adminId(req.auth) : assertObjectId(req.query.assigned_to, 'assigned_to');
  }
  if (String(req.query.unread) === 'true') filter.unread_count = { $gt: 0 };
  if (req.query.search) {
    const text = String(req.query.search).trim().slice(0, 100);
    const rx = new RegExp(escapeRegex(text), 'i');
    const digits = text.replace(/\D/g, '');
    const contacts = await WaContact.find({ $or: [{ name: rx }, { profile_name: rx }, ...(digits.length >= 4 ? [{ wa_id: new RegExp(escapeRegex(digits)) }] : [])] })
      .select('_id').limit(500).lean();
    filter.contact = { $in: contacts.map((c) => c._id) };
  }
  const [items, total] = await Promise.all([
    WaConversation.find(filter)
      .populate('contact', CONTACT_FIELDS)
      .populate('assigned_to', 'name')
      .populate('lead', 'name status source type')
      .sort({ 'last_message.at': -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WaConversation.countDocuments(filter),
  ]);
  return paged(res, {
    items: items.map((c) => ({ ...c, service_window: windowInfo(c.contact) })),
    total,
    page,
    limit,
  });
});

export const getConversation = asyncHandler(async (req, res) => {
  const conversation = await getConversationOr404(req.params.id, req.auth);
  await conversation.populate([
    { path: 'contact', select: CONTACT_FIELDS },
    { path: 'assigned_to', select: 'name email' },
    { path: 'lead', select: 'name status source type assigned_to next_follow_up_at' },
  ]);
  return ok(res, { conversation, service_window: windowInfo(conversation.contact) });
});

/// Every message with the contact (including automated notifications sent
/// before this conversation existed), newest page first. ?before=<ISO date>.
export const listMessages = asyncHandler(async (req, res) => {
  const conversation = await getConversationOr404(req.params.id, req.auth);
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const filter = { contact: conversation.contact };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (Number.isNaN(before.getTime())) throw new ApiError(400, 'before must be a date');
    filter.createdAt = { $lt: before };
  }
  const items = await WaMessage.find(filter).populate('sent_by', 'name').sort({ createdAt: -1 }).limit(limit).lean();
  if (String(req.query.mark_read) !== 'false') await markConversationRead(conversation);
  return ok(res, { items: items.reverse(), has_more: items.length === limit });
});

/// { text } inside the 24h window, otherwise { template: { name, language, components } }.
export const sendReply = asyncHandler(async (req, res) => {
  const conversation = await getConversationOr404(req.params.id, req.auth);
  const contact = await WaContact.findById(conversation.contact);
  if (!contact) throw new ApiError(404, 'Contact not found');
  const body = req.body || {};
  const by = adminId(req.auth);
  let template;
  if (body.template) {
    if (!body.template.name) throw new ApiError(400, 'template.name is required');
    if (body.template.components !== undefined && !Array.isArray(body.template.components)) {
      throw new ApiError(400, 'template.components must be an array');
    }
    await assertApprovedTemplate(body.template.name, body.template.language);
    template = { name: body.template.name, language: body.template.language || waConfig().templateLanguage, components: body.template.components || [] };
  } else if (!body.text) {
    throw new ApiError(400, 'text or template is required');
  }
  const message = await sendOutbound({ contact, conversation, text: template ? undefined : body.text, template, origin: 'staff', by });

  // A staff reply takes the conversation over from the bot / queue.
  const set = {};
  if (conversation.status === 'open' || conversation.status === 'bot') set.status = 'human';
  if (!conversation.assigned_to) set.assigned_to = by;
  if (Object.keys(set).length) await WaConversation.updateOne({ _id: conversation._id }, { $set: set });
  if (conversation.lead) await markResponded(conversation.lead, by);
  return ok(res, message, 201);
});

export const conversationAction = asyncHandler(async (req, res) => {
  const conversation = await getConversationOr404(req.params.id, req.auth);
  const by = adminId(req.auth);
  const now = new Date();
  switch (req.params.action) {
    case 'handover': {
      // bot/queue -> staff. Optional admin_id hands it to someone else.
      const target = req.body?.admin_id ? (await assertAssignableAdmin(req.body.admin_id))._id : (conversation.assigned_to || by);
      conversation.status = 'human';
      conversation.assigned_to = target;
      conversation.handed_over_at = now;
      conversation.handed_over_by = by;
      break;
    }
    case 'bot':
      conversation.status = 'bot';
      break;
    case 'close':
      conversation.status = 'closed';
      conversation.closed_at = now;
      conversation.closed_by = by;
      conversation.unread_count = 0;
      break;
    case 'reopen':
      if (conversation.status !== 'closed') throw new ApiError(400, 'Conversation is not closed');
      if (await WaConversation.exists({ contact: conversation.contact, status: { $ne: 'closed' }, _id: { $ne: conversation._id } })) {
        throw new ApiError(409, 'This contact already has an open conversation');
      }
      conversation.status = 'human';
      conversation.closed_at = null;
      break;
    default:
      throw new ApiError(400, 'action must be handover, bot, close or reopen');
  }
  await conversation.save();
  return ok(res, conversation);
});

// ---------- contacts ----------

export const updateContact = asyncHandler(async (req, res) => {
  const contact = await WaContact.findById(assertObjectId(req.params.id, 'contact id'));
  if (!contact) throw new ApiError(404, 'Contact not found');
  if (!isSuperadmin(req.auth) && !(await WaConversation.exists({ contact: contact._id, assigned_to: adminId(req.auth) }))) {
    throw new ApiError(404, 'Contact not found');
  }
  if (req.body?.name !== undefined) contact.name = String(req.body.name || '').trim();
  if (req.body?.opt_in_status !== undefined) {
    if (!OPT_IN_STATUS.includes(req.body.opt_in_status)) throw new ApiError(400, `opt_in_status must be one of ${OPT_IN_STATUS.join(', ')}`);
    await setOptIn(contact, req.body.opt_in_status, `admin:${req.auth.sub}`);
  } else {
    await contact.save();
  }
  return ok(res, contact);
});

// ---------- templates ----------

export const listTemplatesHandler = asyncHandler(async (req, res) => {
  const filter = {};
  filter.status = req.query.status ? String(req.query.status).toUpperCase() : 'APPROVED';
  if (req.query.status === 'all') delete filter.status;
  if (req.query.category) filter.category = String(req.query.category).toUpperCase();
  const items = await WaTemplate.find(filter).sort({ name: 1, language: 1 }).lean();
  return ok(res, { items, last_synced_at: items.reduce((m, t) => (t.synced_at > m ? t.synced_at : m), null) });
});

export const syncTemplatesHandler = asyncHandler(async (_req, res) => ok(res, await syncTemplates()));

// ---------- broadcasts ----------

export const listBroadcasts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { ...scopeFilter(req.auth, 'created_by') };
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([
    WaBroadcast.find(filter).select('-recipients').populate('created_by', 'name').populate('approved_by', 'name')
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    WaBroadcast.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const getBroadcast = asyncHandler(async (req, res) => {
  const b = await getBroadcastOr404(req.params.id, req.auth);
  await b.populate([{ path: 'created_by', select: 'name' }, { path: 'approved_by', select: 'name' }]);
  const json = b.toJSON();
  // Recipients can be large; page them with ?recipients_page / ?recipients_status.
  const page = Math.max(1, Number.parseInt(req.query.recipients_page, 10) || 1);
  const list = req.query.recipients_status ? json.recipients.filter((r) => r.status === req.query.recipients_status) : json.recipients;
  json.recipients = list.slice((page - 1) * 100, page * 100);
  json.recipients_total = list.length;
  return ok(res, json);
});

export const createBroadcastHandler = asyncHandler(async (req, res) => ok(res, await createBroadcast(req.body || {}, req.auth), 201));

export const updateBroadcastHandler = asyncHandler(async (req, res) => {
  const b = await getBroadcastOr404(req.params.id, req.auth);
  return ok(res, await updateBroadcast(b, req.body || {}, req.auth));
});

export const deleteBroadcastHandler = asyncHandler(async (req, res) => {
  const b = await getBroadcastOr404(req.params.id, req.auth);
  return ok(res, await deleteBroadcast(b));
});

export const broadcastAction = asyncHandler(async (req, res) => {
  const b = await getBroadcastOr404(req.params.id, req.auth);
  if (req.params.action === 'approve') return ok(res, await approveBroadcast(b, req.auth));
  if (req.params.action === 'cancel') return ok(res, await cancelBroadcast(b));
  if (req.params.action === 'run') {
    const started = await runBroadcast(b);
    // Kick the job loop instead of waiting for the next tick.
    setImmediate(() => { runLeadJobsOnce().catch(() => {}); });
    return ok(res, started);
  }
  throw new ApiError(400, 'action must be approve, run or cancel');
});

// ---------- status ----------

export const whatsappStatus = asyncHandler(async (req, res) => {
  const c = waConfig();
  const m = metaConfig();
  const data = {
    enabled: isWhatsAppEnabled(),
    missing: missingWhatsAppConfig(),
    graph_version: c.graphVersion,
    phone_number_id: c.phoneNumberId ? `${c.phoneNumberId.slice(0, 4)}...${c.phoneNumberId.slice(-3)}` : null,
    business_account_configured: Boolean(c.businessAccountId),
    webhook: {
      app_secret_configured: Boolean(c.appSecret),
      verify_token_configured: Boolean(c.verifyToken),
      // POST webhooks need req.rawBody from express.json({ verify }) in app.js.
      paths: ['/api/webhooks/whatsapp', '/api/webhooks/meta/leads'],
    },
    meta_leads: {
      page_token_configured: Boolean(m.pageAccessToken),
      app_secret_configured: Boolean(m.appSecret),
      verify_token_configured: Boolean(m.verifyToken),
    },
    bot_enabled: c.botEnabled,
    require_opt_in: c.requireOptIn,
    auto_assign: leadsConfig().autoAssign,
    notifications: NOTIFICATION_KINDS.map((k) => {
      const t = notificationTemplate(k);
      return { kind: k, env: t.env, template: t.name || null, language: t.language, params: t.params };
    }),
    templates: { approved: await WaTemplate.countDocuments({ status: 'APPROVED' }) },
  };
  if (String(req.query.probe) === 'true' && data.enabled) {
    try {
      data.phone_number = await getPhoneNumberInfo();
    } catch (error) {
      data.probe_error = { message: error.message, details: error.details };
    }
  }
  return ok(res, data);
});
