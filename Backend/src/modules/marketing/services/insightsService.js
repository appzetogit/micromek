import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { AdCampaignDraft } from '../models/AdCampaignDraft.js';
import { ContentItem } from '../models/ContentItem.js';
import { InsightReport } from '../models/InsightReport.js';
import { generateText } from '../providers/index.js';
import { adminObjectId, assertObjectId, assertReviewer, modelIfRegistered, str } from './util.js';

const DAY = 86400000;
const NON_REVENUE = ['cancelled', 'returned'];
const round = (n) => Math.round((n || 0) * 100) / 100;
const countsBy = (rows) => Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.count]));

const salesSummary = async (Order, from, to) => {
  if (!Order) return { available: false };
  const match = { createdAt: { $gte: from, $lt: to } };
  const [byStatus, totals, byChannel, top, customers] = await Promise.all([
    Order.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { ...match, status: { $nin: NON_REVENUE } } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$totals.grand_total' } } },
    ]),
    Order.aggregate([
      { $match: { ...match, status: { $nin: NON_REVENUE } } },
      { $group: { _id: '$channel', count: { $sum: 1 }, revenue: { $sum: '$totals.grand_total' } } },
    ]),
    Order.aggregate([
      { $match: { ...match, status: { $nin: NON_REVENUE } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product_id', name: { $first: '$items.name' }, qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.total' } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      { $match: { ...match, status: { $nin: NON_REVENUE } } },
      { $group: { _id: '$customer_id', orders: { $sum: 1 } } },
      { $group: { _id: null, customers: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ['$orders', 1] }, 1, 0] } } } },
    ]),
  ]);
  const t = totals[0] || { orders: 0, revenue: 0 };
  return {
    available: true,
    orders: t.orders,
    revenue: round(t.revenue),
    avg_order_value: t.orders ? round(t.revenue / t.orders) : 0,
    by_status: countsBy(byStatus),
    by_channel: Object.fromEntries(byChannel.map((r) => [r._id || 'unknown', { orders: r.count, revenue: round(r.revenue) }])),
    top_products: top.map((p) => ({ product_id: p._id, name: p.name, qty: p.qty, revenue: round(p.revenue) })),
    customers: customers[0]?.customers || 0,
    repeat_customers: customers[0]?.repeat || 0,
  };
};

const leadsSummary = async (Lead, from, to, now) => {
  if (!Lead) return { available: false };
  const match = { createdAt: { $gte: from, $lt: to }, deletedAt: null };
  const open = ['new', 'contacted', 'qualified'];
  const [byStatus, bySource, overdue, stale] = await Promise.all([
    Lead.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: match }, { $group: { _id: '$source', count: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } } } }]),
    Lead.countDocuments({ deletedAt: null, status: { $in: open }, next_follow_up_at: { $ne: null, $lt: now } }),
    Lead.countDocuments({ deletedAt: null, status: 'new', createdAt: { $lt: new Date(now - 2 * DAY) } }),
  ]);
  const status = countsBy(byStatus);
  const total = Object.values(status).reduce((a, n) => a + n, 0);
  return {
    available: true,
    total,
    by_status: status,
    by_source: Object.fromEntries(bySource.map((r) => [r._id || 'unknown', { leads: r.count, won: r.won }])),
    won: status.won || 0,
    conversion_rate: total ? round(((status.won || 0) / total) * 100) : 0,
    overdue_follow_ups: overdue,
    stale_new_leads: stale,
  };
};

const suggestionsFor = ({ sales, leads, content }) => {
  const s = [];
  if (leads.available) {
    if (leads.overdue_follow_ups) s.push({ kind: 'follow_up', message: `${leads.overdue_follow_ups} open lead(s) have overdue follow-ups. Call or WhatsApp them today.` });
    if (leads.stale_new_leads) s.push({ kind: 'follow_up', message: `${leads.stale_new_leads} lead(s) are still "new" after 48 hours. Assign them and make first contact.` });
    const sources = Object.entries(leads.by_source).sort((a, b) => b[1].leads - a[1].leads);
    if (sources.length) s.push({ kind: 'segment', message: `Most leads came from ${sources[0][0]} (${sources[0][1].leads}). Put more budget into that channel.` });
    if (leads.total >= 10 && leads.conversion_rate < 10) s.push({ kind: 'conversion', message: `Lead conversion is ${leads.conversion_rate}%. Review lost reasons and response times.` });
  }
  if (sales.available) {
    if (sales.repeat_customers) s.push({ kind: 'segment', message: `${sales.repeat_customers} repeat customer(s). Target them with a loyalty / wholesale offer broadcast.` });
    if (sales.customers - sales.repeat_customers > 0) s.push({ kind: 'segment', message: `${sales.customers - sales.repeat_customers} one-time buyer(s). Send a WhatsApp re-order reminder.` });
    if (sales.top_products[0]) s.push({ kind: 'promotion', message: `"${sales.top_products[0].name}" is the top seller. Use it as the hero of the next post or ad.` });
  }
  if (content.in_review) s.push({ kind: 'review', message: `${content.in_review} content item(s) are waiting for review.` });
  return s;
};

/// Plain-data summary of the last `days` days. Works whether or not the
/// commerce (CommerceOrder) and leads (Lead) modules are loaded.
export const buildSummary = async ({ days = 30, now = new Date(), resolveModel = (n) => modelIfRegistered(mongoose, n) } = {}) => {
  const to = now;
  const from = new Date(now.getTime() - days * DAY);
  const [sales, leads, contentRows, campaignRows] = await Promise.all([
    salesSummary(resolveModel('CommerceOrder'), from, to),
    leadsSummary(resolveModel('Lead'), from, to, now.getTime()),
    ContentItem.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    AdCampaignDraft.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const content = countsBy(contentRows);
  const campaigns = countsBy(campaignRows);
  return {
    period: { days, from, to },
    sales,
    leads,
    content,
    campaigns,
    suggestions: suggestionsFor({ sales, leads, content }),
  };
};

/// Ask the provider for a short narrative of the summary; stored as a DRAFT report.
export const summarize = async ({ days, auth, actor, resolveModel }) => {
  const data = await buildSummary({ days, resolveModel });
  const prompt = `Business data for the last ${days} days (JSON):\n${JSON.stringify(data)}\n\n`
    + 'Write a short summary for the owner: 3-5 bullet points on sales, leads and campaigns, then 3 concrete next actions '
    + '(follow-ups, customer segments to target, content ideas). Use only the numbers given. Skip sections marked available: false.';
  const res = await generateText({
    system: 'You are a marketing analyst. Be concise and factual; never invent numbers.',
    prompt,
    maxTokens: 500,
    purpose: 'insights_summarize',
    actor,
  });
  return InsightReport.create({
    period: data.period,
    data,
    narrative: res.text,
    status: 'draft',
    ai_meta: { provider: res.provider, model: res.model },
    generated_by: adminObjectId(auth),
  });
};

export const getReportOr404 = async (id) => {
  const r = await InsightReport.findById(assertObjectId(id, 'report id'));
  if (!r) throw new ApiError(404, 'Report not found');
  return r;
};

export const reviewReport = async (report, action, body, auth) => {
  assertReviewer(auth, `${action} insight reports`);
  if (report.status !== 'draft') throw new ApiError(409, `Report is already ${report.status}`, { code: 'INVALID_TRANSITION' });
  const note = str(body?.notes, { label: 'notes', max: 2000 });
  if (body?.narrative !== undefined && action === 'approve') report.narrative = str(body.narrative, { label: 'narrative', max: 10000 });
  report.status = action === 'approve' ? 'approved' : 'rejected';
  report.reviewer = adminObjectId(auth);
  report.reviewed_at = new Date();
  report.review_notes = note;
  await report.save();
  return report;
};
