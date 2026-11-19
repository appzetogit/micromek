import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { Zone } from '../../taxi/driver/models/Zone.js';
import { ServiceLocation } from '../../taxi/admin/models/ServiceLocation.js';
import { Franchise, FRANCHISE_STATUS, SHARE_TYPES } from '../models/Franchise.js';

const { ObjectId } = mongoose.Types;

export const toObjectIds = (values = []) => {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map((v) => String(v || '').trim()).filter(Boolean))].map((id) => {
    if (!ObjectId.isValid(id)) throw new ApiError(400, `Invalid id: ${id}`);
    return new ObjectId(id);
  });
};

export const assertObjectId = (id, label = 'id') => {
  if (!ObjectId.isValid(String(id || ''))) throw new ApiError(400, `Invalid ${label}`);
  return new ObjectId(String(id));
};

export const getFranchiseOr404 = async (id, { withPassword = false } = {}) => {
  const query = Franchise.findOne({ _id: assertObjectId(id, 'franchise id'), deletedAt: null });
  if (withPassword) query.select('+password');
  const franchise = await query;
  if (!franchise) throw new ApiError(404, 'Franchise not found');
  return franchise;
};

/// Refuses a territory already held by another live franchise. A city collides
/// with a city, a zone with the same zone, and a city with any zone inside it.
export const assertTerritoryFree = async ({ franchiseId = null, serviceLocationIds = [], zoneIds = [] }) => {
  const slIds = toObjectIds(serviceLocationIds);
  const zIds = toObjectIds(zoneIds);
  if (!slIds.length && !zIds.length) return;

  const [cities, zones] = await Promise.all([
    slIds.length ? ServiceLocation.find({ _id: { $in: slIds } }).select('_id name').lean() : [],
    zIds.length ? Zone.find({ _id: { $in: zIds } }).select('_id name service_location_id').lean() : [],
  ]);
  if (cities.length !== slIds.length) throw new ApiError(400, 'One or more service locations do not exist');
  if (zones.length !== zIds.length) throw new ApiError(400, 'One or more zones do not exist');

  // Zones inside the requested cities, and the cities around the requested zones.
  const zonesInCities = slIds.length
    ? await Zone.find({ service_location_id: { $in: slIds } }).select('_id').lean()
    : [];
  const parentCityIds = zones.map((z) => z.service_location_id).filter(Boolean);

  const others = await Franchise.find({
    _id: { $ne: franchiseId },
    deletedAt: null,
    status: { $in: [FRANCHISE_STATUS.PENDING, FRANCHISE_STATUS.APPROVED, FRANCHISE_STATUS.SUSPENDED] },
    $or: [
      { service_location_ids: { $in: [...slIds, ...parentCityIds] } },
      { zone_ids: { $in: [...zIds, ...zonesInCities.map((z) => z._id)] } },
    ],
  })
    .select('name code')
    .lean();

  if (others.length) {
    throw new ApiError(409, 'Territory is already allocated to another franchise', {
      code: 'TERRITORY_TAKEN',
      franchises: others.map((f) => ({ id: f._id, name: f.name, code: f.code })),
    });
  }
};

export const normalizeShareRule = (rule = {}, label = 'commission') => {
  const type = String(rule.type || 'percent_of_commission');
  const value = Number(rule.value ?? 0);
  if (!SHARE_TYPES.includes(type)) throw new ApiError(400, `${label}.type must be one of ${SHARE_TYPES.join(', ')}`);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new ApiError(400, `${label}.value must be a percentage between 0 and 100`);
  }
  return { type, value };
};

export const normalizeCommission = (commission = {}) => {
  const result = { default: normalizeShareRule(commission.default || {}, 'commission.default') };
  const byType = {};
  for (const [transportType, rule] of Object.entries(commission.by_transport_type || {})) {
    byType[transportType] = normalizeShareRule(rule, `commission.by_transport_type.${transportType}`);
  }
  result.by_transport_type = byType;
  return result;
};

export const normalizeFareMultipliers = (input = {}) => {
  const out = {};
  for (const key of ['taxi', 'delivery', 'intercity']) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < 0.5 || value > 2) {
      throw new ApiError(400, `fare_multipliers.${key} must be between 0.5 and 2 (1 = platform price)`);
    }
    out[key] = Math.round(value * 1000) / 1000;
  }
  return out;
};

export const ruleFor = (franchise, transportType) => {
  const byType = franchise.commission?.by_transport_type;
  const specific = byType instanceof Map ? byType.get(transportType) : byType?.[transportType];
  return specific || franchise.commission?.default || { type: 'percent_of_commission', value: 0 };
};

export const computeShare = (rule, { fare = 0, commission = 0 }) => {
  const base = rule.type === 'percent_of_fare' ? fare : commission;
  return round2((base * Number(rule.value || 0)) / 100);
};

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/// Mongo filter for rides (taxi, parcel and intercity are all TaxiRide docs)
/// that fall in a franchise's territory: picked up in one of its cities, or
/// inside one of its zones.
export const buildRideTerritoryFilter = async (franchise) => {
  const or = [];
  if (franchise.service_location_ids?.length) {
    or.push({ service_location_id: { $in: franchise.service_location_ids } });
  }
  if (franchise.zone_ids?.length) {
    const zones = await Zone.find({ _id: { $in: franchise.zone_ids } }).select('geometry').lean();
    for (const zone of zones) {
      if (zone.geometry?.coordinates?.length) {
        or.push({ pickupLocation: { $geoWithin: { $geometry: zone.geometry } } });
      }
    }
  }
  // No territory → match nothing rather than everything.
  return or.length ? { $or: or } : { _id: { $in: [] } };
};

export const buildDriverTerritoryFilter = (franchise) => {
  const or = [];
  if (franchise.service_location_ids?.length) or.push({ service_location_id: { $in: franchise.service_location_ids } });
  if (franchise.zone_ids?.length) or.push({ zoneId: { $in: franchise.zone_ids } });
  return or.length ? { $or: or } : { _id: { $in: [] } };
};

export const buildOwnerTerritoryFilter = (franchise) =>
  franchise.service_location_ids?.length
    ? { service_location_id: { $in: franchise.service_location_ids } }
    : { _id: { $in: [] } };

export const parsePeriod = (query = {}, { defaultDays = 30 } = {}) => {
  const end = query.to ? new Date(query.to) : new Date();
  const start = query.from ? new Date(query.from) : new Date(end.getTime() - defaultDays * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ApiError(400, 'Invalid from/to date');
  if (start >= end) throw new ApiError(400, '`from` must be before `to`');
  return { start, end };
};

export const parsePaging = (query = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};
