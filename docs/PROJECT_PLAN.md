# Project Plan — Taxi, Porter, EV Monitoring, E-commerce & Franchise Platform

Source: client scope of work (Budgetaddaa / Appzeto). Base: the existing ZI CAB codebase in this folder.
Status: draft for review, 2026-11-19. All durations are estimates for planning, not commitments.

---

## 1. Scope in one page

| # | Module | Deliverable in the SOW |
|---|---|---|
| A | Customer app | Android + iOS (Flutter): OTP login, taxi and porter booking, fares, live tracking, payments, history and invoices, ratings, support |
| B | Driver app | Android (Flutter; the SOW lists only Android for the driver): docs, vehicle verification, online/offline, accept jobs, navigation, trip flow, earnings, payouts |
| C | EV fleet monitoring | Telematics API: GPS, battery SOC/SOH, charging, range, trips, low-battery alerts, utilisation reports |
| D | Franchise system | Onboarding and approval, city/area allocation, franchise dashboard, per-franchise fare and commission, settlements, performance |
| E | Admin panel | React: management of everything above, plus RBAC, reports, complaints, notifications |
| F | E-commerce | Single vendor, multi-store, retail and wholesale, invoices, inventory, store roles, Porter, Shiprocket and BigShip delivery, franchise stores |
| G | WhatsApp and leads | WhatsApp Business API, Meta ad leads, lead assignment and follow-up |
| H | AI and marketing (additional scope) | WhatsApp AI chatbot, knowledge-base assistant, social auto-posting, ad creative generator, Meta Ads assistant, marketing insights |

Stack required by the SOW: **Flutter** (mobile), **Node.js** (backend), **React** (admin), **PostgreSQL/MongoDB**, Google Maps, Razorpay, third-party EV APIs.

---

## 2. What already exists (gap analysis)

The ZI CAB repo already covers most of modules A, B and E, but as **web** apps. It has no Flutter or native code.

| Area | Status | Notes |
|---|---|---|
| Customer flows (OTP, addresses, taxi, parcel/porter, fare estimate, tracking, Razorpay/PhonePe/cash, invoice PDF, ratings, support) | ✅ Built (web) | `Ride`, `Delivery`, `GoodsType`, `SetPrice`, Socket.IO tracking, `invoiceService.js` |
| Driver flows (registration and docs, vehicle verification, online/offline, accept rides and deliveries, OTP trip start, wallet, withdrawals, earnings) | ✅ Built (web) | Navigation is limited to maps links. There is no in-app turn-by-turn |
| Admin (users, drivers, vehicle types, fares, surge, zones, payments, reports, notifications, tickets, roles/permissions) | ✅ Built | `AdminRole.permissions[]`, `adminAccessService.js` |
| Franchise | 🟡 Partial | `Owner` (fleet owner), `FleetVehicle`, `OwnerWalletTransaction` and an owner dashboard exist. Missing: the franchise entity, territory ownership, per-franchise commission, settlement cycles and a franchise-scoped admin login |
| EV monitoring | ❌ Missing | Nothing built |
| E-commerce | ❌ Mostly missing | The `Dhaba` food-ordering module (menu, orders, payouts) is a useful pattern, but there are no products, stores, inventory, cart or wholesale |
| WhatsApp, Shiprocket, BigShip, Meta, AI | ❌ Missing | |
| Extras beyond the SOW | ✅ Built | Bus (ZI Bus), rentals, outstation, pooling, promos, referrals, subscriptions, heatmap, safety center |

**Takeaway:** the backend and admin are reusable. The new work is the Flutter apps, the franchise layer, EV monitoring, the e-commerce suite, the WhatsApp and lead pipeline, and the AI modules.

---

## 3. Decisions needed before development

1. **Mobile approach.** The SOW says Flutter, and the current customer and driver apps are React web.
   - *Option 1 (matches the SOW):* build new Flutter customer and driver apps against the existing REST and Socket.IO API. **Recommended.** It is what the contract says, and it gives proper background location, push and store presence.
   - *Option 2:* wrap the existing React apps with Capacitor. This is faster, but it does not meet "Flutter" and background tracking for drivers is weaker.
2. **Database.** Keep **MongoDB**, which the SOW allows. Add a time-series collection for EV telemetry instead of introducing PostgreSQL.
3. **EV telematics provider.** The client must name the provider (or OEM) and supply API docs. The whole of module C is blocked on this.
4. **"Porter" for e-commerce city delivery.** This could mean our own porter module (reuse `Delivery`) or Porter.in's API. We assume our own module unless the client says otherwise.
5. **Driver app on iOS.** The SOW lists only Android. Confirm with the client. Flutter makes adding iOS cheap.
6. **AI provider.** This is needed for module H (chatbot, RAG, content). Usage is billed to the client.
7. **Version control.** `.git` was removed from this folder. Decide on a fresh `git init` and a new private repo before work starts (this is required by the SOW's confidentiality clause).

---

## 4. Target architecture

```
Flutter Customer app ─┐
Flutter Driver app  ──┼──► Node/Express API (existing) ──► MongoDB (+ time-series telemetry)
React Admin panel  ───┤        │  Socket.IO (tracking, offers)     Redis (cache, rate limit, socket adapter)
React Franchise panel ┘        │
                               ├── Workers / schedulers (new): EV telemetry poller, alerts,
                               │   settlement cycles, shipment status sync, WhatsApp/AI jobs
                               └── Integration adapters (new, one interface per kind):
                                   EvTelematicsProvider · ShippingProvider (Shiprocket, BigShip, Porter)
                                   MessagingProvider (WhatsApp BSP, SMS) · MetaGraph · AiProvider
```

Principles:
- **Adapters behind interfaces.** EV, shipping and WhatsApp providers are client-chosen and can change, so each gets a single interface plus one implementation per provider.
- **Franchise scoping everywhere.** Add `franchise_id` to drivers, vehicles, rides, deliveries, stores and orders. Middleware restricts a franchise user to their own records. This extends the existing RBAC rather than replacing it.
- **E-commerce as a new backend module** (`Backend/src/modules/commerce`), sharing auth, payments, invoices and notifications with taxi.

---

## 5. Phases and milestones

| Phase | Work | Est. | Depends on |
|---|---|---|---|
| **0. Inception** | Sign off on the decisions in §3, collect credentials (§6), wireframes for the Flutter apps, franchise panel and commerce, set up the repo and CI | 1–2 wk | Client |
| **1. Franchise layer** | `Franchise` model (extend or migrate from `Owner`), approval flow, city/zone territory allocation, scoped franchise login and panel, per-franchise fare and commission overrides, settlement cycles and statements, performance reports | 3–4 wk | — |
| **2. Flutter apps** | Customer app (Android and iOS) and driver app (Android) on the existing API: OTP, booking, porter, tracking, Razorpay SDK, FCM, background location, in-app navigation, wallet and earnings. Release to beta tracks | 8–10 wk (parallel team) | Phase 0 designs |
| **3. EV monitoring** | `EvTelematicsProvider` adapter, telemetry ingestion (poll or webhook) into time-series storage, live map, SOC, charging, range and odometer, low-battery and offline alerts (push and admin), trip history, utilisation reports, franchise-scoped view | 3–4 wk | Provider API access |
| **4. E-commerce core** | Stores, catalogue, variants, inventory per store, retail and wholesale price lists, cart and checkout, manual wholesale order entry, GST invoices, store roles (Store Manager, Sales, Billing), franchise store allocation and reporting | 6–8 wk | — |
| **5. Logistics** | `ShippingProvider` adapter: Shiprocket and BigShip (rates, booking, AWB, tracking webhooks), city delivery via the porter module, shipment status in admin and customer views | 2–3 wk | Phase 4 + credentials |
| **6. WhatsApp and leads** | WhatsApp Cloud API/BSP integration, inbound orders and enquiries, Meta Lead Ads webhook, lead inbox, assignment, follow-ups, status tracking, template order and shipping notifications | 3 wk | BSP account, Meta app review |
| **7. AI and marketing** (additional scope) | Knowledge base (upload PDF/FAQ → retrieval), AI chatbot on WhatsApp with handover to staff, abandoned-cart and payment reminders, FB/IG auto-posting with calendar and approval, ad copy and creative generator, Meta Ads campaign assistant, AI sales and campaign summaries | 6–8 wk | Phase 6, AI key, Meta permissions |
| **8. QA and launch** | Functional, load and security testing (dispatch, payments, webhooks), Play Store and App Store submission, staged rollout, monitoring, handover docs | 3 wk | All |

**Indicative total:** about 5–6 months with 2 or 3 parallel tracks: (a) a Flutter team, (b) backend for franchise, EV and commerce, (c) web for admin, franchise and commerce panels. The AI phase can follow launch as a separate release.

Suggested release cuts:
- **R1:** Flutter apps, franchise, EV monitoring (the core mobility SOW)
- **R2:** e-commerce, logistics, WhatsApp leads
- **R3:** AI and marketing modules

---

## 6. Client-provided items (blocking, per the SOW §7)

- EV telematics API access, docs and a list of compatible vehicles
- Google Maps key with billing enabled (Maps JS, Directions, Places, Distance Matrix)
- Razorpay live and test keys
- SMS/OTP provider (SMSIndiaHub is already integrated) and DLT templates
- Firebase project (FCM) and Apple Developer and Google Play accounts
- WhatsApp Business API (BSP) account and approved templates
- Meta Business Manager, the ad account, a verified app for Lead Ads, Pages and Instagram publishing
- Shiprocket and BigShip accounts and API credentials
- AI provider API key
- Product catalogue, store list, franchise list and territory map, commission rules
- Hosting, domain and SSL

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| EV data depends on the OEM or telematics provider (fields vary; SOH and range are often missing) | Adapter with capability flags; the UI hides unsupported metrics |
| Meta app review and WhatsApp template approval take weeks | Start applications in Phase 0 |
| Store review (background location, payments) | Write location permission rationale early; submit for beta early |
| Franchise scoping retrofitted onto existing data | Migration script plus scoping middleware, with tests on every admin list endpoint |
| AI output quality and cost | Human approval step (the SOW requires it), usage caps, knowledge-base grounding with fallback answers |
| Scope creep (bus, rental and pooling exist but are not in the SOW) | Keep them as they are; no new work unless added to scope |
