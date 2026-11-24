// scripts/seedIndore.js: gives riders real quotes in Indore, and a re-run
// changes nothing (admin edits survive).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { BACKEND, check, imp, start } from './harness.mjs';

const { call, stop } = await start();
// Async: blocking this process also stalls the in-memory Mongo it hosts.
const seed = async (...args) => (await promisify(execFile)(process.execPath, [path.join(BACKEND, 'scripts/seedIndore.js'), ...args], { cwd: BACKEND, env: process.env })).stdout;
const { Zone } = await imp('src/modules/taxi/driver/models/Zone.js');
const { SetPrice } = await imp('src/modules/taxi/admin/models/SetPrice.js');
const { Vehicle } = await imp('src/modules/taxi/admin/models/Vehicle.js');
await Zone.init();

await seed();
check('dry run writes nothing', (await Vehicle.countDocuments()) === 0);
check('apply adds records', /^ADDED [1-9]/m.test(await seed('--apply')));
check('9 vehicles, 9 fares', (await Vehicle.countDocuments()) === 9 && (await SetPrice.countDocuments()) === 9);

const catalog = async (lat, lng) => (await call('GET', `/users/set-prices?lat=${lat}&lng=${lng}`)).body?.results || [];
for (const [place, lat, lng] of [['Rajwada', 22.7177, 75.8545], ['Vijay Nagar', 22.7533, 75.8937], ['Airport', 22.7218, 75.8011], ['Rau', 22.6370, 75.8090]]) {
  const rows = await catalog(lat, lng);
  check(`${place}: all 9 vehicles priced`, rows.length === 9 && rows.every((r) => r.base_price > 0 && r.price_per_distance > 0), rows.length);
}
const { findZoneByPickup } = await imp('src/modules/taxi/services/matchingService.js');
check('Bhopal is outside the zone', !(await findZoneByPickup([77.4126, 23.2599])));

const porter = await Vehicle.findOne({ name: 'Three Wheeler' }).lean();
const { getDeliveryQuote } = await imp('src/modules/taxi/user/services/deliveryService.js');
const quote = await getDeliveryQuote({ vehicleTypeId: String(porter._id), pickup: [75.8545, 22.7177], drop: [75.8937, 22.7533], parcel: { category: 'Furniture' } });
check('porter quote Rajwada to Vijay Nagar', quote.total > 150 && quote.zoneName === 'Indore', quote);
const bike = await Vehicle.findOne({ name: 'Bike Parcel' }).lean();
const refused = await getDeliveryQuote({ vehicleTypeId: String(bike._id), pickup: [75.8545, 22.7177], drop: [75.8937, 22.7533], parcel: { category: 'Furniture' } }).catch((e) => e);
check('furniture refused on a bike', refused?.statusCode === 400, refused?.message);

await SetPrice.updateOne({ vehicle_type: porter._id }, { $set: { base_price: 199 } });
check('second run adds nothing', /^ADDED 0/m.test(await seed('--apply')));
check('edited fare survives', (await SetPrice.findOne({ vehicle_type: porter._id }).lean()).base_price === 199);

await stop();
