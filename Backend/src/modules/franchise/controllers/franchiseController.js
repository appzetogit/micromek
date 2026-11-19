import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { comparePassword, hashPassword } from '../../taxi/services/passwordService.js';
import { signAccessToken } from '../../taxi/services/tokenService.js';
import { RIDE_STATUS } from '../../taxi/constants/index.js';
import { Ride } from '../../taxi/user/models/Ride.js';
import { Driver } from '../../taxi/driver/models/Driver.js';
import { Owner } from '../../taxi/admin/models/Owner.js';
import { FleetVehicle } from '../../taxi/admin/models/FleetVehicle.js';
import { SetPrice } from '../../taxi/admin/models/SetPrice.js';
import { ok, paged } from '../../shared/guards.js';
import { Franchise, FRANCHISE_STATUS } from '../models/Franchise.js';
import { FranchiseSettlement } from '../models/FranchiseSettlement.js';
import {
  assertObjectId,
  assertTerritoryFree,
  buildDriverTerritoryFilter,
  buildOwnerTerritoryFilter,
  buildRideTerritoryFilter,
  getFranchiseOr404,
  normalizeCommission,
  normalizeFareMultipliers,
  parsePaging,
  parsePeriod,
  toObjectIds,
} from '../services/franchiseService.js';
import {
  addAdjustment,
  aggregateFranchiseRides,
  generateSettlement,
  refreshSettlement,
  transitionSettlement,
} from '../services/franchiseSettlementService.js';
import { clearFranchiseFareCache } from '../services/franchiseFareService.js';

const PROFILE_FIELDS = [
  'name', 'business_type', 'contact_name', 'mobile', 'email', 'address', 'city', 'state',
  'pincode', 'gst_number', 'pan_number', 'settlement_cycle', 'contract_start', 'contract_end',
];
const pick = (src = {}, keys = []) =>
  Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

const assertPassword = (password) => {
  if (typeof password !== 'string' || password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters');
  }
};

const makeCode = async (name) => {
  const base = String(name || 'FR').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'FR';
  for (let i = 0; i < 5; i += 1) {
    const code = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await Franchise.exists({ code }))) return code;
  }
  throw new ApiError(500, 'Could not allocate a franchise code');
};

// ---------- performance ----------

export const buildPerformance = async (franchise, start, end) => {
  const territory = await buildRideTerritoryFilter(franchise);
  const driverFilter = { ...buildDriverTerritoryFilter(franchise), deletedAt: null };
  const [totals, statusCounts, driversTotal, driversOnline, rating] = await Promise.all([
    aggregateFranchiseRides(franchise, start, end),
    Ride.aggregate([
      { $match: { ...territory, createdAt: { $gte: start, $lt: end }, adminDeletedAt: null } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Driver.countDocuments(driverFilter),
    Driver.countDocuments({ ...driverFilter, isOnline: true }),
    Driver.aggregate([
      { $match: { ...driverFilter, ratingCount: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$rating' } } },
    ]),
  ]);
  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
  const requested = statusCounts.reduce((a, s) => a + s.count, 0);
  return {
    period: { from: start, to: end },
    ...totals,
    requests: requested,
    cancelled: byStatus[RIDE_STATUS.CANCELLED] || 0,
    completion_rate: requested ? Math.round(((byStatus[RIDE_STATUS.COMPLETED] || 0) / requested) * 1000) / 10 : 0,
    drivers_total: driversTotal,
    drivers_online: driversOnline,
    avg_driver_rating: rating[0]?.avg ? Math.round(rating[0].avg * 100) / 100 : null,
  };
};

// ---------- public ----------

export const applyForFranchise = asyncHandler(async (req, res) => {
  const body = req.body || {};
  for (const key of ['name', 'contact_name', 'mobile', 'email']) {
    if (!String(body[key] || '').trim()) throw new ApiError(400, `${key} is required`);
  }
  assertPassword(body.password);
  // Applicants say where they want to operate; admin confirms on approval.
  const serviceLocationIds = toObjectIds(body.service_location_ids || []);
  const zoneIds = toObjectIds(body.zone_ids || []);
  await assertTerritoryFree({ serviceLocationIds, zoneIds });

  const franchise = await Franchise.create({
    ...pick(body, PROFILE_FIELDS),
    code: await makeCode(body.name),
    password: await hashPassword(body.password),
    service_location_ids: serviceLocationIds,
    zone_ids: zoneIds,
    status: FRANCHISE_STATUS.PENDING,
  });
  return ok(res, { id: franchise._id, code: franchise.code, status: franchise.status }, 201);
});

export const franchiseLogin = asyncHandler(async (req, res) => {
  const identifier = String(req.body?.email || req.body?.mobile || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!identifier || !password) throw new ApiError(400, 'email (or mobile) and password are required');

  const franchise = await Franchise.findOne({
    deletedAt: null,
    $or: [{ email: identifier }, { mobile: identifier }],
  }).select('+password');
  // Same message for unknown account and bad password.
  if (!franchise?.password || !(await comparePassword(password, franchise.password))) {
    throw new ApiError(401, 'Invalid credentials');
  }
  if (franchise.status !== FRANCHISE_STATUS.APPROVED) {
    throw new ApiError(403, `Franchise account is ${franchise.status}`, { code: 'FRANCHISE_NOT_ACTIVE' });
  }
  franchise.last_login_at = new Date();
  await franchise.save();
  const token = signAccessToken({ sub: String(franchise._id), role: 'franchise' });
  return ok(res, { token, franchise: franchise.toJSON() });
});

// ---------- admin: franchises ----------

export const adminListFranchises = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { deletedAt: null };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.business_type) filter.business_type = String(req.query.business_type);
  if (req.query.service_location_id) filter.service_location_ids = assertObjectId(req.query.service_location_id);
  if (req.query.search) {
    const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { contact_name: rx }, { mobile: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    Franchise.find(filter)
      .populate('service_location_ids', 'name')
      .populate('zone_ids', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Franchise.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const adminCreateFranchise = asyncHandler(async (req, res) => {
  const body = req.body || {};
  for (const key of ['name', 'contact_name', 'mobile', 'email']) {
    if (!String(body[key] || '').trim()) throw new ApiError(400, `${key} is required`);
  }
  assertPassword(body.password);
  const serviceLocationIds = toObjectIds(body.service_location_ids || []);
  const zoneIds = toObjectIds(body.zone_ids || []);
  await assertTerritoryFree({ serviceLocationIds, zoneIds });

  const franchise = await Franchise.create({
    ...pick(body, PROFILE_FIELDS),
    bank: body.bank || {},
    code: body.code ? String(body.code) : await makeCode(body.name),
    password: await hashPassword(body.password),
    service_location_ids: serviceLocationIds,
    zone_ids: zoneIds,
    commission: normalizeCommission(body.commission || {}),
    fare_multipliers: { taxi: 1, delivery: 1, intercity: 1, ...normalizeFareMultipliers(body.fare_multipliers || {}) },
    // Created by an admin, so approved unless asked otherwise.
    status: body.status === FRANCHISE_STATUS.PENDING ? FRANCHISE_STATUS.PENDING : FRANCHISE_STATUS.APPROVED,
    reviewed_by: req.auth.sub,
    reviewed_at: new Date(),
  });
  clearFranchiseFareCache();
  return ok(res, franchise, 201);
});

export const adminGetFranchise = asyncHandler(async (req, res) => {
  const franchise = await getFranchiseOr404(req.params.id);
  await franchise.populate([{ path: 'service_location_ids', select: 'name' }, { path: 'zone_ids', select: 'name' }]);
  const { start, end } = parsePeriod(req.query);
  return ok(res, { franchise, performance: await buildPerformance(franchise, start, end) });
});

export const adminUpdateFranchise = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const franchise = await getFranchiseOr404(req.params.id);
  Object.assign(franchise, pick(body, PROFILE_FIELDS));
  if (body.bank) franchise.bank = { ...franchise.bank?.toObject?.(), ...body.bank };
  if (body.commission) franchise.commission = normalizeCommission(body.commission);
  if (body.fare_multipliers) {
    franchise.fare_multipliers = { ...(franchise.fare_multipliers?.toObject?.() || franchise.fare_multipliers || {}), ...normalizeFareMultipliers(body.fare_multipliers) };
  }
  if (body.service_location_ids !== undefined || body.zone_ids !== undefined) {
    const serviceLocationIds = toObjectIds(body.service_location_ids ?? franchise.service_location_ids);
    const zoneIds = toObjectIds(body.zone_ids ?? franchise.zone_ids);
    await assertTerritoryFree({ franchiseId: franchise._id, serviceLocationIds, zoneIds });
    franchise.service_location_ids = serviceLocationIds;
    franchise.zone_ids = zoneIds;
  }
  if (body.password) {
    assertPassword(body.password);
    franchise.password = await hashPassword(body.password);
  }
  await franchise.save();
  clearFranchiseFareCache();
  return ok(res, franchise);
});

const STATUS_ACTIONS = {
  approve: { from: [FRANCHISE_STATUS.PENDING, FRANCHISE_STATUS.REJECTED], to: FRANCHISE_STATUS.APPROVED },
  reject: { from: [FRANCHISE_STATUS.PENDING], to: FRANCHISE_STATUS.REJECTED },
  suspend: { from: [FRANCHISE_STATUS.APPROVED], to: FRANCHISE_STATUS.SUSPENDED },
  reactivate: { from: [FRANCHISE_STATUS.SUSPENDED], to: FRANCHISE_STATUS.APPROVED },
};

export const adminSetFranchiseStatus = asyncHandler(async (req, res) => {
  const action = STATUS_ACTIONS[req.params.action];
  if (!action) throw new ApiError(400, 'action must be approve, reject, suspend or reactivate');
  const franchise = await getFranchiseOr404(req.params.id);
  if (!action.from.includes(franchise.status)) {
    throw new ApiError(400, `Cannot ${req.params.action} a franchise that is ${franchise.status}`);
  }
  // A rejected application released its territory; re-check before approving.
  if (franchise.status === FRANCHISE_STATUS.REJECTED) {
    await assertTerritoryFree({
      franchiseId: franchise._id,
      serviceLocationIds: franchise.service_location_ids,
      zoneIds: franchise.zone_ids,
    });
  }
  franchise.status = action.to;
  franchise.status_note = String(req.body?.note || '').trim();
  franchise.reviewed_by = req.auth.sub;
  franchise.reviewed_at = new Date();
  await franchise.save();
  clearFranchiseFareCache();
  return ok(res, franchise);
});

export const adminDeleteFranchise = asyncHandler(async (req, res) => {
  const franchise = await getFranchiseOr404(req.params.id);
  const unpaid = await FranchiseSettlement.exists({ franchise_id: franchise._id, status: 'approved' });
  if (unpaid) throw new ApiError(400, 'Pay or cancel approved settlements before deleting this franchise');
  franchise.deletedAt = new Date();
  // Frees the unique mobile/email for a future applicant.
  franchise.email = `deleted+${franchise._id}@invalid.local`;
  franchise.mobile = `deleted-${franchise._id}`;
  franchise.service_location_ids = [];
  franchise.zone_ids = [];
  await franchise.save();
  clearFranchiseFareCache();
  return ok(res, { id: franchise._id, deleted: true });
});

export const adminFranchiseLeaderboard = asyncHandler(async (req, res) => {
  const { start, end } = parsePeriod(req.query);
  const franchises = await Franchise.find({ deletedAt: null, status: FRANCHISE_STATUS.APPROVED }).limit(200);
  const rows = await Promise.all(
    franchises.map(async (f) => ({
      id: f._id,
      name: f.name,
      code: f.code,
      ...(await aggregateFranchiseRides(f, start, end)),
    })),
  );
  rows.sort((a, b) => b.gross_fare - a.gross_fare);
  return ok(res, { period: { from: start, to: end }, items: rows.map(({ breakdown, ...r }) => r) });
});

// ---------- admin: settlements ----------

export const adminListSettlements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = {};
  if (req.query.franchise_id) filter.franchise_id = assertObjectId(req.query.franchise_id, 'franchise_id');
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([
    FranchiseSettlement.find(filter).populate('franchise_id', 'name code').sort({ period_start: -1 }).skip(skip).limit(limit),
    FranchiseSettlement.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const adminGetSettlement = asyncHandler(async (req, res) => {
  const settlement = await FranchiseSettlement.findById(assertObjectId(req.params.id)).populate('franchise_id', 'name code bank');
  if (!settlement) throw new ApiError(404, 'Settlement not found');
  return ok(res, settlement);
});

export const adminGenerateSettlement = asyncHandler(async (req, res) => {
  if (!req.body?.franchise_id || !req.body?.from || !req.body?.to) {
    throw new ApiError(400, 'franchise_id, from and to are required');
  }
  const { start, end } = parsePeriod(req.body);
  const settlement = await generateSettlement({
    franchiseId: req.body.franchise_id,
    start,
    end,
    notes: String(req.body.notes || ''),
  });
  return ok(res, settlement, 201);
});

export const adminRefreshSettlement = asyncHandler(async (req, res) =>
  ok(res, await refreshSettlement(assertObjectId(req.params.id))));

export const adminAdjustSettlement = asyncHandler(async (req, res) =>
  ok(res, await addAdjustment(assertObjectId(req.params.id), req.body || {}, req.auth.sub)));

export const adminTransitionSettlement = asyncHandler(async (req, res) =>
  ok(res, await transitionSettlement(assertObjectId(req.params.id), req.params.action, {
    adminId: req.auth.sub,
    ...(req.body || {}),
  })));

// ---------- franchise panel ----------

const me = (req) => req.auth.entity;

export const panelMe = asyncHandler(async (req, res) => {
  await me(req).populate([{ path: 'service_location_ids', select: 'name' }, { path: 'zone_ids', select: 'name' }]);
  return ok(res, me(req));
});

export const panelUpdateMe = asyncHandler(async (req, res) => {
  // Territory, commission and status are admin-only.
  const franchise = me(req);
  Object.assign(franchise, pick(req.body || {}, ['contact_name', 'address', 'pincode', 'gst_number', 'pan_number']));
  if (req.body?.bank) franchise.bank = { ...franchise.bank?.toObject?.(), ...req.body.bank };
  await franchise.save();
  return ok(res, franchise);
});

export const panelChangePassword = asyncHandler(async (req, res) => {
  const franchise = await getFranchiseOr404(req.auth.sub, { withPassword: true });
  if (!(await comparePassword(String(req.body?.current_password || ''), franchise.password || ''))) {
    throw new ApiError(400, 'Current password is incorrect');
  }
  assertPassword(req.body?.new_password);
  franchise.password = await hashPassword(req.body.new_password);
  await franchise.save();
  return ok(res, { changed: true });
});

export const panelDashboard = asyncHandler(async (req, res) => {
  const { start, end } = parsePeriod(req.query);
  return ok(res, await buildPerformance(me(req), start, end));
});

export const panelDrivers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { ...buildDriverTerritoryFilter(me(req)), deletedAt: null };
  if (req.query.online === 'true') filter.isOnline = true;
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([
    Driver.find(filter)
      .select('name phone email city status approve isOnline isOnRide vehicleType vehicleNumber vehicleMake vehicleModel rating ratingCount service_location_id zoneId owner_id createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Driver.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const panelOwners = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { ...buildOwnerTerritoryFilter(me(req)), deletedAt: null };
  const [items, total] = await Promise.all([
    Owner.find(filter)
      .select('company_name name mobile email city no_of_vehicles active approve status createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Owner.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const panelFleetVehicles = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const owners = await Owner.find({ ...buildOwnerTerritoryFilter(me(req)), deletedAt: null }).select('_id').lean();
  const filter = { owner_id: { $in: owners.map((o) => o._id) } };
  const [items, total] = await Promise.all([
    FleetVehicle.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    FleetVehicle.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const panelRides = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const { start, end } = parsePeriod(req.query);
  const filter = {
    ...(await buildRideTerritoryFilter(me(req))),
    createdAt: { $gte: start, $lt: end },
    adminDeletedAt: null,
  };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.transport_type) filter.transport_type = String(req.query.transport_type);
  const [items, total] = await Promise.all([
    Ride.find(filter)
      .select('status transport_type serviceType pickupAddress dropAddress fare commissionAmount paymentMethod driverId createdAt completedAt')
      .populate('driverId', 'name phone vehicleNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Ride.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const panelFares = asyncHandler(async (req, res) => {
  const franchise = me(req);
  const items = await SetPrice.find({
    $or: [
      { service_location_id: { $in: franchise.service_location_ids } },
      { zone_id: { $in: franchise.zone_ids } },
    ],
  }).lean();
  return ok(res, { items, commission: franchise.commission, fare_multipliers: franchise.fare_multipliers });
});

export const panelSettlements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { franchise_id: me(req)._id, status: { $ne: 'cancelled' } };
  const [items, total] = await Promise.all([
    FranchiseSettlement.find(filter).sort({ period_start: -1 }).skip(skip).limit(limit),
    FranchiseSettlement.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const panelSettlement = asyncHandler(async (req, res) => {
  const settlement = await FranchiseSettlement.findOne({ _id: assertObjectId(req.params.id), franchise_id: me(req)._id });
  if (!settlement) throw new ApiError(404, 'Settlement not found');
  return ok(res, settlement);
});
