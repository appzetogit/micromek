import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { on } from '../shared/events.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../taxi/constants/index.js';
import { Ride } from '../taxi/user/models/Ride.js';
import { User } from '../taxi/user/models/User.js';
import { createDeliveryRecord } from '../taxi/user/services/deliveryService.js';
import { cancelRideRequestAsAdmin } from '../taxi/admin/services/adminService.js';
import { CommerceShipment } from '../commerce/models/Shipment.js';
import { CommerceStore } from '../commerce/models/Store.js';
import { applyShipmentUpdate } from '../commerce/services/shippingService.js';
import { TERMINAL_SHIPMENT } from '../commerce/shipping/status.js';
import { setPlatformDeliveryBooker, setPlatformDeliveryCanceller } from '../commerce/shipping/localPorter.js';

/// City delivery of shop orders by the platform's own parcel drivers.
///
/// Booking a `local_porter` shipment books an ordinary parcel ride through
/// createDeliveryRecord, so it is priced, zoned and dispatched exactly like a
/// parcel a customer books in the app. The ride is booked by a per-store
/// account ("<store> (store)"): the store is the sender and pays the parcel
/// fare in cash, the shop customer is the receiver.
///
/// Ride progress flows back to the shipment (and through it, the order):
///   searching            → pending_assignment
///   accepted/arriving/arrived → booked (driver on the way to the store)
///   started              → in_transit (picked up)
///   completed            → delivered
///   cancelled            → cancelled (the order stays packed; staff re-book)
/// It arrives through the `taxi.delivery.updated` event and, as a safety net,
/// a reconcile pass over open shipments (startCityDeliveryReconcile).
///
/// Needs COMMERCE_LOCAL_VEHICLE_TYPE_ID (the parcel vehicle type to book) and
/// map coordinates for the store and the delivery address. Without the vehicle
/// type, bookings stay manual, as before.

const ACTIVE_RIDE = [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING];

export const shipmentStatusForRide = (ride) => {
  if (!ride) return null;
  if (ride.status === RIDE_STATUS.COMPLETED) return 'delivered';
  if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) return 'cancelled';
  if (ride.status === RIDE_STATUS.ONGOING || ride.liveStatus === RIDE_LIVE_STATUS.STARTED) return 'in_transit';
  if (ride.status === RIDE_STATUS.ACCEPTED) return 'booked';
  return 'pending_assignment';
};

const point = (p = {}, label) => {
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    throw new ApiError(400, `City delivery needs map coordinates for the ${label}. Add lat/lng to it and try again.`, {
      code: 'CITY_DELIVERY_NEEDS_COORDINATES',
    });
  }
  return [lng, lat]; // createDeliveryRecord takes [longitude, latitude]
};

const addressLine = (a = {}) =>
  [a.line1, a.line2, a.city, a.state, a.pincode].map((s) => String(s || '').trim()).filter(Boolean).join(', ');

/// One taxi account per store, created on first use. The phone is not a real
/// number, so nobody can sign in to it.
const storeAccount = async (store) => {
  const phone = `store-${store._id}`;
  const existing = await User.findOne({ phone }).select('_id').lean();
  if (existing) return existing._id;
  try {
    const created = await User.create({ phone, name: `${store.name} (store)`, email: store.email || undefined });
    return created._id;
  } catch (error) {
    if (error?.code === 11000) return (await User.findOne({ phone }).select('_id').lean())?._id;
    throw error;
  }
};

const bookCityDelivery = async ({ shipment, order }) => {
  const vehicleTypeId = String(process.env.COMMERCE_LOCAL_VEHICLE_TYPE_ID || '').trim();
  if (!vehicleTypeId) return null; // not configured: shipment stays manual
  if (!mongoose.Types.ObjectId.isValid(vehicleTypeId)) {
    throw new ApiError(500, 'COMMERCE_LOCAL_VEHICLE_TYPE_ID is not a valid vehicle type id');
  }

  const store = await CommerceStore.findById(order.store_id).lean();
  if (!store) throw new ApiError(404, 'Store not found');
  const pickup = point(shipment.pickup, 'store');
  const drop = point(shipment.drop, 'delivery address');
  const cod = Number(shipment.cod_amount) || 0;
  const items = (order.items || []).map((i) => `${i.qty} × ${i.name}`).join(', ').slice(0, 200);

  const booked = await createDeliveryRecord({
    userId: await storeAccount(store),
    pickup,
    drop,
    pickupAddress: `${store.name}, ${addressLine(store.address)}`,
    dropAddress: addressLine(shipment.drop),
    vehicleTypeId,
    paymentMethod: 'cash',
    parcel: {
      category: process.env.COMMERCE_LOCAL_GOODS_CATEGORY || '',
      description: `Order ${order.number}: ${items}`,
      senderName: store.name,
      senderMobile: store.phone || '',
      receiverName: shipment.drop?.name || '',
      receiverMobile: shipment.drop?.phone || '',
      // Cash collection from the customer is not tracked by the ride; the store
      // settles it with the driver.
      instructions: cod > 0 ? `Collect ₹${cod} cash from the customer on delivery (order ${order.number}).` : '',
    },
  });

  const status = shipmentStatusForRide(booked);
  // Dispatch can end a parcel at once (e.g. no driver can be searched for). Throwing
  // makes bookShipment mark the shipment failed and inactive, so staff can re-book.
  if (status === 'cancelled') {
    throw new ApiError(409, 'The parcel ride could not be booked (cancelled by dispatch). Try again shortly.', {
      code: 'CITY_DELIVERY_NOT_BOOKED',
      ride_id: booked.rideId,
    });
  }
  return { delivery_id: booked.rideId, status };
};

const cancelCityDelivery = async (shipment) => {
  if (!shipment.platform_delivery_id) return;
  const ride = await Ride.findById(shipment.platform_delivery_id).select('status liveStatus').lean();
  if (!ride || !ACTIVE_RIDE.includes(ride.status)) return;
  await cancelRideRequestAsAdmin(shipment.platform_delivery_id, { reason: 'Shop delivery cancelled by store staff' });
};

/// Brings one shipment in line with its ride. Safe to call repeatedly.
export const syncShipmentFromRide = async (shipment, ride) => {
  const status = shipmentStatusForRide(ride);
  if (!status || status === shipment.status || TERMINAL_SHIPMENT.includes(shipment.status)) return null;
  return applyShipmentUpdate(shipment, {
    status,
    raw_status: `RIDE_${String(ride.liveStatus || ride.status).toUpperCase()}`,
    note: ride.driverId ? 'Updated from the parcel ride' : '',
    at: new Date(),
  }, { fromWebhook: true });
};

const onRideUpdated = async ({ ride }) => {
  if (!ride?._id) return;
  const shipment = await CommerceShipment.findOne({ provider: 'local_porter', platform_delivery_id: String(ride._id), active: true }).lean();
  if (shipment) await syncShipmentFromRide(shipment, ride);
};

/// Every open city shipment linked to a ride, checked against the ride.
export const reconcileCityDeliveries = async () => {
  const open = await CommerceShipment.find({
    provider: 'local_porter',
    platform_delivery_id: { $ne: null },
    active: true,
    status: { $nin: TERMINAL_SHIPMENT },
  }).limit(500).lean();
  if (!open.length) return 0;
  const rides = await Ride.find({ _id: { $in: open.map((s) => s.platform_delivery_id) } }).select('status liveStatus driverId').lean();
  const byId = new Map(rides.map((r) => [String(r._id), r]));
  let changed = 0;
  for (const shipment of open) {
    // eslint-disable-next-line no-await-in-loop
    if (await syncShipmentFromRide(shipment, byId.get(String(shipment.platform_delivery_id)))) changed += 1;
  }
  return changed;
};

let registered = false;
/// Every API process: bookings and ride updates happen in whichever process handled the request.
export const registerCityDelivery = () => {
  if (registered) return;
  registered = true;
  setPlatformDeliveryBooker(bookCityDelivery);
  setPlatformDeliveryCanceller(cancelCityDelivery);
  on('taxi.delivery.updated', onRideUpdated);
};

let timer = null;
/// Leader process only (see shared/leader.js).
export const startCityDeliveryReconcile = (intervalMs = 30_000) => {
  if (timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try { await reconcileCityDeliveries(); } catch (error) { console.error('[city-delivery] reconcile failed', error.message); } finally { running = false; }
  }, intervalMs);
  timer.unref?.();
};

export const stopCityDeliveryReconcile = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
