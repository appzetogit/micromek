# EV fleet monitoring module

Vendor-neutral EV telematics: vehicle registry, live GPS/SOC/SOH/charging/range,
derived trips, low-battery/offline/overspeed/charging-fault alerts, and
utilisation reports. The telematics vendor is not chosen yet, so all vendor
access goes through `providers/`.

## Layout
```
providers/   baseProvider.js (contract + normalizer), mockProvider.js, genericRestProvider.js, index.js (registry)
models/      EvVehicle, EvTelemetry (time-series), EvTrip, EvAlert
services/    evRules.js (pure rules), evIngestService.js (poll/webhook/sync), evReportService.js (read models)
controllers/ evController.js
routes/      index.js  → export evRouter
```

## Wiring (done outside this folder)
- Mount `evRouter` at `/api` and `/api/v1` **before** the taxi router. It only claims `/admin/ev/*`, `/franchise/ev/*`, `/webhooks/ev/*`.
- After Mongo connects, call `startEvTelemetryLoop()` from `services/evIngestService.js`. It does nothing when the provider is disabled or `EV_POLL_SECONDS=0`, never overlaps itself, and its timer is unref'd. `stopEvTelemetryLoop()` exists for shutdown.
- Give admins the `ev_fleet.view` permission.
- `ev.alert.raised { alert, vehicle }` is emitted on the shared event bus for notifications.

## Endpoints (prefix `/api` or `/api/v1`)
Admin (`adminGuard('ev_fleet.view')`):
| Method | Path | Notes |
|---|---|---|
| GET | /admin/ev/provider | provider, capabilities, webhook config, rule settings, last poll |
| POST | /admin/ev/poll-now | run one poll now and return its summary |
| GET | /admin/ev/dashboard | counts, charging, low battery, offline, avg SOC/SOH, live alerts, map points. `?franchise_id=&service_location_id=` |
| POST | /admin/ev/vehicles/sync | import the vendor's vehicle list (`?dry_run=true`) |
| GET/POST | /admin/ev/vehicles | list (`search, status, charging=true, low_battery=true, franchise_id, page, limit`) / create |
| GET/PATCH/DELETE | /admin/ev/vehicles/:id | detail (snapshot, open trip, recent trips, live alerts) / update / soft delete |
| GET | /admin/ev/vehicles/:id/telemetry | `from, to` (default last 24 h, max 92 days), `bucket=auto\|raw\|<minutes>` |
| GET | /admin/ev/trips | `vehicle_id, status, from, to` (default 7 days) |
| GET | /admin/ev/trips/:id | trip and its route |
| GET | /admin/ev/alerts | `status=open\|acknowledged\|resolved\|live, type, severity, vehicle_id, from, to` |
| POST | /admin/ev/alerts/:id/acknowledge, /resolve | `{ note }` on resolve |
| GET | /admin/ev/reports/utilisation | `from, to, vehicle_id, format=csv` |

Franchise panel (`authenticate(['franchise'])`, read-only, only vehicles with `franchise_id` = the franchise):
`GET /franchise/ev/dashboard`, `/vehicles`, `/vehicles/:id`, `/vehicles/:id/telemetry`, `/trips`, `/trips/:id`, `/alerts`, `/reports/utilisation`. Query parameters are the same as the admin ones.

Webhook: `POST /webhooks/ev/:provider`, where `:provider` must be the active provider name. The shared secret goes in
`X-EV-Webhook-Secret: <secret>` or `Authorization: Bearer <secret>` and is compared in constant time. The endpoint returns 503 while
`EV_WEBHOOK_SECRET` is unset.

## Environment
| Var | Default | |
|---|---|---|
| EV_PROVIDER | `mock` outside production, disabled in production | `mock`, `generic_rest`, `none` |
| EV_ALLOW_MOCK_IN_PRODUCTION | – | `true` allows the mock provider in production |
| EV_POLL_SECONDS | 60 | 0 turns polling off (webhooks still work); minimum 10 |
| EV_WEBHOOK_SECRET | – | required for the webhook |
| EV_OFFLINE_MINUTES | 15 | minutes without telemetry before a vehicle counts as offline |
| EV_CRITICAL_BATTERY_PCT | 10 | low-battery threshold is per vehicle (`low_battery_threshold_pct`, default 20) |
| EV_BATTERY_HYSTERESIS_PCT | 2 | an alert clears only at threshold + this |
| EV_OVERSPEED_KMH | 100 | 0 turns it off |
| EV_TRIP_MIN_SPEED_KMH / EV_TRIP_IDLE_MINUTES / EV_TRIP_GAP_MINUTES / EV_TRIP_MIN_KM | 3 / 5 / 30 / 0.2 | trip detection |
| EV_MAX_ODOMETER_JUMP_KM | 50 | larger odometer jumps fall back to GPS distance |
| EV_TELEMETRY_TTL_DAYS | 180 | time-series expiry, applied only when the collection is created |
| EV_MOCK_VEHICLES / EV_MOCK_CENTER | 5 / `12.9716,77.5946` | mock fleet |
| EV_API_* , EV_FIELD_MAP, EV_VEHICLE_FIELD_MAP, EV_FIELD_SCALE, EV_CHARGING_STATE_MAP, EV_CAPABILITIES, EV_WEBHOOK_LIST_KEY | | generic REST, see the header of `genericRestProvider.js` |

Vendor credentials live only in env and are never stored or returned.

## Behaviour
- **Ingest.** Polls and webhooks both go through `processTelemetryBatch`. A point is ignored unless it is newer than `last_telemetry.recorded_at`. Each point becomes an `EvTelemetry` row, the vehicle snapshot is updated, the trip state machine runs on every point, and alert rules run on the newest point.
- **Trips** (`evRules.decideTrip`). A vehicle is *moving* when its speed is at least `EV_TRIP_MIN_SPEED_KMH`, or when the ignition is on and no speed is reported.
  - A trip starts on the first moving point.
  - It ends when the ignition goes off, after `EV_TRIP_IDLE_MINUTES` stopped (the end is the last moving point), or after a data gap longer than `EV_TRIP_GAP_MINUTES`.
  - Distance is the odometer delta when there is one, otherwise great-circle distance between fixes.
  - Trips shorter than `EV_TRIP_MIN_KM` are discarded.
- **Alerts.** Only one alert per vehicle and type can be live (open or acknowledged); a partial unique index enforces this.
  - Battery alerts use hysteresis and are never newly raised while the vehicle is charging. A low-battery alert is resolved as "escalated" when the battery goes critical.
  - Offline is checked for vehicles that sent nothing. It is skipped for `maintenance` vehicles, and `inactive` vehicles are not polled.
  - Alerts resolve automatically when the condition clears. If an admin resolves one by hand while the condition still holds, the next poll raises it again.
- **Telemetry storage.** `ev_telemetry` is a MongoDB time-series collection (MongoDB 5.0 or later; `$dateTrunc` bucketing needs 5.0 or later too). Mongoose creates it at startup. If an ordinary collection with that name already exists, it is **not** converted.

## Adding a real provider
1. Create `providers/<vendor>Provider.js` with a class that extends `EvTelemetryProvider`. Set `name` and `capabilities`, implement `listVehicles()` and `getLatestTelemetry(ids)`, and optionally `parseWebhook(req)` and `status()`. Return records through `normalizeTelemetry()` so units and enums match the contract; use `null` for anything the vendor does not report.
2. Register its factory in `providers/index.js` (`PROVIDER_FACTORIES`).
3. Set `EV_PROVIDER=<name>` and the vendor's credentials in env. Run `POST /admin/ev/vehicles/sync`, then link each vehicle to its driver, franchise and service location with `PATCH /admin/ev/vehicles/:id`.
4. If the vendor is a plain JSON REST API, you may not need any code: try `generic_rest` with `EV_FIELD_MAP` first.
