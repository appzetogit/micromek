import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok, paged } from '../../shared/guards.js';
import {
  CAMPAIGN_STATUS, CONTENT_CHANNELS, CONTENT_KINDS, CONTENT_STATUS, KB_FORMATS, KB_SOURCE_TYPES, KB_STATUS,
} from '../constants.js';
import { AdCampaignDraft } from '../models/AdCampaignDraft.js';
import { AiUsage } from '../models/AiUsage.js';
import { ContentItem } from '../models/ContentItem.js';
import { InsightReport } from '../models/InsightReport.js';
import { KbChunk } from '../models/KbChunk.js';
import { KbDocument } from '../models/KbDocument.js';
import { providerStatus } from '../providers/index.js';
import { publisherStatus } from '../publishers/index.js';
import * as campaigns from '../services/campaignService.js';
import * as content from '../services/contentService.js';
import * as insights from '../services/insightsService.js';
import * as kb from '../services/kbService.js';
import {
  actorOf, assertObjectId, canReview, dateOrNull, escapeRegex, intIn, oneOf, parsePaging, str, strList,
} from '../services/util.js';

const listPage = async (Model, filter, query, { sort = { updatedAt: -1 }, select } = {}) => {
  const { page, limit, skip } = parsePaging(query);
  const q = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (select) q.select(select);
  const [items, total] = await Promise.all([q.lean(), Model.countDocuments(filter)]);
  return { items, total, page, limit };
};

// ---------- status & usage ----------

export const status = asyncHandler(async (req, res) => {
  ok(res, {
    ai: await providerStatus(),
    publishing: publisherStatus(),
    knowledge_base: kb.kbSettings(),
    you: { can_review: canReview(req.auth) },
  });
});

export const usage = asyncHandler(async (req, res) => {
  const days = intIn(req.query.days, { min: 1, max: 90, fallback: 7, label: 'days' });
  const since = new Date(Date.now() - days * 86400000);
  const match = { createdAt: { $gte: since } };
  const [byDay, byPurpose] = await Promise.all([
    AiUsage.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, calls: { $sum: 1 }, failed: { $sum: { $cond: ['$ok', 0, 1] } }, input_tokens: { $sum: '$input_tokens' }, output_tokens: { $sum: '$output_tokens' }, chars: { $sum: { $add: ['$input_chars', '$output_chars'] } } } },
      { $sort: { _id: 1 } },
    ]),
    AiUsage.aggregate([
      { $match: match },
      { $group: { _id: '$purpose', calls: { $sum: 1 }, input_tokens: { $sum: '$input_tokens' }, output_tokens: { $sum: '$output_tokens' } } },
      { $sort: { calls: -1 } },
    ]),
  ]);
  const recent = await listPage(AiUsage, match, req.query, { sort: { createdAt: -1 } });
  ok(res, {
    days,
    by_day: byDay.map(({ _id, ...r }) => ({ day: _id, ...r })),
    by_purpose: byPurpose.map(({ _id, ...r }) => ({ purpose: _id, ...r })),
    recent: { ...recent, pages: Math.ceil(recent.total / recent.limit) || 0 },
  });
});

// ---------- knowledge base ----------

const getDocOr404 = async (id, select = '') => {
  const doc = await KbDocument.findById(assertObjectId(id, 'document id')).select(select);
  if (!doc) throw new ApiError(404, 'Document not found');
  return doc;
};

export const listDocuments = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = oneOf(req.query.status, KB_STATUS, 'status');
  if (req.query.source_type) filter.source_type = oneOf(req.query.source_type, KB_SOURCE_TYPES, 'source_type');
  if (req.query.active !== undefined) filter.active = String(req.query.active) === 'true';
  if (req.query.tag) filter.tags = String(req.query.tag).toLowerCase();
  if (req.query.q) filter.title = { $regex: escapeRegex(req.query.q), $options: 'i' };
  paged(res, await listPage(KbDocument, filter, req.query));
});

export const ingestDocument = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const format = oneOf(b.format, KB_FORMATS.filter((f) => f !== 'products'), 'format', b.faqs ? 'faq_json' : 'text');
  const doc = await kb.ingestDocument({
    title: str(b.title, { label: 'title', max: 300, required: true }),
    source_type: oneOf(b.source_type, KB_SOURCE_TYPES, 'source_type', format === 'faq_json' ? 'faq' : 'upload'),
    format,
    file_name: str(b.file_name, { label: 'file_name', max: 300 }),
    text: b.text,
    faqs: b.faqs,
    content_base64: b.content_base64,
    tags: strList(b.tags, { label: 'tags', max: 20, itemMax: 50 }).map((t) => t.toLowerCase()),
    active: b.active,
  }, { auth: req.auth, actor: actorOf(req) });
  ok(res, doc, 201);
});

export const getDocument = asyncHandler(async (req, res) => {
  const doc = await getDocOr404(req.params.id, '+content +faqs');
  const data = doc.toObject();
  if (String(req.query.include || '').split(',').includes('chunks')) {
    data.chunks = await KbChunk.find({ doc: doc._id }).select('text position product_id embedding_model').sort({ position: 1 }).lean();
  }
  ok(res, data);
});

export const updateDocument = asyncHandler(async (req, res) => {
  const b = req.body || {};
  let doc = await getDocOr404(req.params.id);
  if (b.title !== undefined) doc.title = str(b.title, { label: 'title', max: 300, required: true });
  if (b.tags !== undefined) doc.tags = strList(b.tags, { label: 'tags', max: 20, itemMax: 50 }).map((t) => t.toLowerCase());
  if (b.source_type !== undefined && !doc.system_key) {
    doc.source_type = oneOf(b.source_type, KB_SOURCE_TYPES, 'source_type');
    await KbChunk.updateMany({ doc: doc._id }, { $set: { source_type: doc.source_type } });
  }
  await doc.save();
  if (b.active !== undefined) await kb.setDocumentActive(doc, b.active === true || b.active === 'true');
  if ((b.text !== undefined || b.faqs !== undefined) && !doc.system_key) {
    if (b.format !== undefined) oneOf(b.format, KB_FORMATS.filter((f) => f !== 'products'), 'format');
    doc = await kb.replaceDocumentText(doc, { text: b.text, faqs: b.faqs, format: b.format, content_base64: b.content_base64 }, actorOf(req));
  }
  ok(res, doc);
});

export const reindexDocument = asyncHandler(async (req, res) => {
  ok(res, await kb.reindexDocument(await getDocOr404(req.params.id), actorOf(req)));
});

export const deleteDocument = asyncHandler(async (req, res) => {
  await kb.deleteDocument(await getDocOr404(req.params.id));
  ok(res, { deleted: true });
});

export const syncProducts = asyncHandler(async (req, res) => {
  ok(res, await kb.syncProducts({ auth: req.auth, actor: actorOf(req) }));
});

export const testAnswer = asyncHandler(async (req, res) => {
  const question = str(req.body?.question, { label: 'question', max: 1000, required: true });
  const k = intIn(req.body?.k, { min: 1, max: 10, fallback: undefined, label: 'k' });
  ok(res, { ...(await kb.answerQuestion(question, { actor: actorOf(req), k })), draft: true });
});

export const recommend = asyncHandler(async (req, res) => {
  const query = str(req.body?.query ?? req.body?.question, { label: 'query', max: 1000, required: true });
  const k = intIn(req.body?.k, { min: 1, max: 20, fallback: 5, label: 'k' });
  ok(res, await kb.recommendProducts(query, { k, actor: actorOf(req) }));
});

// ---------- content ----------

export const listContent = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = { $in: strList(req.query.status).map((s) => oneOf(s, CONTENT_STATUS, 'status')) };
  if (req.query.channel) filter.channel = oneOf(req.query.channel, CONTENT_CHANNELS, 'channel');
  if (req.query.kind) filter.kind = oneOf(req.query.kind, CONTENT_KINDS, 'kind');
  if (req.query.ai_generated !== undefined) filter.ai_generated = String(req.query.ai_generated) === 'true';
  if (req.query.batch_id) filter['ai_meta.batch_id'] = String(req.query.batch_id);
  if (req.query.q) filter.$or = [{ title: { $regex: escapeRegex(req.query.q), $options: 'i' } }, { body: { $regex: escapeRegex(req.query.q), $options: 'i' } }];
  paged(res, await listPage(ContentItem, filter, req.query, { select: '-ai_prompt -history' }));
});

/// Content calendar: scheduled / published items (and approved items with a planned date) in a window.
export const contentCalendar = asyncHandler(async (req, res) => {
  const from = dateOrNull(req.query.from, 'from') || new Date(Date.now() - 7 * 86400000);
  const to = dateOrNull(req.query.to, 'to') || new Date(from.getTime() + 35 * 86400000);
  if (to <= from || to - from > 100 * 86400000) throw new ApiError(400, 'Window must be positive and at most 100 days');
  const items = await ContentItem.find({ scheduled_at: { $gte: from, $lt: to }, status: { $ne: 'rejected' } })
    .select('channel kind title status scheduled_at media_urls ai_generated')
    .sort({ scheduled_at: 1 })
    .limit(1000)
    .lean();
  const days = {};
  for (const it of items) (days[it.scheduled_at.toISOString().slice(0, 10)] ||= []).push(it);
  ok(res, { from, to, days });
});

export const createContent = asyncHandler(async (req, res) => ok(res, await content.createContent(req.body || {}, req.auth), 201));
export const generateContent = asyncHandler(async (req, res) => ok(res, await content.generateContent(req.body || {}, { auth: req.auth, actor: actorOf(req) }), 201));
export const getContent = asyncHandler(async (req, res) => ok(res, await content.getContentOr404(req.params.id)));
export const updateContent = asyncHandler(async (req, res) => ok(res, await content.updateContent(await content.getContentOr404(req.params.id), req.body || {}, req.auth)));
export const deleteContent = asyncHandler(async (req, res) => {
  await content.deleteContent(await content.getContentOr404(req.params.id));
  ok(res, { deleted: true });
});
export const transitionContent = asyncHandler(async (req, res) =>
  ok(res, await content.transitionContent(await content.getContentOr404(req.params.id), req.params.action, req.body || {}, req.auth)));
export const publishContent = asyncHandler(async (req, res) =>
  ok(res, await content.publishContentNow(await content.getContentOr404(req.params.id), req.auth)));

// ---------- campaigns ----------

export const listCampaigns = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = oneOf(req.query.status, CAMPAIGN_STATUS, 'status');
  if (req.query.q) filter.name = { $regex: escapeRegex(req.query.q), $options: 'i' };
  paged(res, await listPage(AdCampaignDraft, filter, req.query, { select: '-ai_prompt -history' }));
});
export const createCampaign = asyncHandler(async (req, res) => ok(res, await campaigns.createCampaign(req.body || {}, req.auth), 201));
export const recommendCampaign = asyncHandler(async (req, res) => ok(res, await campaigns.recommendCampaign(req.body || {}, { auth: req.auth, actor: actorOf(req) }), 201));
export const getCampaign = asyncHandler(async (req, res) => ok(res, await campaigns.getCampaignOr404(req.params.id)));
export const updateCampaign = asyncHandler(async (req, res) => ok(res, await campaigns.updateCampaign(await campaigns.getCampaignOr404(req.params.id), req.body || {}, req.auth)));
export const deleteCampaign = asyncHandler(async (req, res) => {
  await campaigns.deleteCampaign(await campaigns.getCampaignOr404(req.params.id));
  ok(res, { deleted: true });
});
export const transitionCampaign = asyncHandler(async (req, res) =>
  ok(res, await campaigns.transitionCampaign(await campaigns.getCampaignOr404(req.params.id), req.params.action, req.body || {}, req.auth)));
export const campaignMetrics = asyncHandler(async (req, res) =>
  ok(res, await campaigns.recordMetrics(await campaigns.getCampaignOr404(req.params.id), req.body || {})));
export const publishCampaign = asyncHandler(async (req, res) =>
  ok(res, await campaigns.publishCampaign(await campaigns.getCampaignOr404(req.params.id), req.auth)));

// ---------- insights ----------

const daysParam = (v) => intIn(v, { min: 1, max: 365, fallback: 30, label: 'days' });

export const insightsSummary = asyncHandler(async (req, res) => ok(res, await insights.buildSummary({ days: daysParam(req.query.days) })));
export const insightsSummarize = asyncHandler(async (req, res) =>
  ok(res, await insights.summarize({ days: daysParam(req.body?.days ?? req.query.days), auth: req.auth, actor: actorOf(req) }), 201));
export const listReports = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = oneOf(req.query.status, ['draft', 'approved', 'rejected'], 'status');
  paged(res, await listPage(InsightReport, filter, req.query, { sort: { createdAt: -1 }, select: '-data' }));
});
export const getReport = asyncHandler(async (req, res) => ok(res, await insights.getReportOr404(req.params.id)));
export const reviewReport = asyncHandler(async (req, res) =>
  ok(res, await insights.reviewReport(await insights.getReportOr404(req.params.id), req.params.action, req.body || {}, req.auth)));
