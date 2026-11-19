# Franchise module

City- and area-wise franchises on top of the taxi platform. Nothing in the
ride, dispatch or pricing path changes: a franchise's numbers are read from
completed rides in its territory.

## Territory

- `service_location_ids` (whole cities) and/or `zone_ids` (areas).
- A ride belongs to a franchise when its `service_location_id` is one of the
  franchise's cities, or its pickup point lies inside one of its zones.
  Taxi, parcel/porter and intercity rides are all `TaxiRide`, so one rule covers them.
- Drivers belong by `Driver.service_location_id` / `Driver.zoneId`, fleet
  owners by `Owner.service_location_id`.
- Exclusive: a city or zone can be held by one pending/approved/suspended
  franchise. A city also collides with any zone inside it (`TERRITORY_TAKEN`, 409).

## Commission

`commission.default` plus optional `commission.by_transport_type.{taxi|delivery|intercity}`:
`{ type: 'percent_of_commission' | 'percent_of_fare', value: 0-100 }`.
`percent_of_commission` shares what the platform kept (`Ride.commissionAmount`).

## Settlements

`draft → approved → paid`, or `cancelled` from draft/approved. A draft can be
refreshed (re-aggregated) and adjusted (+/- with a reason). Periods for one
franchise cannot overlap and cannot end in the future. Paying needs a
`payment_reference` (UTR). Payout itself happens outside the system.

## Endpoints (`/api/v1` or `/api`)

Public: `POST /franchise/apply` (creates pending), `POST /franchise/auth/login` (email or mobile + password → JWT, role `franchise`).

Franchise panel (Bearer franchise token): `GET/PATCH /franchise/me`, `POST /franchise/me/password`,
`GET /franchise/dashboard?from&to`, `/franchise/drivers`, `/franchise/owners`, `/franchise/fleet-vehicles`,
`/franchise/rides?from&to&status&transport_type`, `/franchise/fares`, `/franchise/settlements[/:id]`.

Admin (permission `franchises.view`): `GET/POST /admin/franchises`, `GET /admin/franchises/leaderboard`,
`GET/PATCH/DELETE /admin/franchises/:id`, `POST /admin/franchises/:id/{approve|reject|suspend|reactivate}`,
`GET/POST /admin/franchise-settlements`, `GET /admin/franchise-settlements/:id`,
`POST /admin/franchise-settlements/:id/{refresh|adjustments|approve|pay|cancel}`.

## Franchise fares

`fare_multipliers: { taxi, delivery, intercity }` (0.5–2, 1 = platform price) prices the
franchise's territory up or down from the platform tariff. Applied in
`services/franchiseFareService.js` callers only:

- taxi and intercity: the rider price catalog (`GET /users/set-prices`), which the apps
  quote from and the booking bills. Stacks with surge. Rows carry
  `franchise_fare_multiplier`; `price_hike_multiplier` still means surge only.
- parcels: `resolveDeliveryTariff` (server-priced), base price, per-km and waiting charge.

Admins always see and edit the platform tariff. Only approved franchises count. Changes
apply at once in the process that saved them and within 30 s in the others (cache TTL).

## Not done yet

- Driver approval stays with the platform admin.
