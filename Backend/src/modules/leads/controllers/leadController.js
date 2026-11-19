import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok, paged } from '../../shared/guards.js';
import { assertObjectId, parsePaging, parsePeriod } from '../../franchise/services/franchiseService.js';
import { Lead } from '../models/Lead.js';
import { LeadFollowUp } from '../models/LeadFollowUp.js';
import { WaMessage } from '../models/WaMessage.js';
import { LEAD_SOURCES, LEAD_TYPES, MANUAL_ACTIVITY_TYPES } from '../models/constants.js';
import { adminId, csv, isSuperadmin, scopeFilter } from '../services/access.js';
import { eligibleAdmins } from '../services/assignmentService.js';
import {
  activity,
  assignLead,
  buildLeadFilter,
  changeLeadStatus,
  createFollowUp,
  createLead,
  findOpenLeadByPhone,
  getLeadOr404,
  leadSort,
  leadStats,
  phoneOf,
  pushActivity,
  updateFollowUp,
} from '../services/leadService.js';

const pick = (src = {}, keys = []) =>
  Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

const EDITABLE = ['name', 'email', 'city', 'requirement', 'notes', 'type', 'value', 'order_number'];
const CAMPAIGN_FIELDS = ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'form_id', 'page_id', 'platform', 'source_url', 'utm_source', 'utm_medium', 'utm_campaign'];
const POPULATE = [
  { path: 'assigned_to', select: 'name email phone admin_type' },
  { path: 'created_by', select: 'name' },
];

const optionalId = (value, label) => (value === null || value === '' ? null : assertObjectId(value, label));

const validateLeadBody = (body, { partial = false } = {}) => {
  const out = pick(body, EDITABLE);
  if (out.type !== undefined && !LEAD_TYPES.includes(out.type)) throw new ApiError(400, `type must be one of ${LEAD_TYPES.join(', ')}`);
  if (out.value !== undefined) {
    const v = Number(out.value);
    if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'value must be a non-negative number');
    out.value = v;
  }
  if (out.email !== undefined && out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(out.email))) throw new ApiError(400, 'email is invalid');
  if (body.phone !== undefined) {
    out.phone = body.phone ? phoneOf(body.phone) : '';
    if (body.phone && !out.phone) throw new ApiError(400, 'phone is invalid');
  }
  if (body.tags !== undefined) out.tags = csv(body.tags).map((t) => t.toLowerCase());
  if (body.store_id !== undefined) out.store_id = optionalId(body.store_id, 'store_id');
  if (body.franchise_id !== undefined) out.franchise_id = optionalId(body.franchise_id, 'franchise_id');
  if (body.order_id !== undefined) out.order_id = optionalId(body.order_id, 'order_id');
  if (body.campaign && typeof body.campaign === 'object') out.campaign = pick(body.campaign, CAMPAIGN_FIELDS);
  if (!partial && !out.name && !out.phone && !out.email) throw new ApiError(400, 'name, phone or email is required');
  return out;
};

export const listLeads = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = buildLeadFilter(req.query, req.auth);
  const [items, total] = await Promise.all([
    Lead.find(filter).select('-timeline -form_answers').populate(POPULATE).sort(leadSort(req.query.sort)).skip(skip).limit(limit).lean(),
    Lead.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const getLead = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  await lead.populate([...POPULATE, { path: 'timeline.by', select: 'name' }, { path: 'contact', select: 'wa_id name profile_name opt_in last_inbound_at' }]);
  const [followUps, recentMessages] = await Promise.all([
    LeadFollowUp.find({ lead: lead._id }).populate('assigned_to', 'name').sort({ due_at: 1 }).lean(),
    lead.contact ? WaMessage.find({ contact: lead.contact._id || lead.contact }).sort({ createdAt: -1 }).limit(20).lean() : [],
  ]);
  return ok(res, { lead, follow_ups: followUps, recent_messages: recentMessages.reverse() });
});

export const createManualLead = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const data = validateLeadBody(body);
  data.source = body.source && LEAD_SOURCES.includes(body.source) ? body.source : 'manual';
  if (data.phone && !body.allow_duplicate) {
    const existing = await findOpenLeadByPhone(data.phone);
    if (existing) {
      throw new ApiError(409, 'An open lead already exists for this phone', { code: 'LEAD_EXISTS', lead_id: existing._id });
    }
  }
  // Sub admins keep the leads they create; super admins may pick or auto-assign.
  if (!isSuperadmin(req.auth)) data.assigned_to = req.auth.sub;
  else if (body.assigned_to) data.assigned_to = body.assigned_to;
  const lead = await createLead(data, { by: adminId(req.auth), autoAssign: body.auto_assign !== false });
  if (body.follow_up_at) await createFollowUp(lead, { due_at: body.follow_up_at, note: body.follow_up_note }, adminId(req.auth));
  return ok(res, await Lead.findById(lead._id).populate(POPULATE), 201);
});

export const updateLead = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  const data = validateLeadBody(req.body || {}, { partial: true });
  const changed = Object.keys(data).filter((k) => JSON.stringify(lead.get(k)) !== JSON.stringify(data[k]));
  if (data.campaign) {
    lead.campaign = { ...(lead.campaign?.toObject?.() || {}), ...data.campaign };
    delete data.campaign;
  }
  Object.assign(lead, data);
  if (changed.length) pushActivity(lead, activity('updated', { by: adminId(req.auth), note: `Updated ${changed.join(', ')}` }));
  await lead.save();
  return ok(res, lead);
});

export const assignLeadHandler = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  const lead2 = await assignLead(lead, req.body?.admin_id || req.body?.assigned_to || null, { by: adminId(req.auth), auth: req.auth });
  return ok(res, await lead2.populate(POPULATE));
});

export const bulkAssign = asyncHandler(async (req, res) => {
  const ids = csv(req.body?.lead_ids).map((id) => assertObjectId(id, 'lead id'));
  if (!ids.length || ids.length > 200) throw new ApiError(400, 'lead_ids must list 1-200 leads');
  const leads = await Lead.find({ _id: { $in: ids }, deletedAt: null, ...scopeFilter(req.auth) });
  for (const lead of leads) {
    // eslint-disable-next-line no-await-in-loop
    await assignLead(lead, req.body?.admin_id || null, { by: adminId(req.auth), auth: req.auth });
  }
  return ok(res, { updated: leads.length });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  const body = req.body || {};
  return ok(res, await changeLeadStatus(lead, { status: body.status, reason: body.reason, note: body.note, by: adminId(req.auth) }));
});

export const addActivity = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  const type = req.body?.type || 'note';
  if (!MANUAL_ACTIVITY_TYPES.includes(type)) throw new ApiError(400, `type must be one of ${MANUAL_ACTIVITY_TYPES.join(', ')}`);
  const note = String(req.body?.note || '').trim();
  if (!note) throw new ApiError(400, 'note is required');
  const by = adminId(req.auth);
  pushActivity(lead, activity(type, { by, note }));
  if (type !== 'note') {
    // A logged call/visit/etc. counts as contacting the customer.
    lead.last_contact_at = new Date();
    if (!lead.first_response_at) lead.first_response_at = new Date();
  }
  await lead.save();
  return ok(res, lead.timeline[lead.timeline.length - 1], 201);
});

export const deleteLead = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  if (!isSuperadmin(req.auth)) throw new ApiError(403, 'Only a super admin can delete leads');
  lead.deletedAt = new Date();
  await lead.save();
  await LeadFollowUp.updateMany({ lead: lead._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  return ok(res, { id: lead._id, deleted: true });
});

export const leadStatsHandler = asyncHandler(async (req, res) => ok(res, await leadStats(req.auth, parsePeriod(req.query))));

export const listAssignees = asyncHandler(async (_req, res) => {
  const admins = await eligibleAdmins();
  return ok(res, admins.map((a) => ({ id: a._id, name: a.name, email: a.email, admin_type: a.admin_type })));
});

export const meta = asyncHandler(async (_req, res) => ok(res, {
  sources: LEAD_SOURCES,
  types: LEAD_TYPES,
  statuses: ['new', 'contacted', 'qualified', 'won', 'lost'],
  activity_types: MANUAL_ACTIVITY_TYPES,
}));

// ---------- follow-ups ----------

export const listLeadFollowUps = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  return ok(res, await LeadFollowUp.find({ lead: lead._id }).populate('assigned_to', 'name').sort({ due_at: 1 }).lean());
});

export const addFollowUp = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  return ok(res, await createFollowUp(lead, req.body || {}, adminId(req.auth)), 201);
});

export const editFollowUp = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  return ok(res, await updateFollowUp(lead, req.params.followUpId, req.body || {}, adminId(req.auth)));
});

export const removeFollowUp = asyncHandler(async (req, res) => {
  const lead = await getLeadOr404(req.params.id, req.auth);
  return ok(res, await updateFollowUp(lead, req.params.followUpId, { status: 'cancelled' }, adminId(req.auth)));
});

/// Follow-ups across leads: ?due=overdue|today|upcoming, ?status=pending|done|cancelled.
export const listAllFollowUps = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { status: req.query.status ? String(req.query.status) : 'pending' };
  if (!isSuperadmin(req.auth)) filter.assigned_to = adminId(req.auth);
  else if (req.query.assigned_to) filter.assigned_to = assertObjectId(req.query.assigned_to, 'assigned_to');
  const now = new Date();
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  if (req.query.due === 'overdue') filter.due_at = { $lt: now };
  else if (req.query.due === 'today') filter.due_at = { $gte: new Date(new Date(now).setHours(0, 0, 0, 0)), $lte: dayEnd };
  else if (req.query.due === 'upcoming') filter.due_at = { $gte: now };
  const [items, total] = await Promise.all([
    LeadFollowUp.find(filter)
      .populate('lead', 'name phone status source assigned_to')
      .populate('assigned_to', 'name')
      .sort({ due_at: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LeadFollowUp.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});
