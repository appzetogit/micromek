import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import {
  CONTENT_CHANNELS, CONTENT_EDITABLE, CONTENT_KINDS, CONTENT_TONES, CONTENT_TRANSITIONS, DEFAULT_KIND_BY_CHANNEL,
} from '../constants.js';
import { ContentItem } from '../models/ContentItem.js';
import { generateText } from '../providers/index.js';
import { jsonInstruction, parseJsonLoose } from '../providers/json.js';
import { getPublisher } from '../publishers/index.js';
import {
  adminObjectId, assertObjectId, assertReviewer, dateOrNull, historyEntry, intIn, modelIfRegistered, oneOf, str, strList,
  toObjectIds,
} from './util.js';

const EDIT_FIELDS = ['channel', 'kind', 'title', 'body', 'description', 'call_to_action', 'hashtags', 'media_urls', 'link_url', 'product_ids', 'scheduled_at'];

export const normalizeContentInput = (body = {}, { partial = false } = {}) => {
  const out = {};
  if (!partial || body.channel !== undefined) out.channel = oneOf(body.channel, CONTENT_CHANNELS, 'channel');
  if (body.kind !== undefined || !partial) {
    out.kind = oneOf(body.kind, CONTENT_KINDS, 'kind', DEFAULT_KIND_BY_CHANNEL[out.channel] || 'post');
  }
  if (body.title !== undefined) out.title = str(body.title, { label: 'title', max: 300 });
  if (body.body !== undefined) out.body = str(body.body, { label: 'body', max: 5000 });
  if (body.description !== undefined) out.description = str(body.description, { label: 'description', max: 1000 });
  if (body.call_to_action !== undefined) out.call_to_action = str(body.call_to_action, { label: 'call_to_action', max: 40 });
  if (body.hashtags !== undefined) out.hashtags = strList(body.hashtags, { label: 'hashtags', max: 30, itemMax: 100 }).map((h) => (h.startsWith('#') ? h : `#${h}`));
  if (body.media_urls !== undefined) out.media_urls = strList(body.media_urls, { label: 'media_urls', max: 10, itemMax: 2000 });
  if (body.link_url !== undefined) out.link_url = str(body.link_url, { label: 'link_url', max: 2000 });
  if (body.product_ids !== undefined) out.product_ids = toObjectIds(body.product_ids);
  if (body.scheduled_at !== undefined) out.scheduled_at = dateOrNull(body.scheduled_at, 'scheduled_at');
  if (!partial && !out.title && !out.body) throw new ApiError(400, 'title or body is required');
  return out;
};

export const getContentOr404 = async (id) => {
  const item = await ContentItem.findById(assertObjectId(id, 'content id'));
  if (!item) throw new ApiError(404, 'Content item not found');
  return item;
};

export const createContent = async (body, auth) => {
  const data = normalizeContentInput(body);
  return ContentItem.create({
    ...data,
    status: 'draft',
    created_by: adminObjectId(auth),
    history: [historyEntry('create', '', 'draft', auth)],
  });
};

/// Approved / scheduled / published items are frozen: editing would bypass review.
export const updateContent = async (item, body, auth) => {
  if (!CONTENT_EDITABLE.includes(item.status)) {
    throw new ApiError(409, `Content in status "${item.status}" cannot be edited; reject it first`, { code: 'NOT_EDITABLE' });
  }
  const data = normalizeContentInput(EDIT_FIELDS.reduce((o, k) => (body[k] === undefined ? o : { ...o, [k]: body[k] }), {}), { partial: true });
  const from = item.status;
  item.set(data);
  item.status = 'draft';
  item.history.push(historyEntry('edit', from, 'draft', auth));
  await item.save();
  return item;
};

export const deleteContent = async (item) => {
  if (!CONTENT_EDITABLE.includes(item.status)) {
    throw new ApiError(409, 'Only draft or rejected content can be deleted', { code: 'NOT_DELETABLE' });
  }
  await item.deleteOne();
};

export const transitionContent = async (item, action, body = {}, auth) => {
  const rule = CONTENT_TRANSITIONS[action];
  if (!rule) throw new ApiError(400, `Unknown action ${action}`);
  if (rule.reviewer) assertReviewer(auth, `${action} content`);
  if (!rule.from.includes(item.status)) {
    throw new ApiError(409, `Cannot ${action} content in status "${item.status}"`, { code: 'INVALID_TRANSITION' });
  }
  const note = str(body.notes ?? body.note, { label: 'notes', max: 2000 });
  if (action === 'reject' && !note) throw new ApiError(400, 'notes are required when rejecting');
  if (action === 'submit' && !item.title && !item.body) throw new ApiError(400, 'Content is empty');
  if (action === 'schedule') {
    const at = dateOrNull(body.scheduled_at, 'scheduled_at') || item.scheduled_at;
    if (!at) throw new ApiError(400, 'scheduled_at is required');
    if (at.getTime() < Date.now() - 60000) throw new ApiError(400, 'scheduled_at must be in the future');
    if (item.channel === 'instagram' && !item.media_urls?.length) {
      throw new ApiError(400, 'Instagram posts need at least one media url');
    }
    item.scheduled_at = at;
  }
  const from = item.status;
  item.status = rule.to;
  if (action === 'submit') item.submitted_at = new Date();
  if (rule.reviewer) {
    item.reviewer = adminObjectId(auth);
    item.reviewed_at = new Date();
    item.review_notes = note;
  }
  item.history.push(historyEntry(action, from, rule.to, auth, note));
  await item.save();
  return item;
};

/// Manual "publish now". With the disabled publisher this answers 503 META_PUBLISHING_NOT_CONFIGURED.
export const publishContentNow = async (item, auth) => {
  if (!['approved', 'scheduled'].includes(item.status)) {
    throw new ApiError(409, 'Only approved or scheduled content can be published', { code: 'NOT_APPROVED' });
  }
  const publisher = getPublisher();
  const result = await publisher.publishContent(item.toObject());
  return markPublished(item, publisher, result, auth);
};

export const markPublished = async (item, publisher, result = {}, auth = null) => {
  const from = item.status;
  item.status = 'published';
  item.publish = {
    ...(item.publish?.toObject?.() || item.publish || {}),
    publisher: publisher.name,
    external_id: String(result.external_id || ''),
    permalink: String(result.permalink || ''),
    raw: result.raw,
    error: '',
    locked_until: null,
    published_at: new Date(),
    last_attempt_at: new Date(),
  };
  item.history.push(historyEntry('publish', from, 'published', auth, publisher.name));
  await item.save();
  return item;
};

// ---------- AI generation (always produces drafts) ----------

const loadProduct = async (productId) => {
  if (!productId) return null;
  const Product = modelIfRegistered(mongoose, 'CommerceProduct');
  if (!Product) throw new ApiError(409, 'The commerce module is not loaded', { code: 'COMMERCE_NOT_AVAILABLE' });
  const p = await Product.findById(assertObjectId(productId, 'product_id')).select('name brand price mrp unit description images').lean();
  if (!p) throw new ApiError(404, 'Product not found');
  return p;
};

const CHANNEL_HINT = {
  facebook: 'a Facebook Page post (up to ~120 words, can include a link)',
  instagram: 'an Instagram caption (short lines, emojis allowed, 5-10 hashtags)',
  whatsapp: 'a WhatsApp broadcast message (under 60 words, clear call to action, no hashtags)',
  ad: 'Meta ad copy: headline under 40 characters, primary text under 125 characters, description under 30 characters',
};

export const generateContent = async (body = {}, { auth, actor }) => {
  const channel = oneOf(body.channel, CONTENT_CHANNELS, 'channel');
  const theme = str(body.theme, { label: 'theme', max: 500, required: true });
  const tone = oneOf(body.tone, CONTENT_TONES, 'tone', 'friendly');
  const variations = intIn(body.variations, { min: 1, max: 5, fallback: 3, label: 'variations' });
  const extra = str(body.instructions, { label: 'instructions', max: 1000 });
  const product = await loadProduct(body.product_id);
  const kind = oneOf(body.kind, CONTENT_KINDS, 'kind', DEFAULT_KIND_BY_CHANNEL[channel]);

  const productLines = product
    ? `Product: ${product.name}${product.brand ? ` by ${product.brand}` : ''}. Price Rs ${product.price}${product.mrp > product.price ? ` (MRP Rs ${product.mrp})` : ''}. ${String(product.description || '').slice(0, 600)}`
    : 'No specific product.';
  const example = {
    variations: Array.from({ length: variations }, (_, i) => ({
      title: `Headline ${i + 1} about ${theme}`,
      body: `Post text ${i + 1} about ${theme}`,
      description: channel === 'ad' ? 'Short link description' : '',
      call_to_action: channel === 'ad' ? 'SHOP_NOW' : '',
      hashtags: channel === 'whatsapp' ? [] : ['#example'],
    })),
  };
  const system = 'You are a marketing copywriter for a retail and wholesale business in India. Write accurate copy: never invent discounts, prices or claims that are not given. Your output is a draft that a human will review.';
  const prompt = [
    `Write ${variations} distinct variation(s) of ${CHANNEL_HINT[channel]}.`,
    `Theme / occasion: ${theme}.`,
    `Tone: ${tone}.`,
    productLines,
    extra ? `Extra instructions: ${extra}` : '',
    jsonInstruction(example),
  ].filter(Boolean).join('\n');

  const res = await generateText({ system, prompt, maxTokens: 300 * variations, purpose: 'content_generate', actor });
  const parsed = parseJsonLoose(res.text);
  let list = Array.isArray(parsed?.variations) ? parsed.variations : null;
  if (!list?.length) list = [{ title: theme, body: res.text }]; // unparseable reply: keep it as one draft
  const batchId = randomUUID();
  const docs = list.slice(0, variations).map((v, i) => ({
    channel,
    kind,
    title: String(v?.title || v?.headline || '').slice(0, 300),
    body: String(v?.body || v?.primary_text || '').slice(0, 5000),
    description: String(v?.description || '').slice(0, 1000),
    call_to_action: String(v?.call_to_action || '').slice(0, 40),
    hashtags: (Array.isArray(v?.hashtags) ? v.hashtags : []).map(String).slice(0, 30),
    product_ids: product ? [product._id] : [],
    status: 'draft',
    ai_generated: true,
    ai_prompt: prompt,
    ai_meta: { provider: res.provider, model: res.model, theme, tone, batch_id: batchId, variation: i + 1 },
    created_by: adminObjectId(auth),
    history: [historyEntry('ai_generate', '', 'draft', auth)],
  }));
  const items = await ContentItem.insertMany(docs);
  return { batch_id: batchId, items };
};
