# Commerce module

Single vendor, many stores. Retail orders come through the app. Staff enter wholesale and manual orders (WhatsApp, phone, POS, lead). Both kinds get GST invoices. The module also covers stock per store, staff roles scoped to stores, an activity log, franchise roll-up, and shipping (city delivery by the platform's own drivers, plus Shiprocket / BigShip).

## Wiring (outside this folder)

```js
// src/modules/platformRouter.js
import { commerceRouter } from './commerce/routes/index.js';
platformRouter.use(commerceRouter);

// server.js, after the DB connects
import { startCommerceJobs } from './src/modules/commerce/routes/index.js';
startCommerceJobs();
```

The router only claims `/commerce/*`, `/admin/commerce/*`, `/franchise/commerce/*` and `POST /webhooks/shipping/:provider`. Every other path calls `next()`.

## Money, GST, numbering

- Amounts are rupees stored as Numbers, rounded half-up to paise at each step. `round2` in `services/pricing.js` avoids float drift.
- `product.tax_inclusive` (default true) means the price already includes GST.
- Tax is CGST+SGST when the store's state (taken from its GSTIN, or failing that its address) matches the place of supply. Otherwise it is IGST. The place of supply is the ship-to state, else the buyer's GSTIN state (wholesale), else the store's state.
- The grand total is rounded to the rupee, and the difference is shown as `round_off`.
- Wholesale price: the highest `wholesale_tiers[].min_qty` that is <= the line qty. If no tier matches, the retail price applies. Staff-entered orders may override `unit_price` / `discount`.
- Order numbers look like `SO-<STORE>-<FY>-00001`, one series per store per Indian financial year. Invoice numbers look like `<5-char store prefix>/<FY>/00001`, at most 16 characters. Invoices are immutable snapshots, and the PDF is rendered on demand.

## Order flow

`placed → confirmed → packed → shipped → delivered`. Orders can also go `placed|confirmed|packed → cancelled` and `shipped|delivered → returned`. `packed → delivered` is allowed for counter pickup.

Stock moves with the order:

- Checkout reserves stock using a guarded `$inc`.
- `shipped`/`delivered` commits it: the units come off `qty_on_hand`.
- `cancelled` releases the reservation.
- `returned` puts the units back on the shelf.

Each of these steps first flips `stock_state` atomically, so retries cannot apply it twice. A cancel or return of a paid order sets `payment.status = refund_due` and opens a refund record (see Refunds).

Online orders cannot be confirmed until they are paid. Unpaid ones are cancelled after `COMMERCE_PAYMENT_TIMEOUT_MINUTES`.

## Refunds

`CommerceRefund` (`models/Refund.js`, `services/refundService.js`) records money owed back on an order: amount, reason, method (`original|cash|upi|bank_transfer|store_credit`), who requested / approved / rejected / paid it and when, and the payment reference.

- Status: `requested → approved → paid`, or `requested|approved → rejected` (a reason is required). Marking paid requires a `reference`.
- A cancel or return of an order with payments (and an online payment that lands after the order expired) creates a `requested` refund for the unrefunded balance automatically (`auto: true`; requested by whoever changed the status, or `system`).
- Admins can add refunds by hand, e.g. a partial refund on a delivered order. `amount` defaults to the refundable balance.
- Over-refund guard: `order.payment.refund_committed` is the sum of every refund that is not rejected. A refund is created only after a guarded update raises it, and that update refuses to go above `payment.paid_amount`, so concurrent requests cannot exceed what was paid. Rejecting gives the amount back.
- When a refund is paid, `payment.refunded_amount` grows and `payment.status` becomes `refunded` (refunded ≥ paid) or `partially_refunded`. A `partially_refunded` order no longer accepts `/payments`.
- Every step is written to the activity log (`refund.request|approve|reject|pay`).
- **Gateway refunds are not automated.** Nothing calls Razorpay's refund API: refund in the Razorpay dashboard (or pay by cash / UPI / bank) and record the refund id or UTR as the reference.

## Activity log

Rows carry `label`, a readable name for the entity (order number, `SKU · name`, store code, staff / customer name, invoice number, refund `order · amount`). Callers pass it when they already have it; otherwise `logActivity` looks it up off the request path. `GET /activity` fills in labels for older rows without one (one query per entity type) and also filters by `entity` / `entity_id`.

## Roles

| Permission | store_manager | sales_staff | billing_staff | admin (`commerce.view`) | franchise |
|---|---|---|---|---|---|
| catalog / stock view | ✓ | ✓ | catalog only | ✓ | stock (own stores) |
| stock adjust / transfer / reorder level | ✓ | | | ✓ | |
| customers view / manage | ✓ | ✓ | view | ✓ | |
| orders view / create | ✓ | ✓ | view | ✓ | view |
| order status → | any | confirmed only | — | any | — |
| invoices issue / view, record payments | ✓ | | ✓ | ✓ | view |
| shipments (rates, book, cancel, local status) | ✓ | | view | ✓ | |
| activity feed, store sales report | ✓ | | | ✓ (all reports) | sales / top / low-stock |

- Staff only ever see their `store_ids`. Every query adds this filter on the server (`services/accessService.js`).
- Only managers can set a customer's `credit_limit`.
- Customers are shared across stores. Staff see customers whose `home_store_id` is one of their stores, and customers with no home store.
- Franchises see the stores where `franchise_id` is their own. Orders carry the `franchise_id` the store had when the order was placed.

## Endpoints (prefix `/api` or `/api/v1`)

**Public / app customer** (`authenticate(['user'])` except the catalogue)
`GET /commerce/stores`, `GET /commerce/categories`, `GET /commerce/products?store_id&search&category_id&in_stock=1`, `GET /commerce/products/:idOrSlug`,
`GET /commerce/me`, `POST /commerce/me/addresses`, `DELETE /commerce/me/addresses/:addressId`,
`GET|PUT /commerce/cart` (`{store_id, items:[{product_id, qty}]}`),
`POST /commerce/checkout` (`{store_id?, items?, fulfilment: delivery|pickup, address_id|ship_to, payment_method: cash|online}`; online returns `payment: {key_id, razorpay_order_id, amount}`),
`POST /commerce/orders/:id/pay`, `POST /commerce/orders/:id/verify-payment` (`razorpay_order_id, razorpay_payment_id, razorpay_signature`),
`GET /commerce/orders`, `GET /commerce/orders/:id`, `POST /commerce/orders/:id/cancel` (only while placed), `GET /commerce/orders/:id/invoice` (PDF).

**Staff** (`/commerce/staff`, Bearer token from login; role `commerce_staff`)
`POST /auth/login` `{mobile|email, password}`, `GET /me`, `POST /me/password`, `GET /stores`, `GET /products`,
`GET /inventory`, `GET /inventory/movements`, `POST /inventory/adjust {store_id, product_id, delta, reason}`, `POST /inventory/transfer {from_store_id, to_store_id, product_id, qty}`, `POST /inventory/reorder-level`,
`GET|POST /customers`, `GET|PATCH /customers/:id` (adds `summary` and `recent_orders`), `GET /customers/:id/orders`,
`GET /orders`, `POST /orders` (manual entry: `{store_id, customer_id, items:[{product_id, qty, unit_price?, discount?}], type, channel: whatsapp|phone|pos|lead, fulfilment, ship_to|address_id, payment_method: cash|credit, shipping, due_date}`; starts as `confirmed`),
`GET /orders/:id`, `POST /orders/:id/status {status, note}`, `POST /orders/:id/payments {amount, method, reference}`, `POST /orders/:id/invoice`,
`POST /orders/:id/shipping-rates {provider?, package?}`, `POST /orders/:id/shipments {provider, courier_id?, package?}`,
`GET /invoices`, `GET /invoices/:id/pdf`, `GET /shipments`, `GET /shipments/:id`, `POST /shipments/:id/refresh|cancel`, `POST /shipments/:id/status` (local_porter only),
`GET /activity`, `GET /reports/sales`, `GET /reports/low-stock`.

**Admin** (`/admin/commerce`, `adminGuard('commerce.view')`)
- stores: `GET|POST /stores`, `GET|PATCH|DELETE /stores/:id`, `POST /stores/:id/franchise {franchise_id|null}`
- categories: `GET|POST /categories`, `PATCH|DELETE /categories/:id`
- products: `GET|POST /products`, `GET|PATCH|DELETE /products/:id`
- inventory: `GET /inventory`, `GET /inventory/movements`, `POST /inventory/adjust|transfer|reorder-level`
- staff: `GET|POST /staff`, `PATCH|DELETE /staff/:id`
- customers, orders, invoices and shipments: the same routes as the staff panel, across all stores
- customer history: `GET /customers/:id` returns the customer plus `summary` (`orders, billed_orders, billed, paid, outstanding, credit_due, refund_due, refunded, last_order_at, credit_limit`; cancelled / returned orders are not billed) and the latest `recent_orders` (`?orders_limit`, default 10). `GET /customers/:id/orders?page&limit&status&payment_status` pages them. On the staff panel both only count orders in the caller's stores.
- refunds: `GET /refunds?status&store_id&order_id&customer_id&franchise_id&from&to&search` (paged, plus `summary` per status), `GET /refunds/:id`, `POST /refunds/:id/approve`, `POST /refunds/:id/reject {reason}`, `POST /refunds/:id/pay {reference, method?, notes?}`, `GET|POST /orders/:id/refunds {amount?, reason, method, notes}`. `GET /orders/:id` includes `refunds`.
- reports: `GET /reports/sales?group=day|store|franchise|channel|type&from&to&store_id&franchise_id`, `/reports/top-products`, `/reports/low-stock`, `/reports/staff?from&to&store_id&franchise_id`. On every report `franchise_id` matches the order's `franchise_id` (the store's franchise when the order was placed), not the store's current franchise.
- activity log: `GET /activity`

**Franchise** (`/franchise/commerce`, `authenticate(['franchise'])`, business_type commerce|both)
`GET /stores`, `/orders`, `/orders/:id`, `/invoices`, `/invoices/:id/pdf`, `/inventory`, `/reports/sales|top-products|low-stock`.

**Webhooks**: `POST /webhooks/shipping/:provider` (`shiprocket|bigship|local_porter`). The header `x-webhook-secret` (or `x-api-key`) must equal `SHIPPING_WEBHOOK_SECRET`. Unknown AWBs get a 200 response with `{matched:false}`.

## Events (`shared/events.js`)

- `commerce.order.created {order}`
- `commerce.order.status_changed {order, from, to}`
- `commerce.shipment.updated {shipment, order}`
- `commerce.cart.abandoned {cart, customer}`: sent once per idle spell. It is sent again only after the cart changes.

## Shipping adapters (`shipping/`)

Every adapter has the same contract: `{ name, isEnabled(), quoteRates(draft), createShipment(order, draft), track(awb), cancel(shipment|awb), parseWebhook(req) }`. A provider whose env vars are missing answers with a 503 and `code: SHIPPING_PROVIDER_DISABLED`.

- **local_porter**: city delivery by the platform's own parcel drivers. With `COMMERCE_LOCAL_VEHICLE_TYPE_ID` set, booking creates a real parcel ride (priced, zoned and dispatched like an app parcel; booked by a per-store account; store pays the fare in cash; a COD amount goes into the driver instructions). Ride progress updates the shipment and order: see `src/modules/integrations/commerceCityDelivery.js`. Store and delivery address need lat/lng. Without the env var, shipments stay `pending_assignment` and staff move them with `/shipments/:id/status`.
- **shiprocket**: implements `auth/login` (token cached 9 days, re-login on 401), `courier/serviceability`, `orders/create/adhoc`, `courier/assign/awb`, `courier/track/awb/{awb}` and `orders/cancel`.
- **bigship**: a skeleton. Every `TODO(bigship)` must be checked against BigShip's merchant API docs.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` | – | enable Shiprocket (API user) |
| `SHIPROCKET_PICKUP_LOCATION` | `Primary` | default pickup nickname (per store: `store.shiprocket_pickup`) |
| `SHIPROCKET_BASE_URL` | `https://apiv2.shiprocket.in/v1/external` | |
| `BIGSHIP_BASE_URL`, `BIGSHIP_USERNAME`, `BIGSHIP_PASSWORD`, `BIGSHIP_ACCESS_KEY` | – | enable BigShip |
| `BIGSHIP_WAREHOUSE_ID` | – | BigShip pickup warehouse |
| `COMMERCE_LOCAL_DELIVERY` | `on` | `off` disables local_porter |
| `COMMERCE_LOCAL_BASE_FARE`, `COMMERCE_LOCAL_PER_KM`, `COMMERCE_LOCAL_MAX_KM` | 40 / 10 / 30 | city delivery quote |
| `SHIPPING_WEBHOOK_SECRET` | – | required for webhooks (rejected when unset) |
| `COMMERCE_SHIPPING_TIMEOUT_MS` | 15000 | provider HTTP timeout |
| `COMMERCE_PAYMENT_TIMEOUT_MINUTES` | 30 | cancel unpaid online orders |
| `COMMERCE_ABANDONED_CART_MINUTES` | 60 | abandoned-cart threshold |
| `COMMERCE_TRACKING_POLL_MINUTES` | 30 | min interval between tracking polls per shipment |
| `COMMERCE_JOBS_INTERVAL_MS` | 60000 | job loop interval |
| `COMMERCE_LEGAL_NAME` | store name | seller legal name on invoices |

Razorpay keys come from the existing Admin > Payment Gateways setting (`resolveConfiguredGatewayCredentials('razor_pay')`). They are not env vars.
