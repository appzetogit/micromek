import { adminToken, check, imp, start } from './harness.mjs';

const { call, stop, mongoose } = await start();
const { ServiceLocation } = await imp('src/modules/taxi/admin/models/ServiceLocation.js');
const { Zone } = await imp('src/modules/taxi/driver/models/Zone.js');
const { Ride } = await imp('src/modules/taxi/user/models/Ride.js');
const { Driver } = await imp('src/modules/taxi/driver/models/Driver.js');

const admin = await adminToken(mongoose);
const subNoPerm = await adminToken(mongoose, { subadmin: true, permissions: ['users.view'] });

const cityA = (await ServiceLocation.collection.insertOne({ name: 'Indore' })).insertedId;
const cityB = (await ServiceLocation.collection.insertOne({ name: 'Bhopal' })).insertedId;
const square = [[[77.3, 23.2], [77.5, 23.2], [77.5, 23.3], [77.3, 23.3], [77.3, 23.2]]];
const zoneB = (await Zone.collection.insertOne({ name: 'Bhopal Central', service_location_id: cityB, geometry: { type: 'Polygon', coordinates: square } })).insertedId;

console.log('franchise CRUD + territory');
const f1 = await call('POST', '/admin/franchises', { token: admin, body: { name: 'Indore Movers', contact_name: 'A', mobile: '9000000001', email: 'f1@t.io', password: 'password1', service_location_ids: [cityA] } });
check('create F1 (city A)', f1.status === 201 && f1.body.data.status === 'approved', f1.body);
check('password not returned', f1.body.data && !('password' in f1.body.data));
const f2 = await call('POST', '/admin/franchises', { token: admin, body: { name: 'Bhopal Central', contact_name: 'B', mobile: '9000000002', email: 'f2@t.io', password: 'password2', zone_ids: [zoneB] } });
check('create F2 (zone in city B)', f2.status === 201, f2.body);
const f3 = await call('POST', '/admin/franchises', { token: admin, body: { name: 'Bhopal All', contact_name: 'C', mobile: '9000000003', email: 'f3@t.io', password: 'password3', service_location_ids: [cityB] } });
check('city B refused because a zone in it is taken', f3.status === 409 && f3.body.details?.code === 'TERRITORY_TAKEN', f3.body);
const apply = await call('POST', '/franchise/apply', { body: { name: 'Dup', contact_name: 'D', mobile: '9000000004', email: 'f4@t.io', password: 'password4', service_location_ids: [cityA] } });
check('public apply for taken city refused', apply.status === 409, apply.body);
const apply2 = await call('POST', '/franchise/apply', { body: { name: 'Nowhere', contact_name: 'E', mobile: '9000000005', email: 'f5@t.io', password: 'password5' } });
check('public apply creates pending', apply2.status === 201 && apply2.body.data.status === 'pending', apply2.body);
const pendingLogin = await call('POST', '/franchise/auth/login', { body: { email: 'f5@t.io', password: 'password5' } });
check('pending franchise cannot log in', pendingLogin.status === 403, pendingLogin.body);
const list = await call('GET', '/admin/franchises?status=approved', { token: admin });
check('list filters by status', list.status === 200 && list.body.data.total === 2, list.body);
const denied = await call('GET', '/admin/franchises', { token: subNoPerm });
check('subadmin without franchises.view gets 403', denied.status === 403, denied.body);
const noAuth = await call('GET', '/admin/franchises');
check('no token gets 401', noAuth.status === 401);
const passthrough = await call('GET', '/admin/permissions', { token: admin });
check('other /admin routes still reach the taxi router', passthrough.status === 200, passthrough.body);

const F1 = f1.body.data._id;
const upd = await call('PATCH', `/admin/franchises/${F1}`, { token: admin, body: { commission: { default: { type: 'percent_of_commission', value: 50 }, by_transport_type: { delivery: { type: 'percent_of_fare', value: 10 } } } } });
check('set commission rules', upd.status === 200, upd.body);
const bad = await call('PATCH', `/admin/franchises/${F1}`, { token: admin, body: { commission: { default: { type: 'percent_of_commission', value: 150 } } } });
check('commission > 100% refused', bad.status === 400);

console.log('rides + settlement');
const day = 86400000;
const now = Date.now();
const ride = (o) => ({ userId: new mongoose.Types.ObjectId(), pickupLocation: { type: 'Point', coordinates: [75.8, 22.7] }, dropLocation: { type: 'Point', coordinates: [75.9, 22.8] }, fare: 100, commissionAmount: 20, status: 'completed', transport_type: 'taxi', service_location_id: cityA, createdAt: new Date(now - 2 * day), completedAt: new Date(now - 2 * day), adminDeletedAt: null, ...o });
await Ride.collection.insertMany([
  ride({}), ride({}), ride({}),
  ride({ transport_type: 'delivery', fare: 50, commissionAmount: 10 }),
  ride({ status: 'cancelled', completedAt: null }),
  ride({ completedAt: new Date(now - 40 * day), createdAt: new Date(now - 40 * day) }), // outside period
  ride({ service_location_id: cityB, pickupLocation: { type: 'Point', coordinates: [77.4, 23.25] } }), // zone B
  ride({ service_location_id: cityB, pickupLocation: { type: 'Point', coordinates: [77.0, 23.0] } }), // city B, outside zone
]);
await Driver.collection.insertMany([
  { name: 'D1', phone: '1', service_location_id: cityA, isOnline: true, rating: 4.5, ratingCount: 2, deletedAt: null },
  { name: 'D2', phone: '2', service_location_id: cityA, isOnline: false, rating: 3.5, ratingCount: 2, deletedAt: null },
  { name: 'D3', phone: '3', service_location_id: cityB, isOnline: true, deletedAt: null },
]);

const from = new Date(now - 7 * day).toISOString();
const to = new Date(now - 60000).toISOString();
const gen = await call('POST', '/admin/franchise-settlements', { token: admin, body: { franchise_id: F1, from, to } });
const s = gen.body.data;
check('settlement generated', gen.status === 201, gen.body);
check('counts 4 completed rides in period', s?.rides === 4, s);
check('gross fare 350', s?.gross_fare === 350, s);
check('share = 3*20*50% + 50*10% = 35', s?.franchise_share === 35, s);
const overlap = await call('POST', '/admin/franchise-settlements', { token: admin, body: { franchise_id: F1, from: new Date(now - 3 * day).toISOString(), to } });
check('overlapping period refused', overlap.status === 409, overlap.body);
const future = await call('POST', '/admin/franchise-settlements', { token: admin, body: { franchise_id: F1, from, to: new Date(now + day).toISOString() } });
check('future end refused', future.status === 400);
const adj = await call('POST', `/admin/franchise-settlements/${s._id}/adjustments`, { token: admin, body: { amount: -5, reason: 'penalty' } });
check('adjustment → payable 30', adj.body.data?.payable === 30, adj.body);
const payEarly = await call('POST', `/admin/franchise-settlements/${s._id}/pay`, { token: admin, body: { payment_reference: 'UTR1' } });
check('cannot pay a draft', payEarly.status === 400);
await call('POST', `/admin/franchise-settlements/${s._id}/approve`, { token: admin });
const adjLate = await call('POST', `/admin/franchise-settlements/${s._id}/adjustments`, { token: admin, body: { amount: 5, reason: 'x' } });
check('no adjustments after approval', adjLate.status === 400);
const payNoRef = await call('POST', `/admin/franchise-settlements/${s._id}/pay`, { token: admin, body: {} });
check('pay needs a reference', payNoRef.status === 400);
const paid = await call('POST', `/admin/franchise-settlements/${s._id}/pay`, { token: admin, body: { payment_reference: 'UTR1' } });
check('paid', paid.body.data?.status === 'paid', paid.body);

console.log('franchise panel');
const login = await call('POST', '/franchise/auth/login', { body: { email: 'f1@t.io', password: 'password1' } });
check('login', login.status === 200 && login.body.data.token, login.body);
const wrong = await call('POST', '/franchise/auth/login', { body: { email: 'f1@t.io', password: 'nope' } });
check('wrong password 401', wrong.status === 401);
const tok = login.body.data.token;
const dash = await call('GET', '/franchise/dashboard', { token: tok });
check('dashboard totals', dash.body.data?.rides === 4 && dash.body.data?.cancelled === 1 && dash.body.data?.drivers_total === 2 && dash.body.data?.drivers_online === 1, dash.body);
check('avg rating 4', dash.body.data?.avg_driver_rating === 4, dash.body.data);
const drivers = await call('GET', '/franchise/drivers', { token: tok });
check('drivers scoped to city A', drivers.body.data?.total === 2, drivers.body);
const rides = await call('GET', '/franchise/rides', { token: tok });
check('rides scoped (5 in last 30d)', rides.body.data?.total === 5, rides.body.data?.total);
const sets = await call('GET', '/franchise/settlements', { token: tok });
check('sees own settlement', sets.body.data?.total === 1);
const selfEdit = await call('PATCH', '/franchise/me', { token: tok, body: { status: 'approved', zone_ids: [zoneB], contact_name: 'New' } });
check('panel cannot change territory', selfEdit.status === 200 && selfEdit.body.data.zone_ids.length === 0 && selfEdit.body.data.contact_name === 'New', selfEdit.body);
const adminWithFranchiseToken = await call('GET', '/admin/franchises', { token: tok });
check('franchise token refused on admin routes', adminWithFranchiseToken.status === 403);

const login2 = await call('POST', '/franchise/auth/login', { body: { mobile: '9000000002', password: 'password2' } });
const dash2 = await call('GET', '/franchise/dashboard', { token: login2.body.data.token });
check('zone franchise counts only rides inside the zone', dash2.body.data?.rides === 1, dash2.body.data);

const susp = await call('POST', `/admin/franchises/${F1}/suspend`, { token: admin, body: { note: 'audit' } });
check('suspend', susp.body.data?.status === 'suspended');
const afterSusp = await call('GET', '/franchise/me', { token: tok });
check('suspended token refused', afterSusp.status === 403, afterSusp.body);
const lb = await call('GET', '/admin/franchises/leaderboard', { token: admin });
check('leaderboard lists approved only', lb.status === 200 && lb.body.data.items.length === 1, lb.body);

await stop();
