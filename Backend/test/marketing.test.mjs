import express from 'express';
import { adminToken, check, imp, start } from './harness.mjs';

const { stop, mongoose } = await start();
const { marketingRouter } = await imp('src/modules/marketing/routes/index.js');
const { errorHandler } = await imp('src/modules/taxi/middlewares/errorMiddleware.js');
const { runPublishDue } = await imp('src/modules/marketing/services/jobs.js');
const { registerPublisher } = await imp('src/modules/marketing/publishers/index.js');
const { buildSummary } = await imp('src/modules/marketing/services/insightsService.js');
const { chunkText } = await imp('src/modules/marketing/kb/chunker.js');
const { ContentItem } = await imp('src/modules/marketing/models/ContentItem.js');
const { AiUsage } = await imp('src/modules/marketing/models/AiUsage.js');

// The router is not mounted in app.js yet: build a small app around it, with a
// sentinel after it to prove non-marketing paths fall through.
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/v1', marketingRouter);
app.use('/api/v1', (req, res) => res.status(200).json({ fallthrough: true, path: req.path }));
app.use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};

delete process.env.AI_PROVIDER; // NODE_ENV=test -> mock
delete process.env.MKT_PUBLISHER;
const root = await adminToken(mongoose);
const sub = await adminToken(mongoose, { subadmin: true, permissions: ['marketing.view'] });
const reviewer = await adminToken(mongoose, { subadmin: true, permissions: ['marketing.view', 'marketing.approve'] });
const outsider = await adminToken(mongoose, { subadmin: true, permissions: ['leads.view'] });

console.log('routing + access');
const fall = await call('GET', '/admin/permissions');
check('non-marketing /admin path falls through (no auth required here)', fall.status === 200 && fall.body.fallthrough === true, fall.body);
const fall2 = await call('GET', '/admin/marketingx');
check('/admin/marketingx is not claimed', fall2.body.fallthrough === true, fall2.body);
check('no token on /admin/marketing -> 401', (await call('GET', '/admin/marketing/status')).status === 401);
check('subadmin without marketing.view -> 403', (await call('GET', '/admin/marketing/status', { token: outsider })).status === 403);
const st = await call('GET', '/admin/marketing/status', { token: sub });
check('status shows mock provider + disabled publisher', st.status === 200 && st.body.data.ai.provider === 'mock' && st.body.data.publishing.enabled === false && st.body.data.you.can_review === false, st.body);

console.log('chunking');
const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about something useful for customers.`).join(' ');
const chunks = chunkText(long);
check('long text split into ~800 char chunks', chunks.length >= 3 && chunks.every((c) => c.length <= 800), chunks.map((c) => c.length));
check('chunks overlap', chunks[1] && chunks[0].slice(-60).split(' ').slice(2, 5).every((w) => chunks[1].includes(w)), [chunks[0].slice(-60), chunks[1]?.slice(0, 100)]);

console.log('knowledge base');
const policy = await call('POST', '/admin/marketing/kb/documents', { token: sub, body: {
  title: 'Returns policy', source_type: 'policy', format: 'markdown', tags: ['Returns'],
  text: '# Returns\nDamaged items can be returned within 7 days of delivery for a full refund. Refund goes to the original payment method within 5 working days.\n\n# Shipping\nWe deliver across Indore and Bhopal. Delivery takes 2 days.',
} });
check('ingest markdown -> ready with chunks', policy.status === 201 && policy.body.data.status === 'ready' && policy.body.data.chunk_count >= 1, policy.body);
check('content not returned in ingest response', policy.body.data && !('content' in policy.body.data));
const faq = await call('POST', '/admin/marketing/kb/documents', { token: sub, body: {
  title: 'FAQ', format: 'faq_json',
  faqs: [{ question: 'Do you offer wholesale pricing?', answer: 'Yes, wholesale pricing starts at 10 units per product.' }, { q: 'What are your shop timings?', a: 'Open 9am to 9pm, Monday to Saturday.' }],
} });
check('ingest FAQ pairs -> one chunk per pair', faq.status === 201 && faq.body.data.chunk_count === 2 && faq.body.data.source_type === 'faq', faq.body);
const pdfNoText = await call('POST', '/admin/marketing/kb/documents', { token: sub, body: { title: 'Catalogue', format: 'pdf', content_base64: 'JVBERi0x' } });
check('pdf without extracted text -> 501 hook', pdfNoText.status === 501 && pdfNoText.body.details?.code === 'PDF_EXTRACTION_NOT_AVAILABLE', pdfNoText.body);
const pdf = await call('POST', '/admin/marketing/kb/documents', { token: sub, body: { title: 'Spec sheet', format: 'pdf', text: 'Steel water bottle 1 litre keeps drinks cold for 24 hours.' } });
check('pdf with client-extracted text ingests', pdf.status === 201 && pdf.body.data.status === 'ready', pdf.body);

const ans = await call('POST', '/admin/marketing/kb/answer', { token: sub, body: { question: 'Can damaged items be returned for a refund?' } });
const policyChunkIds = (await call('GET', `/admin/marketing/kb/documents/${policy.body.data._id}?include=chunks`, { token: sub })).body.data.chunks.map((c) => String(c._id));
check('answer is grounded and cites chunks', ans.status === 200 && ans.body.data.needs_human === false && ans.body.data.citations.length >= 1, ans.body);
check('top citation is from the returns policy', policyChunkIds.includes(String(ans.body.data.citations?.[0])), { cites: ans.body.data?.citations, policyChunkIds });
check('answer marked draft', ans.body.data?.draft === true);
const low = await call('POST', '/admin/marketing/kb/answer', { token: sub, body: { question: 'quantum teleportation spaceship galaxy' } });
check('unrelated question -> fallback + needs_human', low.status === 200 && low.body.data.needs_human === true && low.body.data.citations.length === 0 && low.body.data.answer.length > 10, low.body);

// deactivate the policy -> its chunks drop out of retrieval
await call('PATCH', `/admin/marketing/kb/documents/${policy.body.data._id}`, { token: sub, body: { active: false } });
const inactive = await call('POST', '/admin/marketing/kb/answer', { token: sub, body: { question: 'Can damaged items be returned for a refund?' } });
check('inactive document not cited', !inactive.body.data.citations.some((id) => policyChunkIds.includes(String(id))), inactive.body.data);
const re = await call('POST', `/admin/marketing/kb/documents/${faq.body.data._id}/reindex`, { token: sub });
check('reindex', re.status === 200 && re.body.data.status === 'ready' && re.body.data.chunk_count === 2, re.body);

console.log('product sync + recommendations');
const Product = mongoose.models.CommerceProduct;
check('commerce product model registered by the app', !!Product);
await Product.collection.insertMany([
  { sku: 'RICE5', name: 'Basmati Rice 5kg', slug: 'rice-5', brand: 'Kohinoor', price: 650, mrp: 700, unit: 'pack', description: 'Long grain basmati rice, aged.', active: true, wholesale_tiers: [{ min_qty: 10, price: 600 }] },
  { sku: 'OIL1', name: 'Sunflower Oil 1L', slug: 'oil-1', brand: 'Fortune', price: 150, unit: 'l', description: 'Refined sunflower cooking oil.', active: true },
  { sku: 'OLD', name: 'Discontinued Rice', slug: 'old', price: 1, active: false },
]);
const sync = await call('POST', '/admin/marketing/kb/sync-products', { token: sub });
check('sync products (active only)', sync.status === 200 && sync.body.data.products === 2 && sync.body.data.document.source_type === 'product_catalog', sync.body);
const rec = await call('POST', '/admin/marketing/kb/recommend', { token: sub, body: { query: 'basmati rice for my shop', k: 3 } });
check('recommends the rice product first', rec.status === 200 && rec.body.data.items[0]?.sku === 'RICE5', rec.body);
const resync = await call('POST', '/admin/marketing/kb/sync-products', { token: sub });
check('re-sync reuses the same document', resync.body.data.document._id === sync.body.data.document._id);

console.log('content generation + approval');
const gen = await call('POST', '/admin/marketing/content/generate', { token: sub, body: { channel: 'instagram', theme: 'Diwali sale', tone: 'playful', variations: 3 } });
check('generate creates 3 items', gen.status === 201 && gen.body.data.items.length === 3, gen.body);
check('all generated items are drafts flagged ai_generated', gen.body.data.items?.every((i) => i.status === 'draft' && i.ai_generated && i.ai_prompt), gen.body.data.items);
check('generated copy parsed from provider JSON', gen.body.data.items?.[0]?.title.includes('Diwali sale') && gen.body.data.items[0].hashtags.length >= 1, gen.body.data.items?.[0]);
const genP = await call('POST', '/admin/marketing/content/generate', { token: sub, body: { channel: 'ad', theme: 'Rice launch', product_id: String((await Product.findOne({ sku: 'RICE5' }))._id), variations: 1 } });
check('ad copy for a product -> ad_copy draft linked to product', genP.status === 201 && genP.body.data.items[0].kind === 'ad_copy' && genP.body.data.items[0].product_ids.length === 1 && genP.body.data.items[0].ai_prompt.includes('Basmati'), genP.body);
const notPublished = await ContentItem.countDocuments({ status: { $ne: 'draft' } });
check('nothing beyond draft after generation', notPublished === 0);

const item = gen.body.data.items[0];
const earlyApprove = await call('POST', `/admin/marketing/content/${item._id}/approve`, { token: root });
check('cannot approve a draft that was not submitted', earlyApprove.status === 409, earlyApprove.body);
const submit = await call('POST', `/admin/marketing/content/${item._id}/submit`, { token: sub });
check('subadmin can submit for review', submit.status === 200 && submit.body.data.status === 'in_review', submit.body);
const subApprove = await call('POST', `/admin/marketing/content/${item._id}/approve`, { token: sub });
check('subadmin (no marketing.approve) cannot approve', subApprove.status === 403 && subApprove.body.details?.code === 'REVIEWER_REQUIRED', subApprove.body);
const rejectNoNote = await call('POST', `/admin/marketing/content/${item._id}/reject`, { token: reviewer });
check('reject needs notes', rejectNoNote.status === 400);
const approve = await call('POST', `/admin/marketing/content/${item._id}/approve`, { token: reviewer, body: { notes: 'ok' } });
check('reviewer subadmin can approve', approve.status === 200 && approve.body.data.status === 'approved' && approve.body.data.reviewer, approve.body);
const editApproved = await call('PATCH', `/admin/marketing/content/${item._id}`, { token: sub, body: { body: 'changed' } });
check('approved content is frozen', editApproved.status === 409, editApproved.body);
const schedNoMedia = await call('POST', `/admin/marketing/content/${item._id}/schedule`, { token: sub, body: { scheduled_at: new Date(Date.now() + 3600000).toISOString() } });
check('instagram schedule needs media', schedNoMedia.status === 400, schedNoMedia.body);

const manual = await call('POST', '/admin/marketing/content', { token: sub, body: { channel: 'facebook', title: 'Weekend offer', body: 'Visit us this weekend' } });
check('manual content created as draft', manual.status === 201 && manual.body.data.status === 'draft' && manual.body.data.ai_generated === false, manual.body);
const M = manual.body.data._id;
await call('POST', `/admin/marketing/content/${M}/submit`, { token: sub });
const rootApprove = await call('POST', `/admin/marketing/content/${M}/approve`, { token: root });
check('superadmin can approve', rootApprove.body.data?.status === 'approved', rootApprove.body);
const sched = await call('POST', `/admin/marketing/content/${M}/schedule`, { token: sub, body: { scheduled_at: new Date(Date.now() + 3600000).toISOString() } });
check('schedule approved content', sched.status === 200 && sched.body.data.status === 'scheduled', sched.body);
const cal = await call('GET', '/admin/marketing/content/calendar', { token: sub });
check('calendar shows the scheduled post', Object.values(cal.body.data?.days || {}).flat().some((i) => i._id === M), cal.body);

console.log('publishing');
const pub = await call('POST', `/admin/marketing/content/${M}/publish`, { token: root });
check('publish now -> 503 META_PUBLISHING_NOT_CONFIGURED', pub.status === 503 && pub.body.details?.code === 'META_PUBLISHING_NOT_CONFIGURED', pub.body);
await ContentItem.updateOne({ _id: M }, { $set: { scheduled_at: new Date(Date.now() - 60000) } });
const job1 = await runPublishDue();
check('job with disabled publisher marks nothing', job1.skipped === 'publisher_disabled' && (await ContentItem.findById(M)).status === 'scheduled', job1);
const sent = [];
registerPublisher('fake', { name: 'fake', enabled: true, publishContent: async (it) => { sent.push(String(it._id)); return { external_id: 'post_1' }; }, publishCampaign: async () => ({ external_id: 'c1' }) });
process.env.MKT_PUBLISHER = 'fake';
const job2 = await runPublishDue();
const after = await ContentItem.findById(M);
check('job with an enabled publisher publishes due approved items once', job2.published === 1 && after.status === 'published' && after.publish.external_id === 'post_1' && sent.length === 1, { job2, status: after.status });
check('drafts never published by the job', !sent.includes(gen.body.data.items[1]._id));
delete process.env.MKT_PUBLISHER;

console.log('campaign drafts');
const camp = await call('POST', '/admin/marketing/campaigns/recommend', { token: sub, body: { goal: 'Get wholesale enquiries from shop owners', budget: { kind: 'daily', amount: 1000 }, product_ids: [String((await Product.findOne({ sku: 'RICE5' }))._id)] } });
const C = camp.body.data;
check('recommend -> draft with leads objective', camp.status === 201 && C.status === 'draft' && C.objective === 'OUTCOME_LEADS' && C.ai_generated, camp.body);
check('ad sets split + ads with copy variations', C?.ad_sets.length === 2 && C.ads.length === 2 && C.ads[0].headline && C.ads[0].variations.length === 2, C);
check('has recommendations', C?.recommendations.length >= 1);
const lowBudget = await call('POST', '/admin/marketing/campaigns/recommend', { token: sub, body: { goal: 'Diwali sale orders', budget: 100 } });
check('low budget warned, sales objective, one ad set', lowBudget.body.data?.objective === 'OUTCOME_SALES' && lowBudget.body.data.ad_sets.length === 1 && lowBudget.body.data.recommendations.some((r) => r.kind === 'budget' && r.severity === 'warning'), lowBudget.body);
const subCamp = await call('POST', `/admin/marketing/campaigns/${C._id}/approve`, { token: sub });
check('subadmin cannot approve campaign', subCamp.status === 403, subCamp.body);
const okCamp = await call('POST', `/admin/marketing/campaigns/${C._id}/approve`, { token: root });
check('superadmin approves campaign', okCamp.body.data?.status === 'approved', okCamp.body);
const pubCamp = await call('POST', `/admin/marketing/campaigns/${C._id}/publish`, { token: root });
check('campaign publish -> 503 not configured', pubCamp.status === 503 && pubCamp.body.details?.code === 'META_PUBLISHING_NOT_CONFIGURED', pubCamp.body);
const met = await call('POST', `/admin/marketing/campaigns/${C._id}/metrics`, { token: sub, body: { impressions: 5000, clicks: 20, spend: 900, leads: 0 } });
check('metrics -> low CTR suggestion', met.body.data?.performance_suggestions.some((s) => s.kind === 'creative' && s.severity === 'warning'), met.body);

console.log('insights');
const Lead = mongoose.models.Lead;
const Order = mongoose.models.CommerceOrder;
check('leads + commerce models registered by the app', !!Lead && !!Order);
const now = Date.now();
await Lead.collection.insertMany([
  { source: 'whatsapp', status: 'new', deletedAt: null, createdAt: new Date(now - 3 * 86400000) },
  { source: 'whatsapp', status: 'won', deletedAt: null, createdAt: new Date(now - 86400000) },
  { source: 'meta_ads', status: 'contacted', deletedAt: null, next_follow_up_at: new Date(now - 3600000), createdAt: new Date(now - 86400000) },
]);
const cust = new mongoose.Types.ObjectId();
const order = (o) => ({ number: `O${Math.random()}`, store_id: new mongoose.Types.ObjectId(), customer_id: cust, channel: 'app', status: 'delivered', items: [{ product_id: new mongoose.Types.ObjectId(), name: 'Basmati Rice 5kg', qty: 2, total: 1300 }], totals: { grand_total: 1300 }, createdAt: new Date(now - 86400000), ...o });
await Order.collection.insertMany([order({}), order({}), order({ status: 'cancelled' })]);
const sum = await call('GET', '/admin/marketing/insights/summary?days=30', { token: sub });
const d = sum.body.data;
check('summary: sales from commerce', sum.status === 200 && d.sales.available && d.sales.orders === 2 && d.sales.revenue === 2600 && d.sales.repeat_customers === 1, d?.sales);
check('summary: leads by status/source', d?.leads.available && d.leads.total === 3 && d.leads.by_source.whatsapp.leads === 2 && d.leads.overdue_follow_ups === 1 && d.leads.stale_new_leads === 1, d?.leads);
check('summary: follow-up suggestions', d?.suggestions.some((s) => s.kind === 'follow_up'), d?.suggestions);
const bare = await buildSummary({ days: 30, resolveModel: () => null });
check('summary works without commerce/leads models', bare.sales.available === false && bare.leads.available === false && Array.isArray(bare.suggestions));
const rep = await call('POST', '/admin/marketing/insights/summarize', { token: sub, body: { days: 30 } });
check('summarize -> draft report with narrative', rep.status === 201 && rep.body.data.status === 'draft' && rep.body.data.narrative.length > 0, rep.body);
const reps = await call('GET', '/admin/marketing/insights/reports', { token: sub });
check('reports listed', reps.body.data?.total === 1);
check('subadmin cannot approve report', (await call('POST', `/admin/marketing/insights/reports/${rep.body.data._id}/approve`, { token: sub })).status === 403);

console.log('provider guard rails');
const usage = await call('GET', '/admin/marketing/ai/usage', { token: sub });
check('usage logged by purpose', usage.status === 200 && usage.body.data.by_purpose.some((p) => p.purpose === 'content_generate') && usage.body.data.by_purpose.some((p) => p.purpose === 'kb_index'), usage.body);
const row = await AiUsage.findOne({ purpose: 'content_generate' }).lean();
check('usage row records actor, chars, tokens, null cost', row.triggered_by.kind === 'admin' && row.triggered_by.id && row.input_chars > 0 && row.input_tokens > 0 && row.cost_estimate === null, row);
const used = await AiUsage.countDocuments({ ok: true });
process.env.AI_DAILY_CALL_LIMIT = String(used + 1);
const g1 = await call('POST', '/admin/marketing/content/generate', { token: sub, body: { channel: 'facebook', theme: 'x', variations: 1 } });
const g2 = await call('POST', '/admin/marketing/content/generate', { token: sub, body: { channel: 'facebook', theme: 'y', variations: 1 } });
check('daily cap: last allowed call succeeds', g1.status === 201, g1.body);
check('daily cap: next call -> 429 AI_DAILY_LIMIT_REACHED', g2.status === 429 && g2.body.details?.code === 'AI_DAILY_LIMIT_REACHED', g2.body);
delete process.env.AI_DAILY_CALL_LIMIT;
process.env.AI_PROVIDER = 'disabled';
const dis = await call('POST', '/admin/marketing/content/generate', { token: sub, body: { channel: 'facebook', theme: 'z' } });
check('disabled provider -> 503 AI_PROVIDER_NOT_CONFIGURED', dis.status === 503 && dis.body.details?.code === 'AI_PROVIDER_NOT_CONFIGURED', dis.body);
const disKb = await call('POST', '/admin/marketing/kb/documents', { token: sub, body: { title: 'T', text: 'hello world' } });
check('ingest with disabled provider -> 503 and document marked failed', disKb.status === 503 && (await mongoose.models.KbDocument.findOne({ title: 'T' })).status === 'failed', disKb.body);
const ds = await call('GET', '/admin/marketing/status', { token: sub });
check('status reports provider not configured', ds.body.data.ai.configured === false);
delete process.env.AI_PROVIDER;

server.close();
await stop();
