// Shop city delivery booked as a taxi-platform parcel ride, and ride progress
// flowing back to the shipment and order.
import { adminToken, check, imp, start, wait } from './harness.mjs';

const { call, stop, mongoose } = await start();
const { Vehicle } = await imp('src/modules/taxi/admin/models/Vehicle.js');
const { Zone } = await imp('src/modules/taxi/driver/models/Zone.js');
const { ServiceLocation } = await imp('src/modules/taxi/admin/models/ServiceLocation.js');
const { Ride } = await imp('src/modules/taxi/user/models/Ride.js');
const { Driver } = await imp('src/modules/taxi/driver/models/Driver.js');
await Promise.all([Driver.init(), Ride.init()]); // dispatch's $geoNear needs the drivers' 2dsphere index
const { User } = await imp('src/modules/taxi/user/models/User.js');
const { CommerceShipment } = await imp('src/modules/commerce/models/Shipment.js');
const { emit } = await imp('src/modules/shared/events.js');
const { reconcileCityDeliveries, shipmentStatusForRide } = await imp('src/modules/integrations/commerceCityDelivery.js');
const d = (r) => r.body?.data;

const admin = await adminToken(mongoose);
const city = (await ServiceLocation.collection.insertOne({ name: 'Indore', active: true })).insertedId;
await Zone.collection.insertOne({
  name: 'Indore City', service_location_id: city, active: true, status: 'active',
  geometry: { type: 'Polygon', coordinates: [[[75.7, 22.6], [76.0, 22.6], [76.0, 22.85], [75.7, 22.85], [75.7, 22.6]]] },
});
await Zone.init();
const vehicleTypeId = (await Vehicle.collection.insertOne({
  name: 'Parcel Bike', transport_type: 'delivery', active: true, status: 'active',
  delivery_distance_pricing: { enabled: true, base_price: 40, base_distance: 2, distance_price: 10 },
})).insertedId;

const st = d(await call('POST', '/admin/commerce/stores', { token: admin, body: { code: 'IND1', name: 'Indore Store', phone: '9111111111', gstin: '23ABCDE1234F1Z5', address: { line1: 'MG Road', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001' }, lat: 22.719, lng: 75.857 } }));
const p = d(await call('POST', '/admin/commerce/products', { token: admin, body: { sku: 'HLM', name: 'Helmet', price: 1000, gst_rate: 5 } }));
await call('POST', '/admin/commerce/inventory/adjust', { token: admin, body: { store_id: st._id, product_id: p._id, delta: 10, reason: 'stock' } });
const cust = d(await call('POST', '/admin/commerce/customers', { token: admin, body: { name: 'Neha', phone: '9700000001', type: 'retail' } }));
const shipTo = { name: 'Neha', phone: '9700000001', line1: 'Vijay Nagar', city: 'Indore', state: 'Madhya Pradesh', pincode: '452010', lat: 22.75, lng: 75.89 };
const newOrder = async (shipToOverride = shipTo) => d(await call('POST', '/admin/commerce/orders', { token: admin, body: { store_id: st._id, customer_id: cust._id, channel: 'phone', fulfilment: 'delivery', payment_method: 'cash', ship_to: shipToOverride, items: [{ product_id: p._id, qty: 1 }] } }));
const book = (order) => call('POST', `/admin/commerce/orders/${order._id}/shipments`, { token: admin, body: { provider: 'local_porter' } });

console.log('status mapping');
check('searching → pending_assignment', shipmentStatusForRide({ status: 'searching', liveStatus: 'searching' }) === 'pending_assignment');
check('accepted → booked', shipmentStatusForRide({ status: 'accepted', liveStatus: 'arriving' }) === 'booked');
check('started → in_transit', shipmentStatusForRide({ status: 'ongoing', liveStatus: 'started' }) === 'in_transit');
check('completed → delivered', shipmentStatusForRide({ status: 'completed' }) === 'delivered');
check('cancelled → cancelled', shipmentStatusForRide({ status: 'cancelled' }) === 'cancelled');

console.log('without a vehicle type configured: manual, as before');
const o0 = await newOrder();
const s0 = await book(o0);
check('booked manually (no ride)', s0.status < 300 && !d(s0)?.platform_delivery_id && d(s0)?.status === 'pending_assignment', s0.body);
await call('POST', `/admin/commerce/shipments/${d(s0)._id}/cancel`, { token: admin });

console.log('with COMMERCE_LOCAL_VEHICLE_TYPE_ID');
process.env.COMMERCE_LOCAL_VEHICLE_TYPE_ID = String(vehicleTypeId);
const o1 = await newOrder();
const s1 = await book(o1);
const shipment = d(s1);
check('shipment booked with a parcel ride', s1.status < 300 && !!shipment?.platform_delivery_id, s1.body);
const ride = shipment?.platform_delivery_id ? await Ride.findById(shipment.platform_delivery_id).lean() : null;
check('ride is a priced parcel from store to customer', ride?.serviceType === 'parcel' && ride?.fare > 0 && ride?.pickupLocation?.coordinates?.[0] === 75.857, ride && { fare: ride.fare, st: ride.serviceType, p: ride.pickupLocation });
check('ride carries receiver and COD instruction', ride?.parcel?.receiverMobile === '9700000001' && /Collect ₹1000/.test(ride?.parcel?.instructions || ''), ride?.parcel);
const storeUser = ride ? await User.findById(ride.userId).lean() : null;
check('booked by the store account, not the customer', storeUser?.phone === `store-${st._id}` && /\(store\)/.test(storeUser?.name), storeUser);

console.log('ride progress → shipment and order');
await Ride.updateOne({ _id: ride._id }, { $set: { status: 'accepted', liveStatus: 'arriving' } });
check('reconcile picks up accepted', (await reconcileCityDeliveries()) === 1);
check('shipment booked', (await CommerceShipment.findById(shipment._id).lean()).status === 'booked');
await Ride.updateOne({ _id: ride._id }, { $set: { status: 'ongoing', liveStatus: 'started' } });
emit('taxi.delivery.updated', { ride: await Ride.findById(ride._id).lean() });
await wait(300);
check('event moves it to in_transit', (await CommerceShipment.findById(shipment._id).lean()).status === 'in_transit');
let ord = d(await call('GET', `/admin/commerce/orders/${o1._id}`, { token: admin }));
check('order shipped', (ord?.status || ord?.order?.status) === 'shipped', ord?.status);
await Ride.updateOne({ _id: ride._id }, { $set: { status: 'completed', liveStatus: 'completed', completedAt: new Date() } });
await reconcileCityDeliveries();
ord = d(await call('GET', `/admin/commerce/orders/${o1._id}`, { token: admin }));
check('order delivered when the ride completes', (ord?.status || ord?.order?.status) === 'delivered', ord?.status);
check('nothing left to reconcile', (await reconcileCityDeliveries()) === 0);

console.log('staff cancel cancels the ride');
const o2 = await newOrder();
const s2 = d(await book(o2));
const c2 = await call('POST', `/admin/commerce/shipments/${s2._id}/cancel`, { token: admin });
const r2 = await Ride.findById(s2.platform_delivery_id).lean();
check('shipment cancelled', c2.status === 200 && d(c2)?.status === 'cancelled', c2.body);
check('ride cancelled too', r2?.status === 'cancelled', r2?.status);
const rebook = await book(o2);
check('order can be re-booked after cancel', rebook.status < 300 && !!d(rebook)?.platform_delivery_id, rebook.body);

console.log('missing coordinates');
const o3 = await newOrder({ ...shipTo, lat: null, lng: null });
const s3 = await book(o3);
check('clear error when the address has no map point', s3.status === 400 && s3.body?.details?.code === 'CITY_DELIVERY_NEEDS_COORDINATES', s3.body);
const again = await book(o3);
check('failed booking does not block a retry', again.status === 400, again.status);

await stop();
