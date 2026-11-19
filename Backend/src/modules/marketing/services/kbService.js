import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { KbChunk } from '../models/KbChunk.js';
import { KbDocument } from '../models/KbDocument.js';
import { embed, generateText } from '../providers/index.js';
import { chunkText } from '../kb/chunker.js';
import { extractDocument } from '../kb/extractors.js';
import { adminObjectId, envFloat, envInt, modelIfRegistered } from './util.js';

/// Knowledge base: chunk -> embed -> cosine retrieval done in JS.
/// LIMIT: retrieval loads every active chunk embedding (up to KB_MAX_SCAN_CHUNKS,
/// default 5000) into memory per question. That is fine for a few hundred
/// documents; beyond that move to MongoDB Atlas Vector Search ($vectorSearch)
/// or another vector index and replace `retrieve()` only.

const EMBED_BATCH = 64;
export const PRODUCT_DOC_KEY = 'commerce_products';

export const DEFAULT_FALLBACK_ANSWER =
  "Thanks for your question! I don't have that information right now. A member of our team will get back to you shortly.";

export const kbSettings = () => ({
  min_score: envFloat('KB_MIN_SCORE', 0.15),
  top_k: envInt('KB_TOP_K', 4),
  max_scan_chunks: envInt('KB_MAX_SCAN_CHUNKS', 5000),
  fallback_answer: process.env.KB_FALLBACK_ANSWER || DEFAULT_FALLBACK_ANSWER,
});

const modelKey = (res) => `${res.provider}:${res.model}`;

const embedAll = async (texts, ctx) => {
  const vectors = [];
  let key = '';
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    // eslint-disable-next-line no-await-in-loop
    const res = await embed(texts.slice(i, i + EMBED_BATCH), ctx);
    vectors.push(...res.vectors);
    key = modelKey(res);
  }
  return { vectors, model: key };
};

export const cosine = (a, b) => {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/// pieces: [{ text, product_id?, meta? }] -> replace all chunks of `doc`.
const writeChunks = async (doc, pieces, actor) => {
  const { vectors, model } = await embedAll(pieces.map((p) => p.text), { purpose: 'kb_index', actor });
  await KbChunk.deleteMany({ doc: doc._id });
  if (pieces.length) {
    await KbChunk.insertMany(pieces.map((p, i) => ({
      doc: doc._id,
      text: p.text,
      embedding: vectors[i],
      embedding_model: model,
      position: i,
      source_type: doc.source_type,
      active: doc.active,
      product_id: p.product_id || null,
      meta: p.meta,
    })));
  }
  return model;
};

const markIndexed = (doc, pieces, model) => {
  doc.status = 'ready';
  doc.error = '';
  doc.chunk_count = pieces.length;
  doc.char_count = pieces.reduce((a, p) => a + p.text.length, 0);
  doc.embedding_model = model;
  doc.indexed_at = new Date();
};

const piecesFromSections = (sections) => sections.flatMap((s) => chunkText(s)).map((text) => ({ text }));

/// Index (or re-index) a document from its stored content / faqs.
const indexDocument = async (doc, actor) => {
  const full = await KbDocument.findById(doc._id).select('+content +faqs');
  const sections = full.faqs?.length ? full.faqs.map((p) => `Q: ${p.question}\nA: ${p.answer}`) : [full.content];
  const pieces = piecesFromSections(sections);
  doc.status = 'processing';
  await doc.save();
  try {
    const model = await writeChunks(doc, pieces, actor);
    markIndexed(doc, pieces, model);
    await doc.save();
    return doc;
  } catch (error) {
    doc.status = 'failed';
    doc.error = error.message;
    await doc.save();
    throw error;
  }
};

export const ingestDocument = async (input, { auth, actor }) => {
  const extracted = await extractDocument(input);
  const doc = await KbDocument.create({
    title: input.title,
    source_type: input.source_type,
    format: input.format,
    file_name: input.file_name || '',
    content: extracted.content,
    faqs: extracted.faqs,
    tags: input.tags,
    active: input.active !== false,
    uploaded_by: adminObjectId(auth),
    status: 'processing',
  });
  await indexDocument(doc, actor);
  return KbDocument.findById(doc._id); // re-read so content / faqs (select: false) are not returned
};

export const replaceDocumentText = async (doc, input, actor) => {
  const extracted = await extractDocument({ ...input, format: input.format || doc.format });
  doc.content = extracted.content;
  doc.faqs = extracted.faqs;
  if (input.format) doc.format = input.format;
  await doc.save();
  await indexDocument(doc, actor);
  return KbDocument.findById(doc._id);
};

export const reindexDocument = async (doc, actor) => {
  if (doc.system_key === PRODUCT_DOC_KEY) return (await syncProducts({ actor })).document;
  return indexDocument(doc, actor);
};

export const setDocumentActive = async (doc, active) => {
  doc.active = active;
  await doc.save();
  await KbChunk.updateMany({ doc: doc._id }, { $set: { active } });
};

export const deleteDocument = async (doc) => {
  await KbChunk.deleteMany({ doc: doc._id });
  await doc.deleteOne();
};

// ---------- commerce products (read-only) ----------

const money = (n) => (Number.isFinite(n) ? `Rs ${n}` : '');

export const productText = (p) => [
  `${p.name}${p.sku ? ` (SKU ${p.sku})` : ''}`,
  p.brand ? `Brand: ${p.brand}` : '',
  `Price: ${money(p.price)}${p.mrp ? `, MRP ${money(p.mrp)}` : ''}${p.unit ? ` per ${p.unit}` : ''}`,
  p.wholesale_tiers?.length
    ? `Wholesale: ${p.wholesale_tiers.map((t) => `${t.min_qty}+ at ${money(t.price)}`).join('; ')}`
    : '',
  p.variant_label ? `Variant: ${p.variant_label}` : '',
  p.description || '',
].filter(Boolean).join('\n');

export const syncProducts = async ({ actor, auth, resolveModel = (n) => modelIfRegistered(mongoose, n) } = {}) => {
  const Product = resolveModel('CommerceProduct');
  if (!Product) {
    throw new ApiError(409, 'The commerce module is not loaded, so there are no products to sync', {
      code: 'COMMERCE_NOT_AVAILABLE',
    });
  }
  const limit = envInt('KB_PRODUCT_SYNC_LIMIT', 2000);
  const products = await Product.find({ active: true })
    .select('name sku brand price mrp unit wholesale_tiers variant_label description images')
    .limit(limit)
    .lean();
  let doc = await KbDocument.findOne({ system_key: PRODUCT_DOC_KEY });
  if (!doc) {
    doc = await KbDocument.create({
      title: 'Product catalogue (synced from commerce)',
      source_type: 'product_catalog',
      format: 'products',
      system_key: PRODUCT_DOC_KEY,
      uploaded_by: adminObjectId(auth),
    });
  }
  const pieces = products.flatMap((p) => chunkText(productText(p)).map((text) => ({
    text,
    product_id: p._id,
    meta: { name: p.name, sku: p.sku, price: p.price, image: p.images?.[0] || '' },
  })));
  doc.status = 'processing';
  await doc.save();
  try {
    const model = await writeChunks(doc, pieces, actor);
    markIndexed(doc, pieces, model);
    await doc.save();
  } catch (error) {
    doc.status = 'failed';
    doc.error = error.message;
    await doc.save();
    throw error;
  }
  return { document: doc, products: products.length, chunks: pieces.length, truncated: products.length === limit };
};

// ---------- retrieval ----------

export const retrieve = async (query, { k, sourceTypes, actor, purpose = 'kb_retrieve' } = {}) => {
  const settings = kbSettings();
  const topK = k || settings.top_k;
  const res = await embed([query], { purpose, actor });
  const [qv] = res.vectors;
  const filter = { embedding_model: modelKey(res), active: true };
  if (sourceTypes?.length) filter.source_type = { $in: sourceTypes };
  const chunks = await KbChunk.find(filter)
    .select('doc text embedding position source_type product_id meta')
    .limit(settings.max_scan_chunks)
    .lean();
  const scored = chunks
    .map((c) => ({ c, score: cosine(qv, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  const docIds = [...new Set(scored.map((s) => String(s.c.doc)))];
  const titles = Object.fromEntries(
    (await KbDocument.find({ _id: { $in: docIds } }).select('title').lean()).map((d) => [String(d._id), d.title]),
  );
  return {
    scanned: chunks.length,
    scan_limit_hit: chunks.length === settings.max_scan_chunks,
    hits: scored.map(({ c, score }) => ({
      chunk_id: c._id,
      doc_id: c.doc,
      doc_title: titles[String(c.doc)] || '',
      position: c.position,
      source_type: c.source_type,
      product_id: c.product_id || null,
      meta: c.meta,
      score: Number(score.toFixed(4)),
      text: c.text,
    })),
  };
};

const NOT_FOUND_TOKEN = 'NOT_IN_CONTEXT';

const ANSWER_SYSTEM = [
  'You are a helpful assistant for our business, answering customer questions.',
  'Answer ONLY from the numbered context passages. Be short and friendly.',
  'Never invent prices, stock levels, delivery dates or policies.',
  `If the context does not contain the answer, reply with exactly ${NOT_FOUND_TOKEN}.`,
].join(' ');

/// Retrieve -> (fallback + needs_human if weak) -> grounded answer with cited chunk ids.
/// Output is a draft for staff unless the caller decides otherwise.
export const answerQuestion = async (question, { actor, k, purpose = 'kb_answer' } = {}) => {
  const settings = kbSettings();
  const { hits } = await retrieve(question, { k, actor });
  const best = hits[0]?.score || 0;
  const fallback = (reason) => ({
    answer: settings.fallback_answer,
    needs_human: true,
    reason,
    best_score: best,
    min_score: settings.min_score,
    citations: [],
    hits,
  });
  const relevant = hits.filter((h) => h.score >= settings.min_score);
  if (!relevant.length) return fallback(hits.length ? 'low_confidence' : 'empty_knowledge_base');

  const context = relevant.map((h, i) => `[${i + 1}] (${h.doc_title}) ${h.text}`).join('\n\n');
  const prompt = `Context:\n${context}\n\nCustomer question: ${question}\n\nAnswer:`;
  const res = await generateText({ system: ANSWER_SYSTEM, prompt, maxTokens: 400, purpose, actor });
  if (!res.text || res.text.includes(NOT_FOUND_TOKEN)) return fallback('not_in_context');
  return {
    answer: res.text,
    needs_human: false,
    reason: 'answered',
    best_score: best,
    min_score: settings.min_score,
    citations: relevant.map((h) => h.chunk_id),
    hits,
    ai: { provider: res.provider, model: res.model },
  };
};

/// Products whose chunks best match a free-text need ("cheap 5kg rice for a shop").
export const recommendProducts = async (query, { k = 5, actor } = {}) => {
  const settings = kbSettings();
  const { hits } = await retrieve(query, { k: k * 4, sourceTypes: ['product_catalog'], actor, purpose: 'kb_recommend' });
  const seen = new Map();
  for (const h of hits) {
    if (!h.product_id || h.score < settings.min_score) continue;
    const key = String(h.product_id);
    if (!seen.has(key)) {
      seen.set(key, { product_id: h.product_id, score: h.score, name: h.meta?.name || '', sku: h.meta?.sku || '', price: h.meta?.price ?? null, image: h.meta?.image || '', excerpt: h.text.slice(0, 200) });
    }
  }
  const items = [...seen.values()].slice(0, k);
  return { items, needs_human: items.length === 0, min_score: settings.min_score };
};
