import { Admin } from '../../taxi/admin/models/Admin.js';
import { ApiError } from '../../../utils/ApiError.js';
import { assertObjectId } from '../../franchise/services/franchiseService.js';
import { waConfig } from '../config.js';
import { Lead } from '../models/Lead.js';
import { LeadFollowUp } from '../models/LeadFollowUp.js';
import { WaConversation } from '../models/WaConversation.js';
import {
  LEAD_SOURCES,
  LEAD_STATUS,
  LEAD_TRANSITIONS,
  LEAD_TYPES,
  OPEN_LEAD_STATUSES,
} from '../models/constants.js';
import { normalizePhone } from '../whatsapp/webhook.js';
import { assertAssignableAdmin, pickAssignee } from './assignmentService.js';
import { adminId, csv, escapeRegex, isSuperadmin, scopeFilter } from './access.js';

export const phoneOf = (value) => normalizePhone(value, waConfig().defaultCountryCode);

const TIMELINE_LIMIT = 500;

export const activity = (type, { note = '', by = null, meta } = {}) => ({
  type, note: String(note || '').slice(0, 5000), by, at: new Date(), ...(meta ? { meta } : {}),
});

export const pushActivity = (lead, entry) => {
  lead.timeline.push(entry);
  if (lead.timeline.length > TIMELINE_LIMIT) lead.timeline.splice(0, lead.timeline.length - TIMELINE_LIMIT);
};

export const findOpenLeadByPhone = (phone) =>
  phone ? Lead.findOne({ phone, status: { $in: OPEN_LEAD_STATUSES }, deletedAt: null }).sort({ createdAt: -1 }) : null;

const syncConversationAssignee = async (lead) => {
  if (!lead.conversation) return;
  await WaConversation.updateOne({ _id: lead.conversation }, { $set: { assigned_to: lead.assigned_to || null } });
};

/// Creates a lead and auto-assigns it unless an assignee is given.
export const createLead = async (data, { by = null, autoAssign = true } = {}) => {
  const source = LEAD_SOURCES.includes(data.source) ? data.source : 'manual';
  const type = LEAD_TYPES.includes(data.type) ? data.type : 'enquiry';
  const lead = new Lead({
    ...data,
    source,
    type,
    phone: data.phone ? phoneOf(data.phone) : '',
    tags: csv(data.tags || []).map((t) => t.toLowerCase()),
    created_by: by,
    timeline: [],
  });
  pushActivity(lead, activity('created', { by, note: `Lead created from ${source}` }));

  if (data.assigned_to) {
    const admin = await assertAssignableAdmin(data.assigned_to);
    lead.assigned_to = admin._id;
    lead.assigned_at = new Date();
    pushActivity(lead, activity('assigned', { by, note: `Assigned to ${admin.name}`, meta: { to: admin._id } }));
  } else if (autoAssign) {
    const admin = await pickAssignee();
    if (admin) {
      lead.assigned_to = admin._id;
      lead.assigned_at = new Date();
      lead.auto_assigned = true;
      pushActivity(lead, activity('assigned', { note: `Auto-assigned to ${admin.name}`, meta: { to: admin._id, auto: true } }));
    }
  }
  await lead.save();
  await syncConversationAssignee(lead);
  return lead;
};

export const getLeadOr404 = async (id, auth) => {
  const lead = await Lead.findOne({ _id: assertObjectId(id, 'lead id'), deletedAt: null, ...scopeFilter(auth) });
  if (!lead) throw new ApiError(404, 'Lead not found');
  return lead;
};

export const assignLead = async (lead, assigneeId, { by = null, auth } = {}) => {
  if (assigneeId) {
    // Sub admins may hand their own leads over to a colleague (they only reach
    // leads assigned to them, see getLeadOr404).
    const admin = await assertAssignableAdmin(assigneeId);
    const from = lead.assigned_to;
    lead.assigned_to = admin._id;
    lead.assigned_at = new Date();
    lead.auto_assigned = false;
    pushActivity(lead, activity('assigned', { by, note: `${from ? 'Reassigned' : 'Assigned'} to ${admin.name}`, meta: { from, to: admin._id } }));
  } else {
    if (auth && !isSuperadmin(auth)) throw new ApiError(403, 'Only a super admin can unassign a lead');
    pushActivity(lead, activity('assigned', { by, note: 'Unassigned', meta: { from: lead.assigned_to, to: null } }));
    lead.assigned_to = null;
    lead.assigned_at = null;
  }
  await lead.save();
  await syncConversationAssignee(lead);
  return lead;
};

export const changeLeadStatus = async (lead, { status, reason = '', note = '', by = null }) => {
  const to = String(status || '');
  if (!Object.values(LEAD_STATUS).includes(to)) throw new ApiError(400, `status must be one of ${Object.values(LEAD_STATUS).join(', ')}`);
  if (to === lead.status) return lead;
  if (!LEAD_TRANSITIONS[lead.status]?.includes(to)) {
    throw new ApiError(400, `Cannot move a lead from ${lead.status} to ${to}`);
  }
  if (to === LEAD_STATUS.LOST && !String(reason || '').trim()) throw new ApiError(400, 'reason is required when marking a lead lost');
  const from = lead.status;
  const now = new Date();
  lead.status = to;
  lead.status_changed_at = now;
  if (from === LEAD_STATUS.NEW && !lead.first_response_at) lead.first_response_at = now;
  if (to === LEAD_STATUS.WON) lead.won_at = now;
  if (to === LEAD_STATUS.LOST) {
    lead.lost_at = now;
    lead.lost_reason = String(reason).trim();
  } else if (from === LEAD_STATUS.LOST) {
    lead.lost_at = null;
    lead.lost_reason = '';
  }
  pushActivity(lead, activity('status', { by, note: [`${from} -> ${to}`, reason, note].filter(Boolean).join(' | '), meta: { from, to } }));
  if (to === LEAD_STATUS.WON || to === LEAD_STATUS.LOST) {
    // Closed leads have nothing left to chase.
    await LeadFollowUp.updateMany({ lead: lead._id, status: 'pending' }, { $set: { status: 'cancelled' } });
    lead.next_follow_up_at = null;
  }
  await lead.save();
  return lead;
};

/// Marks the first human touch (for response-time stats) and moves new -> contacted.
export const markResponded = async (leadId, by) => {
  const lead = await Lead.findById(leadId);
  if (!lead) return null;
  const now = new Date();
  if (!lead.first_response_at) lead.first_response_at = now;
  lead.last_contact_at = now;
  if (lead.status === LEAD_STATUS.NEW) {
    lead.status = LEAD_STATUS.CONTACTED;
    lead.status_changed_at = now;
    pushActivity(lead, activity('status', { by, note: 'new -> contacted (replied on WhatsApp)', meta: { from: 'new', to: 'contacted' } }));
  }
  await lead.save();
  return lead;
};

export const recomputeNextFollowUp = async (leadId) => {
  const next = await LeadFollowUp.findOne({ lead: leadId, status: 'pending' }).sort({ due_at: 1 }).select('due_at').lean();
  await Lead.updateOne({ _id: leadId }, { $set: { next_follow_up_at: next?.due_at || null } });
  return next?.due_at || null;
};

const parseDate = (value, label) => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new ApiError(400, `${label} must be a valid date`);
  return d;
};

export const createFollowUp = async (lead, body = {}, by = null) => {
  if (!lead.status || !OPEN_LEAD_STATUSES.includes(lead.status)) throw new ApiError(400, `Cannot add a follow-up to a ${lead.status} lead`);
  const dueAt = parseDate(body.due_at, 'due_at');
  const assignee = body.assigned_to ? (await assertAssignableAdmin(body.assigned_to))._id : (lead.assigned_to || by);
  const followUp = await LeadFollowUp.create({
    lead: lead._id,
    due_at: dueAt,
    note: String(body.note || ''),
    channel: ['call', 'whatsapp', 'email', 'visit', 'other'].includes(body.channel) ? body.channel : 'call',
    assigned_to: assignee,
    by,
  });
  pushActivity(lead, activity('follow_up', { by, note: `Follow-up on ${dueAt.toISOString()}${body.note ? `: ${body.note}` : ''}`, meta: { follow_up: followUp._id } }));
  await lead.save();
  await recomputeNextFollowUp(lead._id);
  return followUp;
};

export const updateFollowUp = async (lead, followUpId, body = {}, by = null) => {
  const followUp = await LeadFollowUp.findOne({ _id: assertObjectId(followUpId, 'follow-up id'), lead: lead._id });
  if (!followUp) throw new ApiError(404, 'Follow-up not found');
  if (followUp.status !== 'pending') throw new ApiError(400, `Follow-up is already ${followUp.status}`);
  if (body.due_at !== undefined) {
    followUp.due_at = parseDate(body.due_at, 'due_at');
    followUp.overdue = false;
    followUp.reminded_at = null;
  }
  if (body.note !== undefined) followUp.note = String(body.note || '');
  if (body.channel !== undefined && ['call', 'whatsapp', 'email', 'visit', 'other'].includes(body.channel)) followUp.channel = body.channel;
  if (body.assigned_to) followUp.assigned_to = (await assertAssignableAdmin(body.assigned_to))._id;
  if (body.done === true || body.status === 'done') {
    followUp.status = 'done';
    followUp.done_at = new Date();
    followUp.done_by = by;
    followUp.outcome = String(body.outcome || '');
    lead.last_contact_at = new Date();
    if (!lead.first_response_at) lead.first_response_at = new Date();
    pushActivity(lead, activity('follow_up_done', { by, note: followUp.outcome || followUp.note, meta: { follow_up: followUp._id } }));
    await lead.save();
  } else if (body.status === 'cancelled') {
    followUp.status = 'cancelled';
  }
  await followUp.save();
  await recomputeNextFollowUp(lead._id);
  return followUp;
};

// ---------- listing & stats ----------

export const buildLeadFilter = (query = {}, auth) => {
  const filter = { deletedAt: null, ...scopeFilter(auth) };
  const statuses = csv(query.status);
  if (statuses.length) filter.status = { $in: statuses };
  const sources = csv(query.source);
  if (sources.length) filter.source = { $in: sources };
  const types = csv(query.type);
  if (types.length) filter.type = { $in: types };
  const tags = csv(query.tags || query.tag).map((t) => t.toLowerCase());
  if (tags.length) filter.tags = { $in: tags };
  if (query.assigned_to && isSuperadmin(auth)) {
    filter.assigned_to = query.assigned_to === 'unassigned' ? null
      : query.assigned_to === 'me' ? adminId(auth) : assertObjectId(query.assigned_to, 'assigned_to');
  }
  if (query.store_id) filter.store_id = assertObjectId(query.store_id, 'store_id');
  if (query.franchise_id) filter.franchise_id = assertObjectId(query.franchise_id, 'franchise_id');
  if (query.campaign_id) filter['campaign.campaign_id'] = String(query.campaign_id);
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = parseDate(query.from, 'from');
    if (query.to) filter.createdAt.$lt = parseDate(query.to, 'to');
  }
  if (String(query.overdue) === 'true') {
    filter.next_follow_up_at = { $ne: null, $lt: new Date() };
    if (!filter.status) filter.status = { $in: OPEN_LEAD_STATUSES };
  }
  if (query.search) {
    const text = String(query.search).trim().slice(0, 100);
    const rx = new RegExp(escapeRegex(text), 'i');
    const or = [{ name: rx }, { email: rx }, { order_number: rx }, { requirement: rx }];
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 4) or.push({ phone: new RegExp(escapeRegex(digits)) });
    filter.$or = or;
  }
  return filter;
};

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  follow_up: { next_follow_up_at: 1, createdAt: -1 },
  value: { value: -1, createdAt: -1 },
  updated: { updatedAt: -1 },
};
export const leadSort = (key) => SORTS[key] || SORTS.newest;

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

export const leadStats = async (auth, { start, end }) => {
  const base = { deletedAt: null, ...scopeFilter(auth) };
  const period = { ...base, createdAt: { $gte: start, $lt: end } };
  const now = new Date();
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const followUpScope = isSuperadmin(auth) ? {} : { assigned_to: adminId(auth) };

  const [bySource, byStatus, byAssignee, byType, response, openTotal, overdueLeads, overdueFollowUps, dueToday] = await Promise.all([
    Lead.aggregate([{ $match: period }, { $group: { _id: '$source', count: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } } } }]),
    Lead.aggregate([{ $match: period }, { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$value' } } }]),
    Lead.aggregate([
      { $match: period },
      {
        $group: {
          _id: '$assigned_to',
          count: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
          open: { $sum: { $cond: [{ $in: ['$status', OPEN_LEAD_STATUSES] }, 1, 0] } },
        },
      },
      { $lookup: { from: Admin.collection.name, localField: '_id', foreignField: '_id', as: 'admin' } },
      { $project: { count: 1, won: 1, lost: 1, open: 1, name: { $ifNull: [{ $arrayElemAt: ['$admin.name', 0] }, null] } } },
      { $sort: { count: -1 } },
    ]),
    Lead.aggregate([{ $match: period }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    Lead.aggregate([
      { $match: { ...period, first_response_at: { $ne: null } } },
      { $project: { ms: { $subtract: ['$first_response_at', '$createdAt'] } } },
      { $group: { _id: null, avg: { $avg: '$ms' }, n: { $sum: 1 }, values: { $push: '$ms' } } },
    ]),
    Lead.countDocuments({ ...base, status: { $in: OPEN_LEAD_STATUSES } }),
    Lead.countDocuments({ ...base, status: { $in: OPEN_LEAD_STATUSES }, next_follow_up_at: { $ne: null, $lt: now } }),
    LeadFollowUp.countDocuments({ ...followUpScope, status: 'pending', due_at: { $lt: now } }),
    LeadFollowUp.countDocuments({ ...followUpScope, status: 'pending', due_at: { $gte: now, $lte: dayEnd } }),
  ]);

  const statusMap = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const total = byStatus.reduce((a, s) => a + s.count, 0);
  const won = statusMap.won || 0;
  const lost = statusMap.lost || 0;
  const r = response[0];
  let median = null;
  if (r?.values?.length) {
    const sorted = [...r.values].sort((a, b) => a - b);
    median = sorted[Math.floor(sorted.length / 2)];
  }
  return {
    period: { from: start, to: end },
    total,
    won,
    lost,
    open_now: openTotal,
    conversion_rate: total ? round1((won / total) * 100) : 0,
    win_rate_closed: won + lost ? round1((won / (won + lost)) * 100) : 0,
    won_value: byStatus.find((s) => s._id === 'won')?.value || 0,
    response_time: {
      responded: r?.n || 0,
      avg_minutes: r ? round1(r.avg / 60000) : null,
      median_minutes: median == null ? null : round1(median / 60000),
    },
    follow_ups: { overdue: overdueFollowUps, due_today: dueToday, leads_overdue: overdueLeads },
    by_source: bySource.map((s) => ({ source: s._id, count: s.count, won: s.won, conversion_rate: s.count ? round1((s.won / s.count) * 100) : 0 })),
    by_status: Object.values(LEAD_STATUS).map((s) => ({ status: s, count: statusMap[s] || 0 })),
    by_type: byType.map((t) => ({ type: t._id, count: t.count })),
    by_assignee: byAssignee.map((a) => ({
      admin_id: a._id, name: a.name, count: a.count, open: a.open, won: a.won, lost: a.lost,
      conversion_rate: a.count ? round1((a.won / a.count) * 100) : 0,
    })),
  };
};
