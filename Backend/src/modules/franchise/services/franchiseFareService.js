import { Franchise, FRANCHISE_STATUS } from '../models/Franchise.js';

/// Franchise fare adjustment: an approved franchise can price its own
/// territory up or down from the platform tariff, per transport type
/// (taxi / delivery / intercity), as a multiplier between 0.5 and 2.
///
/// Applied where fares are made, never to what admins see or edit:
///   - taxi & intercity: the rider price catalog (adminService.listSetPrices,
///     non-admin path), which the apps quote from and createRideRecord bills;
///   - parcels: deliveryTariffService.resolveDeliveryTariff (server-priced).
/// It stacks with surge (surge × franchise). Commission percentages are
/// untouched; they apply to the adjusted fare.

export const MIN_FARE_MULTIPLIER = 0.5;
export const MAX_FARE_MULTIPLIER = 2;
const TTL_MS = 30_000;

let cache = { at: 0, byZone: new Map(), byCity: new Map() };

export const clearFranchiseFareCache = () => {
  cache = { at: 0, byZone: new Map(), byCity: new Map() };
};

const load = async () => {
  if (Date.now() - cache.at < TTL_MS) return cache;
  const franchises = await Franchise.find({
    status: FRANCHISE_STATUS.APPROVED,
    deletedAt: null,
    fare_multipliers: { $exists: true },
  })
    .select('service_location_ids zone_ids fare_multipliers')
    .lean();
  const byZone = new Map();
  const byCity = new Map();
  for (const f of franchises) {
    const rates = f.fare_multipliers || {};
    if (!Object.values(rates).some((v) => Number(v) > 0 && Number(v) !== 1)) continue;
    for (const id of f.zone_ids || []) byZone.set(String(id), rates);
    for (const id of f.service_location_ids || []) byCity.set(String(id), rates);
  }
  cache = { at: Date.now(), byZone, byCity };
  return cache;
};

const idOf = (v) => (v && typeof v === 'object' ? String(v._id || v.id || '') : v ? String(v) : '');

const normalizeTransport = (t) => {
  const v = String(t || 'taxi').toLowerCase();
  if (v === 'delivery' || v === 'parcel') return 'delivery';
  if (v === 'intercity' || v === 'outstation') return 'intercity';
  return 'taxi';
};

const clamp = (n) => Math.min(MAX_FARE_MULTIPLIER, Math.max(MIN_FARE_MULTIPLIER, n));

/// Multiplier for a zone / service location and transport type (1 = none).
/// A zone franchise wins over a city franchise; territories never overlap, so
/// this only matters for a zone-less tariff row.
export const getFranchiseFareMultiplier = async ({ zoneId = null, serviceLocationId = null, transportType = 'taxi' } = {}) => {
  const { byZone, byCity } = await load();
  if (!byZone.size && !byCity.size) return 1;
  const rates = byZone.get(idOf(zoneId)) || byCity.get(idOf(serviceLocationId));
  const value = Number(rates?.[normalizeTransport(transportType)]);
  return Number.isFinite(value) && value > 0 ? clamp(value) : 1;
};

/// For a list of rider-catalog rows: each row's own multiplier.
export const franchiseMultiplierForRow = async (row = {}) =>
  getFranchiseFareMultiplier({
    zoneId: row.zone_id || row.zone,
    serviceLocationId: row.service_location_id || row.service_location,
    transportType: row.transport_type === 'both' ? 'taxi' : row.transport_type,
  });
