/**
 * Starter configuration for Indore: city, zone, airport, vehicle types, fares,
 * goods types, app modules, cancellation reasons and driver documents.
 *
 *   node scripts/seedIndore.js            dry run: lists what is missing
 *   node scripts/seedIndore.js --apply    adds it
 *
 * Insert-only: an existing record (matched by name) is never changed, so admin
 * edits survive a re-run. Adds no users, drivers, rides or orders.
 *
 * FARES ARE STARTING VALUES, not market-checked or contractual. Review them in
 * Admin > Price Management > Set Price before taking real bookings.
 *
 * One zone for the whole city on purpose: deliveryService refuses a parcel
 * whose pickup and drop fall in different zones.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { Airport } from '../src/modules/taxi/admin/models/Airport.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { SetPrice } from '../src/modules/taxi/admin/models/SetPrice.js';
import { GoodsType } from '../src/modules/taxi/admin/models/GoodsType.js';
import { TaxiAppModule } from '../src/modules/taxi/admin/models/TaxiAppModule.js';
import { CancellationReason } from '../src/modules/taxi/admin/models/CancellationReason.js';
import { DriverNeededDocument } from '../src/modules/taxi/admin/models/DriverNeededDocument.js';
import { Zone } from '../src/modules/taxi/driver/models/Zone.js';
import { createDefaultAppSettings } from '../src/modules/taxi/admin/data/defaultAppSettings.js';

const APPLY = process.argv.includes('--apply');
const CENTER = [75.8577, 22.7196]; // [lng, lat]

// Approximate operating boundary: Indore city with the airport, Super Corridor,
// Rau, Bypass and Mangliya. Adjust on the map in Admin > Zone.
const INDORE_RING = [
  [75.745, 22.735], [75.775, 22.800], [75.835, 22.840], [75.915, 22.840],
  [75.975, 22.800], [75.990, 22.730], [75.970, 22.650], [75.920, 22.605],
  [75.840, 22.595], [75.775, 22.620], [75.745, 22.675], [75.745, 22.735],
];

const COMMISSION = {
  // type 1 = percent
  admin_commission_type_from_driver: 1,
  admin_commission_from_driver: 10,
  admin_commission_type_for_owner: 1,
  admin_commission_for_owner: 10,
  admin_commision_type: 1,
  admin_commision: 0,
  service_tax: 0,
};

const TAXIS = [
  { name: 'Bike', icon_types: 'bike', category: 'bike', capacity: 1, image: '/1_Bike.png', desc: 'Quick solo rides', fare: { base: 25, perKm: 7, wait: 1 } },
  { name: 'Auto', icon_types: 'auto', category: 'auto', capacity: 3, image: '/2_AutoRickshaw.png', desc: 'Everyday auto rides', fare: { base: 35, perKm: 13, wait: 1 } },
  { name: 'E-Rickshaw', icon_types: 'auto', category: 'auto', capacity: 4, image: '/3_E-Rickshaw.png', desc: 'Electric short-distance rides', fare: { base: 30, perKm: 11, wait: 1 } },
  { name: 'Hatchback', icon_types: 'car', category: 'car', capacity: 4, image: '/Hatchback.png', desc: 'Compact AC cab', fare: { base: 70, perKm: 14, wait: 2, out: 11 } },
  { name: 'Sedan', icon_types: 'car', category: 'car', capacity: 4, image: '/4_Taxi.png', desc: 'Comfortable AC sedan', fare: { base: 90, perKm: 16, wait: 2, out: 13 } },
  { name: 'SUV', icon_types: 'suv', category: 'car', capacity: 6, image: '/SUV.png', desc: 'Spacious AC SUV for groups', fare: { base: 130, perKm: 22, wait: 3, out: 18 } },
];

const PORTERS = [
  { name: 'Bike Parcel', icon_types: 'bike', delivery_category: '2wheeler', size: 'Up to 20 kg', image: '/5_Parcel.png', desc: 'Documents and small parcels', fare: { base: 40, perKm: 9, wait: 1 } },
  { name: 'Three Wheeler', icon_types: 'auto', delivery_category: 'trucks', size: 'Up to 500 kg', image: '/2_AutoRickshaw.png', desc: 'Boxes, appliances and shop stock', fare: { base: 150, perKm: 18, wait: 2 } },
  { name: 'Mini Truck', icon_types: 'truck', delivery_category: 'trucks', size: 'Up to 750 kg', image: '/5_Parcel.png', desc: 'Furniture and larger loads', fare: { base: 260, perKm: 24, wait: 3 } },
];

// '2wheeler goods' can also go by truck, so only bulky goods are restricted.
const GOODS = [
  ['Documents', 'both'], ['Food & Groceries', 'both'], ['Clothes & Textiles', 'both'],
  ['Electronics', 'both'], ['Medicines', 'both'],
  ['Furniture', 'three wheeler,mini truck'], ['Home Appliances', 'three wheeler,mini truck'],
  ['Building Material', 'mini truck'],
];

const REASONS = {
  user: ['Driver is taking too long', 'Booked by mistake', 'Change of plans', 'Wrong pickup or drop', 'Driver asked me to cancel'],
  driver: ['Rider not reachable', 'Rider not at pickup', 'Vehicle problem', 'Too much luggage or load', 'Unsafe pickup location'],
};

const DOCUMENTS = [
  { name: 'Driving Licence', slug: 'driving-licence', verification_type: 'driving_license', has_expiry_date: true, has_identify_number: true },
  { name: 'Aadhaar Card', slug: 'aadhaar-card', has_identify_number: true },
  { name: 'PAN Card', slug: 'pan-card', image_type: 'front', verification_type: 'pan', has_identify_number: true },
  { name: 'Vehicle RC', slug: 'vehicle-rc', verification_type: 'rc', has_identify_number: true },
  { name: 'Vehicle Insurance', slug: 'vehicle-insurance', image_type: 'front', has_expiry_date: true },
  { name: 'Pollution Certificate (PUC)', slug: 'pollution-certificate', image_type: 'front', has_expiry_date: true, is_required: false },
];

// Services outside the MIKROMEK scope are added switched off.
const MODULES_OFF = new Set(['Bike Rental', 'Bus']);

const log = { added: [], kept: [] };
const ensure = async (Model, filter, doc, label) => {
  const existing = await Model.findOne(filter);
  if (existing) { log.kept.push(label); return existing; }
  log.added.push(label);
  if (!APPLY) return { _id: new mongoose.Types.ObjectId() };
  return Model.create(doc);
};

const run = async () => {
  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName, autoIndex: false });

  const city = await ensure(ServiceLocation, { name: 'Indore' }, {
    name: 'Indore', service_location_name: 'Indore', address: 'Indore, Madhya Pradesh', country: 'India',
    latitude: CENTER[1], longitude: CENTER[0], location: { type: 'Point', coordinates: CENTER },
  }, 'city: Indore');

  const zone = await ensure(Zone, { name: 'Indore', service_location_id: city._id }, {
    name: 'Indore', service_location_id: city._id, unit: 'km', active: true, status: 'active',
    maximum_distance_for_regular_rides: 45, maximum_distance_for_outstation_rides: 600,
    geometry: { type: 'Polygon', coordinates: [INDORE_RING] },
  }, 'zone: Indore');

  await ensure(Airport, { code: 'IDR' }, {
    name: 'Devi Ahilya Bai Holkar Airport', code: 'IDR', service_location_id: city._id, zone_id: zone._id,
    address: 'Airport Road, Indore, Madhya Pradesh', latitude: 22.7218, longitude: 75.8011,
    location: { type: 'Point', coordinates: [75.8011, 22.7218] },
  }, 'airport: IDR');

  const price = (vehicle, transport_type, fare, name) =>
    ensure(SetPrice, { vehicle_type: vehicle._id, zone_id: zone._id, transport_type, pricing_scope: 'ride' }, {
      ...COMMISSION,
      zone_id: zone._id, service_location_id: city._id, vehicle_type: vehicle._id, transport_type,
      // Cash only until this site has its own payment gateway keys.
      pricing_scope: 'ride', payment_type: ['cash'],
      base_price: fare.base, base_distance: 2, price_per_distance: fare.perKm,
      waiting_charge: fare.wait, free_waiting_before: 5, free_waiting_after: 5,
      ...(fare.out ? {
        enable_outstation_ride: true, support_outstation: 1, outstation_base_price: fare.base,
        outstation_base_distance: 2, outstation_price_per_distance: fare.out,
        outstation_round_trip_price_per_distance: fare.out,
      } : {}),
      user_cancellation_fee_type: 'fixed', user_cancellation_fee: 0,
      driver_cancellation_fee_type: 'fixed', driver_cancellation_fee: 0,
      active: 1, status: 'active',
    }, `fare: ${name} (${transport_type})`);

  for (const v of TAXIS) {
    const { fare, desc, ...rest } = v;
    const vehicle = await ensure(Vehicle, { name: v.name, transport_type: 'taxi' }, {
      ...rest, short_description: desc, description: desc, transport_type: 'taxi', is_taxi: 'taxi',
      icon: v.image, map_icon: v.image, status: 1, active: true,
    }, `vehicle: ${v.name}`);
    await price(vehicle, 'taxi', fare, v.name);
  }

  for (const v of PORTERS) {
    const { fare, desc, ...rest } = v;
    const vehicle = await ensure(Vehicle, { name: v.name, transport_type: 'delivery' }, {
      ...rest, short_description: desc, description: desc, transport_type: 'delivery', is_taxi: 'delivery',
      icon: v.image, map_icon: v.image, status: 1, active: true,
      delivery_distance_pricing: { enabled: true, base_price: fare.base, free_distance: 2, distance_price: fare.perKm, free_time: 5, time_price: fare.wait },
    }, `vehicle: ${v.name}`);
    await price(vehicle, 'delivery', fare, v.name);
  }

  for (const [name, forTypes] of GOODS) {
    await ensure(GoodsType, { goods_type_name: name }, { goods_type_name: name, goods_types_for: forTypes, active: 1, status: 'active' }, `goods: ${name}`);
  }

  for (const m of createDefaultAppSettings().app_modules || []) {
    await ensure(TaxiAppModule, { name: m.name }, {
      name: m.name, transport_type: m.transport_type, service_type: m.service_type,
      short_description: m.short_description || '', description: m.description || '',
      mobile_menu_icon: m.mobile_menu_icon || '', order_by: Number(m.order_by || 1),
      active: MODULES_OFF.has(m.name) ? 0 : 1,
    }, `module: ${m.name}${MODULES_OFF.has(m.name) ? ' (off)' : ''}`);
  }

  for (const [audience, titles] of Object.entries(REASONS)) {
    for (const [i, title] of [...titles, 'Other'].entries()) {
      await ensure(CancellationReason, { audience, title }, { audience, title, order_by: i + 1, requiresNote: title === 'Other' }, `reason (${audience}): ${title}`);
    }
  }

  for (const [i, d] of DOCUMENTS.entries()) {
    const key = d.slug.replace(/-/g, '_');
    await ensure(DriverNeededDocument, { slug: d.slug }, {
      template_type: 'document', account_type: 'both', image_type: 'front_back', is_required: true, is_editable: true,
      key, front_key: `${key}_front`, back_key: `${key}_back`, identify_number_key: d.has_identify_number ? `${key}_number` : '',
      sort_order: i + 1, ...d,
    }, `document: ${d.name}`);
  }

  console.log(`${APPLY ? 'ADDED' : 'WOULD ADD'} ${log.added.length} | already there ${log.kept.length} | database ${env.mongoDbName}`);
  for (const line of log.added) console.log(`  + ${line}`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('seed failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
