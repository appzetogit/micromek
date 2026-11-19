import { ApiError } from '../../../utils/ApiError.js';
import { assertObjectId } from '../../franchise/services/franchiseService.js';
import { waConfig } from '../config.js';
import { Lead } from '../models/Lead.js';
import { WaBroadcast } from '../models/WaBroadcast.js';
import { isWhatsAppEnabled } from '../whatsapp/client.js';
import { adminId, assertSuperadmin, csv, isSuperadmin, scopeFilter } from './access.js';
import { phoneOf } from './leadService.js';
import { assertApprovedTemplate, sendOutbound, upsertContact } from './whatsappService.js';

const log = (...args) => console.log('[leads/broadcast]', ...args);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const LOCK_MS = 5 * 60 * 1000;

export const getBroadcastOr404 = async (id, auth) => {
  const b = await WaBroadcast.findOne({ _id: assertObjectId(id, 'broadcast id'), ...scopeFilter(auth, 'created_by') });
  if (!b) throw new ApiError(404, 'Broadcast not found');
  return b;
};

const parseOptionalDate = (value, label) => {
  if (value === null || value === '' || value === undefined) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} must be a valid date`);
  return d;
};

const normaliseAudience = (audience = {}, auth) => {
  const type = audience.type;
  if (type === 'phones') {
    const phones = [...new Set(csv(audience.phones).map(phoneOf).filter(Boolean))];
    if (!phones.length) throw new ApiError(400, 'audience.phones must contain at least one valid phone');
    if (phones.length > waConfig().broadcastMaxRecipients) {
      throw new ApiError(400, `A broadcast is limited to ${waConfig().broadcastMaxRecipients} recipients`);
    }
    return { type, phones, lead_filter: {} };
  }
  if (type === 'lead_filter') {
    const f = audience.lead_filter || {};
    return {
      type,
      phones: [],
      lead_filter: {
        status: csv(f.status),
        source: csv(f.source),
        type: csv(f.type),
        tags: csv(f.tags).map((t) => t.toLowerCase()),
        // A sub admin can only target their own leads.
        assigned_to: isSuperadmin(auth) ? (f.assigned_to ? assertObjectId(f.assigned_to, 'assigned_to') : null) : adminId(auth),
        created_from: parseOptionalDate(f.created_from, 'lead_filter.created_from'),
        created_to: parseOptionalDate(f.created_to, 'lead_filter.created_to'),
      },
    };
  }
  throw new ApiError(400, 'audience.type must be phones or lead_filter');
};

const normaliseTemplate = (template = {}) => {
  const name = String(template.name || '').trim();
  if (!name) throw new ApiError(400, 'template.name is required');
  if (template.components !== undefined && !Array.isArray(template.components)) {
    throw new ApiError(400, 'template.components must be an array (Cloud API format)');
  }
  return { name, language: String(template.language || waConfig().templateLanguage), components: template.components || [] };
};

export const createBroadcast = async (body = {}, auth) => {
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError(400, 'name is required');
  return WaBroadcast.create({
    name,
    template: normaliseTemplate(body.template),
    audience: normaliseAudience(body.audience, auth),
    scheduled_at: parseOptionalDate(body.scheduled_at, 'scheduled_at'),
    status: 'draft',
    created_by: adminId(auth),
  });
};

/// Any change sends the broadcast back to draft for re-approval.
export const updateBroadcast = async (b, body = {}, auth) => {
  if (!['draft', 'scheduled'].includes(b.status)) throw new ApiError(400, `Cannot edit a ${b.status} broadcast`);
  if (body.name !== undefined) b.name = String(body.name || '').trim() || b.name;
  if (body.template !== undefined) b.template = normaliseTemplate(body.template);
  if (body.audience !== undefined) b.audience = normaliseAudience(body.audience, auth);
  if (body.scheduled_at !== undefined) b.scheduled_at = parseOptionalDate(body.scheduled_at, 'scheduled_at');
  b.status = 'draft';
  b.approved_by = null;
  b.approved_at = null;
  await b.save();
  return b;
};

export const approveBroadcast = async (b, auth) => {
  assertSuperadmin(auth, 'approve broadcasts');
  if (b.status !== 'draft') throw new ApiError(400, `Cannot approve a ${b.status} broadcast`);
  await assertApprovedTemplate(b.template.name, b.template.language);
  b.approved_by = adminId(auth);
  b.approved_at = new Date();
  if (b.scheduled_at) b.status = 'scheduled';
  await b.save();
  return b;
};

/// Starts an approved broadcast now (the job picks it up on its next tick).
export const runBroadcast = async (b) => {
  if (!b.approved_at) throw new ApiError(400, 'Broadcast must be approved by a super admin before it can run');
  if (!['draft', 'scheduled'].includes(b.status)) throw new ApiError(400, `Cannot run a ${b.status} broadcast`);
  if (!isWhatsAppEnabled()) throw new ApiError(503, 'WhatsApp is not configured', { code: 'WHATSAPP_DISABLED' });
  b.scheduled_at = new Date();
  b.status = 'scheduled';
  await b.save();
  return b;
};

export const cancelBroadcast = async (b) => {
  if (!['draft', 'scheduled', 'running'].includes(b.status)) throw new ApiError(400, `Cannot cancel a ${b.status} broadcast`);
  b.status = 'cancelled';
  b.cancelled_at = new Date();
  await b.save();
  return b;
};

export const deleteBroadcast = async (b) => {
  if (b.status === 'draft') {
    await b.deleteOne();
    return { id: b._id, deleted: true };
  }
  if (['scheduled', 'running'].includes(b.status)) {
    await cancelBroadcast(b);
    return { id: b._id, cancelled: true };
  }
  throw new ApiError(400, `A ${b.status} broadcast is kept for reporting and cannot be deleted`);
};

export const resolveRecipients = async (b) => {
  const max = waConfig().broadcastMaxRecipients;
  if (b.audience.type === 'phones') return b.audience.phones.slice(0, max).map((phone) => ({ phone, name: '' }));
  const f = b.audience.lead_filter || {};
  const filter = { deletedAt: null, phone: { $nin: ['', null] } };
  if (f.status?.length) filter.status = { $in: f.status };
  if (f.source?.length) filter.source = { $in: f.source };
  if (f.type?.length) filter.type = { $in: f.type };
  if (f.tags?.length) filter.tags = { $in: f.tags };
  if (f.assigned_to) filter.assigned_to = f.assigned_to;
  if (f.created_from || f.created_to) {
    filter.createdAt = {};
    if (f.created_from) filter.createdAt.$gte = f.created_from;
    if (f.created_to) filter.createdAt.$lt = f.created_to;
  }
  const leads = await Lead.find(filter).select('_id phone name').sort({ createdAt: -1 }).limit(max * 2).lean();
  const seen = new Set();
  const out = [];
  for (const l of leads) {
    if (seen.has(l.phone)) continue;
    seen.add(l.phone);
    out.push({ phone: l.phone, name: l.name || '', lead: l._id });
    if (out.length >= max) break;
  }
  return out;
};

/// Deep-copies components replacing "{{name}}" in text parameters.
export const personalise = (components = [], recipient = {}) =>
  JSON.parse(JSON.stringify(components || []).replace(/\{\{name\}\}/g, () => JSON.stringify(String(recipient.name || 'Customer')).slice(1, -1)));

const recount = (b) => {
  const t = { recipients: b.recipients.length, sent: 0, failed: 0, skipped: 0 };
  for (const r of b.recipients) if (t[r.status] !== undefined) t[r.status] += 1;
  b.totals = t;
};

const processBatch = async (b) => {
  if (b.status === 'scheduled') {
    b.recipients = await resolveRecipients(b);
    b.status = 'running';
    b.started_at = new Date();
    recount(b);
  }
  if (!isWhatsAppEnabled()) {
    b.last_error = 'WhatsApp is not configured';
    return;
  }
  const { broadcastBatch, broadcastDelayMs } = waConfig();
  const pending = b.recipients.filter((r) => r.status === 'pending').slice(0, broadcastBatch);
  for (const r of pending) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const contact = await upsertContact(r.phone, { name: r.name });
      if (contact.opt_in?.status === 'opted_out') {
        r.status = 'skipped';
        r.error = 'opted out';
      } else {
        // eslint-disable-next-line no-await-in-loop
        const message = await sendOutbound({
          contact,
          template: { name: b.template.name, language: b.template.language, components: personalise(b.template.components, r) },
          origin: 'broadcast',
          by: b.approved_by,
          broadcast: b._id,
          dedupeKey: `broadcast:${b._id}:${r.phone}`,
        });
        if (message) {
          r.status = 'sent';
          r.wa_message_id = message.wa_message_id || '';
        } else {
          r.status = 'skipped';
          r.error = 'already sent';
        }
      }
    } catch (error) {
      r.status = 'failed';
      r.error = String(error.message || 'failed').slice(0, 300);
    }
    r.at = new Date();
    // eslint-disable-next-line no-await-in-loop
    if (broadcastDelayMs) await sleep(broadcastDelayMs);
  }
  b.last_error = '';
  if (!b.recipients.some((r) => r.status === 'pending')) {
    b.status = 'done';
    b.finished_at = new Date();
  }
  recount(b);
};

/// One throttled batch per due broadcast. Called by the job loop.
export const runDueBroadcasts = async ({ maxBroadcasts = 5 } = {}) => {
  let processed = 0;
  const claimed = [];
  for (let i = 0; i < maxBroadcasts; i += 1) {
    const now = new Date();
    // eslint-disable-next-line no-await-in-loop
    const b = await WaBroadcast.findOneAndUpdate(
      {
        _id: { $nin: claimed },
        status: { $in: ['scheduled', 'running'] },
        approved_at: { $ne: null },
        scheduled_at: { $lte: now },
        $or: [{ locked_until: null }, { locked_until: { $lt: now } }],
      },
      { $set: { locked_until: new Date(now.getTime() + LOCK_MS) } },
      { sort: { scheduled_at: 1 }, returnDocument: 'after' },
    );
    if (!b) break;
    claimed.push(b._id);
    try {
      // eslint-disable-next-line no-await-in-loop
      await processBatch(b);
    } catch (error) {
      b.last_error = String(error.message || error).slice(0, 300);
      log(`broadcast ${b._id} batch failed:`, b.last_error);
    }
    // eslint-disable-next-line no-await-in-loop
    const fresh = await WaBroadcast.findById(b._id).select('status').lean();
    if (fresh?.status === 'cancelled') b.status = 'cancelled';
    b.locked_until = null;
    // eslint-disable-next-line no-await-in-loop
    await b.save();
    processed += 1;
  }
  return processed;
};
