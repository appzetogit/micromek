// A franchise's own fares for its territory: rider catalog (taxi) and parcel
// tariff scale by its multiplier; admin views keep the platform tariff.
import { adminToken, check, imp, start } from './harness.mjs';

const { call, stop, mongoose } = await start();
const { ServiceLocation } = await imp('src/modules/taxi/admin/models/ServiceLocation.js');
const { Zone } = await imp('src/modules/taxi/driver/models/Zone.js');
const { Vehicle } = await imp('src/modules/taxi/admin/models/Vehicle.js');
const { SetPrice } = await imp('src/modules/taxi/admin/models/SetPrice.js');
const { resolveDeliveryTariff } = await imp('src/modules/taxi/services/deliveryTariffService.js');
const { clearFranchiseFareCache } = await imp('src/modules/franchise/services/franchiseFareService.js');
await Zone.init();

const admin = await adminToken(mongoose);
const city = (await ServiceLocation.collection.insertOne({ name: 'Indore', active: true })).insertedId;
const zone = (await Zone.collection.insertOne({
  name: 'Indore City', service_location_id: city, active: true, status: 'active',
  geometry: { type: 'Polygon', coordinates: [[[75.7, 22.6], [76.0, 22.6], [76.0, 22.85], [75.7, 22.85], [75.7, 22.6]]] },
})).insertedId;
const car = (await Vehicle.collection.insertOne({ name: 'Sedan', transport_type: 'taxi', active: true, status: 'active', delivery_distance_pricing: { enabled: true, base_price: 40, distance_price: 10 } })).insertedId;
await SetPrice.collection.insertOne({ zone_id: zone, service_location_id: city, transport_type: 'taxi', vehicle_type: car, pricing_scope: 'ride', base_price: 50, base_distance: 2, price_per_distance: 12, time_price: 1, active: 1, status: 'active', createdAt: new Date(), updatedAt: new Date() });

const catalog = async () => {
  const r = await call('GET', '/users/set-prices?lat=22.72&lng=75.86');
  const rows = r.body?.results || r.body?.data?.results || [];
  return rows.find((x) => String(x.vehicle_type?._id || x.vehicle_type || x.type_id) === String(car));
};

console.log('no franchise: platform price');
let row = await catalog();
check('catalog row found', !!row, row);
check('base price 50', row?.base_price === 50, row?.base_price);

console.log('franchise prices its city at 1.2x taxi, 0.9x parcels');
const f = await call('POST', '/admin/franchises', { token: admin, body: { name: 'Indore Fr', contact_name: 'A', mobile: '9100000001', email: 'f@t.io', password: 'password1', service_location_ids: [String(city)], fare_multipliers: { taxi: 1.2, delivery: 0.9 } } });
check('created with fare multipliers', f.status === 201 && f.body.data?.fare_multipliers?.taxi === 1.2, f.body);
row = await catalog();
check('rider base price 60', row?.base_price === 60, row?.base_price);
check('per-km 14.4', row?.price_per_distance === 14.4, row?.price_per_distance);
check('row marked with the franchise multiplier', row?.franchise_fare_multiplier === 1.2, row?.franchise_fare_multiplier);
check('surge badge untouched', !row?.price_hike_multiplier || row.price_hike_multiplier === 1, row?.price_hike_multiplier);
const adminRows = await call('GET', '/admin/types/set-prices', { token: admin });
const adminRow = (adminRows.body?.data?.results || adminRows.body?.results || []).find((x) => String(x.type_id || x.vehicle_type?._id || x.vehicle_type) === String(car));
check('admin still sees the platform tariff (50)', adminRow?.base_price === 50, adminRow?.base_price);

const vehicle = await Vehicle.findById(car).select('delivery_distance_pricing service_tax').lean();
const zoneDoc = await Zone.findById(zone).lean();
const tariff = await resolveDeliveryTariff({ vehicle, zone: zoneDoc });
check('parcel tariff scaled 0.9x (base 36, per km 9)', tariff.basePrice === 36 && tariff.pricePerKm === 9 && tariff.franchiseFareMultiplier === 0.9, tariff);

console.log('validation and switching off');
const bad = await call('PATCH', `/admin/franchises/${f.body.data._id}`, { token: admin, body: { fare_multipliers: { taxi: 3 } } });
check('multiplier above 2 refused', bad.status === 400, bad.body);
const susp = await call('POST', `/admin/franchises/${f.body.data._id}/suspend`, { token: admin });
check('suspend', susp.status === 200);
row = await catalog();
check('suspended franchise no longer changes prices', row?.base_price === 50, row?.base_price);
await call('POST', `/admin/franchises/${f.body.data._id}/reactivate`, { token: admin });
await call('PATCH', `/admin/franchises/${f.body.data._id}`, { token: admin, body: { fare_multipliers: { taxi: 1 } } });
clearFranchiseFareCache();
row = await catalog();
check('multiplier 1 = platform price again', row?.base_price === 50 && !row?.franchise_fare_multiplier, row);

await stop();
