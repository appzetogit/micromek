# Marketing & AI module

This module is the groundwork for the AI knowledge base, the WhatsApp bot answers, social content, Meta Ads campaign drafts and marketing insights.
**No AI provider and no Meta publishing are connected yet.** Everything sits behind two interfaces: `providers/` (AI) and `publishers/` (Meta). A person has to review and approve all AI output before anyone uses it.

## What works now

| Area | Status |
| --- | --- |
| AI provider interface (`generateText`, `embed`) | `disabled` provider (503 `AI_PROVIDER_NOT_CONFIGURED`) and a deterministic `mock` provider (templated text, hashed bag-of-words embeddings) |
| Usage log + daily cap | Every call writes an `AiUsage` row with provider, model, purpose, who triggered it, chars, tokens (estimated as chars/4 unless the provider reports them), `cost_estimate: null`, ok/error and duration. `AI_DAILY_CALL_LIMIT` returns 429 `AI_DAILY_LIMIT_REACHED` |
| Knowledge base | Ingests text, markdown, FAQ JSON pairs and PDF text extracted on the client. Chunks are ~800 chars with 150 chars of overlap; each FAQ pair is its own chunk. Embeds through the provider and retrieves by cosine similarity in JS. `answer` returns an answer with cited chunk ids, or the fallback text plus `needs_human: true`. Also covers product sync from `CommerceProduct` (read-only) and product recommendations |
| Content | `MktContentItem` CRUD and a content calendar. AI generation makes **drafts only**. Workflow: draft → in_review → approved → scheduled → published, or rejected |
| Campaigns | `MktAdCampaignDraft` CRUD. `recommend` picks the objective, budget split, ad sets and ads with copy variations, and adds rule-based recommendations. You can enter metrics by hand to get improvement suggestions. Workflow: draft → approved → published (placeholder), or rejected |
| Publishing | `disabled` publisher only: publish calls return 503 `META_PUBLISHING_NOT_CONFIGURED`. The job publishes nothing and logs once |
| Insights | A plain-data summary of sales (if `CommerceOrder` is registered), leads (if `Lead` is registered), content and campaigns, with rule-based follow-up and segment suggestions. `summarize` stores an AI narrative as a **draft** `MktInsightReport` |

### Limits
- Retrieval loads up to `KB_MAX_SCAN_CHUNKS` embeddings into memory for each question. That is fine for a few hundred documents. For more, replace `retrieve()` in `services/kbService.js` with Atlas `$vectorSearch` or another vector index.
- Each chunk stores `embedding_model` (`provider:model`), and retrieval only uses chunks from the current model. After switching providers, call `POST .../kb/documents/:id/reindex` on each document, and `sync-products` again.
- The daily cap counts and then calls, which is not atomic, so it can overshoot by a few calls under concurrency. The day is a UTC day.
- The request body limit is set by `express.json` in app.js. Large text extracted from PDFs needs a body limit of a few MB.

## Access
- Every route uses `adminGuard('marketing.view')`.
- To approve or reject content, campaigns or insight reports you must be a **super admin**, or a sub admin with the **`marketing.approve`** permission (or `*`). Otherwise the action returns 403 `REVIEWER_REQUIRED`. This mirrors `leads/services/access.js`.
- Editing or deleting is allowed only in `draft` / `rejected`. Approved items are frozen, so nothing can skip review.

## Routes (under `/api` and `/api/v1`)
```
GET    /admin/marketing/status                     provider, publisher, KB settings, can_review
GET    /admin/marketing/ai/usage?days=7
GET|POST /admin/marketing/kb/documents             list | ingest {title, source_type, format: text|markdown|faq_json|pdf, text, faqs, tags}
GET|PATCH|DELETE /admin/marketing/kb/documents/:id ?include=chunks ; PATCH {title,tags,active,source_type,text|faqs}
POST   /admin/marketing/kb/documents/:id/reindex
POST   /admin/marketing/kb/sync-products
POST   /admin/marketing/kb/answer                  {question, k?}
POST   /admin/marketing/kb/recommend               {query, k?}
GET|POST /admin/marketing/content                  ?status,channel,kind,q,batch_id
GET    /admin/marketing/content/calendar?from&to
POST   /admin/marketing/content/generate           {channel, theme, tone?, variations?, product_id?, kind?, instructions?}
GET|PATCH|DELETE /admin/marketing/content/:id
POST   /admin/marketing/content/:id/(submit|approve|reject|schedule|unschedule)   {notes?, scheduled_at?}
POST   /admin/marketing/content/:id/publish
GET|POST /admin/marketing/campaigns
POST   /admin/marketing/campaigns/recommend        {goal, budget: number | {kind, amount}, product_ids?, audience?, objective?, start_at?, end_at?}
GET|PATCH|DELETE /admin/marketing/campaigns/:id
POST   /admin/marketing/campaigns/:id/(approve|reject|reopen)
POST   /admin/marketing/campaigns/:id/metrics      {impressions, clicks, spend, leads, purchases, revenue}
POST   /admin/marketing/campaigns/:id/publish
GET    /admin/marketing/insights/summary?days=30
POST   /admin/marketing/insights/summarize         {days}
GET    /admin/marketing/insights/reports[/:id]
POST   /admin/marketing/insights/reports/:id/(approve|reject)
```

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `disabled` in production, `mock` otherwise | Name of the registered provider to use. An unknown name falls back to `disabled`, with a warning |
| `AI_DAILY_CALL_LIMIT` | `500` | Successful AI calls per UTC day. An embedding batch counts as one call. `0` means unlimited |
| `KB_MIN_SCORE` | `0.15` | Cosine score below which `answer` falls back. This suits the mock provider; tune it for a real one (often 0.3-0.5) |
| `KB_TOP_K` | `4` | Chunks retrieved per question |
| `KB_MAX_SCAN_CHUNKS` | `5000` | Upper bound of chunks scored in memory |
| `KB_FALLBACK_ANSWER` | polite "team will get back to you" text | Answer sent when the KB lacks the info |
| `KB_MAX_DOCUMENT_CHARS` | `500000` | Size cap for one document |
| `KB_PRODUCT_SYNC_LIMIT` | `2000` | Max active products synced |
| `MKT_PUBLISHER` | `disabled` | Name of the registered publisher to use |
| `MKT_PUBLISH_INTERVAL_MS` | `60000` | Publish job tick |
| `MKT_PUBLISH_MAX_ATTEMPTS` | `3` | Retries per scheduled item |
| `MKT_MIN_DAILY_BUDGET` | `300` | Daily budget (INR) below which campaigns get a warning; at 2x or more the draft splits into a second, retargeting ad set |
| `MKT_WA_BOT_AUTO_REPLY` | `false` | Lets `whatsappAutoReply` send KB answers. When off, it always hands over to staff |

## Switching on a real AI provider
1. Create `providers/<name>.js` that exports an object `{ name, configured: true, model, embeddingModel, generateText({ system, prompt, maxTokens }) => { text, model?, usage?: { input_tokens, output_tokens }, cost_estimate? }, embed(texts) => { vectors, model?, usage? } }`. Use `fetch` and the vendor's HTTP API; no new dependency is needed. Read the API key from env, and set `configured` to false if the key is missing.
2. Register it in `providers/index.js` (add it to the `registry` map) or call `registerAiProvider('<name>', impl)` at start-up.
3. Set `AI_PROVIDER=<name>` and the vendor key env, then reindex every KB document and run `sync-products`.
4. Tune `KB_MIN_SCORE` and `AI_DAILY_CALL_LIMIT`. Fill in `cost_estimate` from the vendor's prices.
5. Optional: server-side PDF extraction. Implement `extractPdfText()` in `kb/extractors.js` (the marked hook) with a PDF parser.

## Switching on Meta publishing
1. Prerequisites: a Meta app with `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `ads_management` (after App Review). You also need a Page access token, the Instagram Business account id and an ad account id (`act_...`).
2. Create `publishers/meta.js`: `{ name: 'meta', enabled: true, publishContent(item), publishCampaign(draft) }`.
   - Facebook: `POST /{page_id}/feed` (`message`, `link`) or `/{page_id}/photos`.
   - Instagram: `POST /{ig_user_id}/media` then `/{ig_user_id}/media_publish`. This needs a public `media_urls[0]`.
   - Ads: campaign → ad sets → ad creatives → ads, created `PAUSED` first. Return `{ external_id, permalink?, raw? }`.
   - WhatsApp broadcast items can be handed to the leads module's broadcast service.
3. `registerPublisher('meta', impl)` at start-up and set `MKT_PUBLISHER=meta`. The job then publishes `scheduled` items whose `scheduled_at` is due (they must have been approved first), claiming each one with a lock so it is never published twice.

## Wiring (outside this folder)
1. `src/modules/platformRouter.js`:
   ```js
   import { marketingRouter } from './marketing/routes/index.js';
   platformRouter.use(marketingRouter);
   ```
2. `src/modules/platformJobs.js`, inside `startPlatformJobs()`:
   ```js
   import { startMarketingJobs, stopMarketingJobs } from './marketing/index.js';
   registerLeaderJob('marketing-publish', startMarketingJobs, stopMarketingJobs);
   ```
3. `src/modules/taxi/admin/services/adminAccessService.js` → add `'marketing.view'` and `'marketing.approve'` to `ADMIN_PERMISSIONS`. Add both to the frontend sub-admin permission picker too.
4. Optional, for the WhatsApp bot: in `leads/services/chatbot.js`, `export { whatsappAutoReply as autoReply } from '../../marketing/services/chatbotBridge.js';` (plus `WA_BOT_ENABLED=true`, `MKT_WA_BOT_AUTO_REPLY=true`). Weak answers return `{ text: fallback, handover: true }`.

## Tests
`node test/marketing.test.mjs` (from `Backend/`).
