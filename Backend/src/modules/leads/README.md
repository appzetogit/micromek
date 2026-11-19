# Leads & WhatsApp Business module

WhatsApp Cloud API integration, Meta Lead Ads intake and a lead / order-enquiry
desk for Super Admins and Sub Admins.

## Wiring (outside this folder)

1. **app.js - keep the raw body** (required for webhook signatures):
   ```js
   app.use(express.json({ limit: '25mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
   ```
   Without it, `POST /webhooks/*` answers `400 RAW_BODY_MISSING`.
2. **platformRouter.js**: `import { leadsRouter } from './leads/routes/index.js'; platformRouter.use(leadsRouter);`
   The router claims only `/webhooks/whatsapp`, `/webhooks/meta/leads`, `/admin/leads*` and `/admin/whatsapp*`; everything else goes to `next()`.
3. **server start-up** (after Mongo connects):
   ```js
   import { registerLeadEventListeners, startLeadJobs } from './src/modules/leads/index.js';
   registerLeadEventListeners();
   startLeadJobs();
   ```

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN` | - | Both required to send. Missing means admin sends get `503 WHATSAPP_DISABLED` and automated sends are logged and skipped |
| `WA_BUSINESS_ACCOUNT_ID` | - | WABA id, used by template sync |
| `WA_APP_SECRET` | - | HMAC secret for `X-Hub-Signature-256`. If it is missing, webhooks answer 503 |
| `WA_VERIFY_TOKEN` | - | GET webhook verification token |
| `WA_GRAPH_VERSION` | `v21.0` | Graph API version |
| `WA_HTTP_TIMEOUT_MS` | `15000` | Graph request timeout |
| `WA_DEFAULT_COUNTRY_CODE` | `91` | Prefixed to 10-digit national numbers |
| `WA_TPL_LANG` | `en` | Default template language |
| `WA_TPL_ORDER_CONFIRMED`, `WA_TPL_ORDER_SHIPPED`, `WA_TPL_ORDER_DELIVERED`, `WA_TPL_CART_REMINDER`, `WA_TPL_PAYMENT_REMINDER` | - | Template names. If one is unset, that notification is off |
| `<TPL_VAR>_PARAMS` | see below | Comma list of context keys for body `{{1}}..{{n}}` (empty = none) |
| `<TPL_VAR>_LANG` | `WA_TPL_LANG` | Per-template language |
| `WA_CURRENCY_PREFIX` | `₹` | Prefix for amounts in templates |
| `WA_REQUIRE_OPT_IN` | `false` | If true, automated templates go only to contacts who explicitly opted in |
| `WA_OPT_OUT_REPLY` | - | Optional text reply sent after STOP |
| `WA_BOT_ENABLED` | `false` | New conversations start in `bot` status (calls `autoReply`) |
| `WA_BROADCAST_BATCH` / `WA_BROADCAST_DELAY_MS` / `WA_BROADCAST_MAX_RECIPIENTS` | `50` / `250` / `10000` | Throttling: number of sends per broadcast per job tick, delay between sends, cap on recipients |
| `META_PAGE_ACCESS_TOKEN` | - | Fetches Lead Ads details (`GET /{leadgen_id}`) |
| `META_APP_SECRET`, `META_VERIFY_TOKEN` | WA_* values | Override for the Lead Ads webhook |
| `LEADS_AUTO_ASSIGN` | `round_robin` | `round_robin`, `least_loaded` or `none` |
| `LEADS_JOB_INTERVAL_MS` | `60000` | Job loop period |
| `LEADS_REMINDER_LEAD_MINUTES` | `15` | How far ahead to emit `leads.follow_up.due` |

Default template params: confirmed `name,number,total`; shipped `name,number,awb,tracking_url`;
delivered `name,number`; cart reminder `name`; payment reminder `name,number,total`.
Context keys available: `name, number, total, status, order_id, phone, awb, tracking_url, courier`.

## Events consumed (commerce must provide these fields)

All payloads may be plain objects or mongoose docs (`toObject()` is called when present).

| Event | Fields read |
| --- | --- |
| `commerce.order.created { order }` | `order._id` (or `id`), `order.number` (or `order_number`), `order.status`, `order.grand_total` → `order.total` → `order.totals.grand_total`, phone: `order.customer.phone` → `order.shipping_address.phone` → `order.customer_phone`, name: `order.customer.name` → `order.shipping_address.name` → `order.customer_name` |
| `commerce.order.status_changed { order, from, to }` | same order fields, plus `to` (falls back to `order.status`) |
| `commerce.shipment.updated { shipment, order }` | `shipment.status`, `shipment.awb` (or `awb_code`), `shipment.tracking_url`, `shipment.courier` (or `courier_name`); order fields as above (`order` falls back to `shipment.order`) |
| `commerce.cart.abandoned { cart, customer }` | `cart._id`, `cart.total` (or `subtotal`), phone `customer.phone` → `cart.phone` → `cart.customer_phone`, `customer.name` |

Status mapping (case-insensitive; spaces and hyphens become `_`):
- confirmed: `confirmed, placed, paid, processing, accepted`
- payment reminder: `pending_payment, payment_pending, awaiting_payment, unpaid`
- shipped: `shipped, dispatched, in_transit, picked_up, out_for_delivery`
- delivered: `delivered, completed`

`order.created` sends the payment reminder if the order status is payment-pending, otherwise the confirmation.
Each (order, template) pair is sent at most once (`WaMessage.dedupe_key`). Cart reminders go out at most once per cart per day.
An open lead with the same phone is linked to the order (`order_id`, `order_number`, `type: order`).

Events emitted: `leads.follow_up.due { followUp, lead }` and `leads.follow_up.overdue { followUp, lead }`.

## Endpoints (under `/api` and `/api/v1`)

Webhooks (public):
- `GET /webhooks/whatsapp`, `POST /webhooks/whatsapp`: Cloud API messages (text, interactive, button, location, media metadata, ...) and statuses (sent, delivered, read, failed). Idempotent on the message id.
- `GET /webhooks/meta/leads`, `POST /webhooks/meta/leads`: object `page`, field `leadgen`. Creates a Lead (`meta_ads`), idempotent on `leadgen_id`.

Admin (`adminGuard('leads.view')`). Sub admins only see leads, conversations, follow-ups and broadcasts that are assigned to them or that they created:
- `GET /admin/leads`: filters `status, source, type, tags, assigned_to (id|me|unassigned), from, to, search, overdue=true, store_id, franchise_id, campaign_id`, `sort=newest|oldest|follow_up|value|updated`
- `POST /admin/leads`: manual lead. Returns 409 `LEAD_EXISTS` if an open lead has the same phone, unless `allow_duplicate`. Optional `follow_up_at`
- `GET /admin/leads/stats?from&to`: counts by source, status, assignee and type; conversion rate; response time; follow-up counts
- `GET /admin/leads/meta`, `GET /admin/leads/assignees`
- `GET /admin/leads/follow-ups?due=overdue|today|upcoming&status=`
- `POST /admin/leads/bulk-assign {lead_ids, admin_id}`
- `GET|PATCH|DELETE /admin/leads/:id` (delete is a soft delete and needs a super admin)
- `POST /admin/leads/:id/assign {admin_id|null}`, `POST /admin/leads/:id/status {status, reason, note}` (`reason` is required for `lost`)
- `POST /admin/leads/:id/activities {type: note|call|email|whatsapp|meeting|visit, note}`
- `GET|POST /admin/leads/:id/follow-ups`, `PATCH|DELETE /admin/leads/:id/follow-ups/:followUpId` (PATCH with `{done:true, outcome}` completes it)
- `GET /admin/whatsapp/status[?probe=true]`
- `GET /admin/whatsapp/conversations?status&assigned_to&unread&search`, `GET /admin/whatsapp/conversations/:id`
- `GET /admin/whatsapp/conversations/:id/messages?before&limit`: also marks the conversation read
- `POST /admin/whatsapp/conversations/:id/messages {text}` or `{template:{name,language,components}}`. Text outside the 24h window returns 409 `OUTSIDE_SERVICE_WINDOW`
- `POST /admin/whatsapp/conversations/:id/(handover|bot|close|reopen)`. `handover` takes an optional `admin_id`
- `PATCH /admin/whatsapp/contacts/:id {name, opt_in_status}`
- `GET /admin/whatsapp/templates?status=APPROVED|all`, `POST /admin/whatsapp/templates/sync`
- `GET|POST /admin/whatsapp/broadcasts`, `GET|PATCH|DELETE /admin/whatsapp/broadcasts/:id`, `POST /admin/whatsapp/broadcasts/:id/(approve|run|cancel)`

Broadcast flow: create (`draft`), then a super admin approves it (the template must be synced and APPROVED), then it is scheduled for `scheduled_at` or started with `run`. Status goes `running` → `done`. Editing a broadcast sends it back to draft. Audience is either `{type:'phones', phones}` or `{type:'lead_filter', lead_filter:{status,source,type,tags,assigned_to,created_from,created_to}}`. Recipients who opted out are skipped. `{{name}}` inside a text parameter is replaced with each recipient's name.

## Behaviour notes

- An inbound message from a number creates or updates the WaContact and the open WaConversation. If that phone has no open lead, it also creates a Lead (source `whatsapp`, or `meta_ads` for click-to-WhatsApp ad referrals) and auto-assigns it.
- STOP / STOP ALL / UNSUBSCRIBE / OPT OUT, sent as the whole message, mark the contact `opted_out`. START / SUBSCRIBE opt the contact back in.
- AI hook: `services/chatbot.js#autoReply(conversation, message)` returns `null` for now. It is only called for conversations in `bot` status, and returning `null` hands the conversation to staff (`open`).
- Jobs (`startLeadJobs`): an unref'd `setInterval` whose ticks never overlap and are skipped while Mongo is disconnected. Each tick sends one throttled batch per due broadcast (each broadcast is locked while a batch runs, so this is safe across instances), marks overdue follow-ups and emits reminders.
