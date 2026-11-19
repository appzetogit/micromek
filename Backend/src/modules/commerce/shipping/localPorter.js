import crypto from 'node:crypto';
import { ApiError } from '../../../utils/ApiError.js';
import { round2 } from '../services/pricing.js';
import { SHIPMENT_STATUSES } from './status.js';

/// City delivery by the platform's own parcel (Porter-style) drivers.
///
/// For now a booking only creates the shipment in `pending_assignment` with
/// pickup = store and drop = customer address. Staff (or the future taxi-side
/// integration) move it on via POST /commerce/staff/shipments/:id/status or the
/// webhook route with provider=local_porter.
///
/// INTEGRATION HOOK: set a booker with `setPlatformDeliveryBooker(fn)` from the
/// taxi delivery module (fn({ shipment, order }) -> { delivery_id, status? })
/// to create a real taxi-platform Delivery. This module never imports taxi code.
///
/// Env (optional): COMMERCE_LOCAL_BASE_FARE (40), COMMERCE_LOCAL_PER_KM (10),
/// COMMERCE_LOCAL_MAX_KM (30). Disable with COMMERCE_LOCAL_DELIVERY=off.
let platformDeliveryBooker = null;
export const setPlatformDeliveryBooker = (fn) => {
  platformDeliveryBooker = typeof fn === 'function' ? fn : null;
};

let platformDeliveryCanceller = null;
/// fn(shipment): cancels the platform ride behind a shipment (integrations/commerceCityDelivery.js).
export const setPlatformDeliveryCanceller = (fn) => {
  platformDeliveryCanceller = typeof fn === 'function' ? fn : null;
};

const num = (key, fallback) => (Number.isFinite(Number(process.env[key])) && process.env[key] !== '' ? Number(process.env[key]) : fallback);
const isEnabled = () => String(process.env.COMMERCE_LOCAL_DELIVERY || 'on').toLowerCase() !== 'off';

export const haversineKm = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

const hasPoint = (p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) && !(Number(p.lat) === 0 && Number(p.lng) === 0);

export const localPorter = {
  name: 'local_porter',
  isEnabled,

  /// Same-city only: same city name, or within COMMERCE_LOCAL_MAX_KM when both points are known.
  async quoteRates(shipment) {
    if (!isEnabled()) throw new ApiError(503, 'Local delivery is disabled (COMMERCE_LOCAL_DELIVERY=off)', { code: 'SHIPPING_PROVIDER_DISABLED' });
    const { pickup = {}, drop = {} } = shipment;
    const km = hasPoint(pickup) && hasPoint(drop) ? haversineKm(pickup, drop) : null;
    const sameCity = pickup.city && drop.city && pickup.city.trim().toLowerCase() === drop.city.trim().toLowerCase();
    const maxKm = num('COMMERCE_LOCAL_MAX_KM', 30);
    if (km !== null ? km > maxKm : !sameCity) return [];
    const rate = round2(num('COMMERCE_LOCAL_BASE_FARE', 40) + num('COMMERCE_LOCAL_PER_KM', 10) * Math.ceil(km ?? 0));
    return [{ provider: 'local_porter', courier_id: 'platform', courier_name: 'City delivery', rate, distance_km: km === null ? null : round2(km), estimated_days: 0 }];
  },

  async createShipment(order, shipment) {
    if (!isEnabled()) throw new ApiError(503, 'Local delivery is disabled (COMMERCE_LOCAL_DELIVERY=off)', { code: 'SHIPPING_PROVIDER_DISABLED' });
    const result = {
      status: 'pending_assignment',
      raw_status: 'PENDING_ASSIGNMENT',
      awb: `LP${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
      courier_id: 'platform',
      courier_name: 'City delivery',
    };
    if (platformDeliveryBooker) {
      const booked = await platformDeliveryBooker({ shipment, order });
      if (booked?.delivery_id) result.platform_delivery_id = String(booked.delivery_id);
      if (booked?.status && SHIPMENT_STATUSES.includes(booked.status)) result.status = booked.status;
    }
    return result;
  },

  /// Status comes from staff / the platform hook, not polling.
  async track() {
    return null;
  },

  async cancel(shipment) {
    if (platformDeliveryCanceller && shipment?.platform_delivery_id) await platformDeliveryCanceller(shipment);
    return { cancelled: true };
  },

  /// Internal: { awb, status } where status is already one of SHIPMENT_STATUSES.
  parseWebhook(req) {
    const b = req.body || {};
    const status = SHIPMENT_STATUSES.includes(b.status) ? b.status : null;
    return { awb: b.awb ? String(b.awb) : null, raw_status: String(b.status || ''), status, location: b.location || '', at: new Date(), note: b.note || '' };
  },
};
