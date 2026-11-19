import crypto from 'node:crypto';
import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok, paged } from '../../shared/guards.js';
import { Driver } from '../../taxi/driver/models/Driver.js';
import { FleetVehicle } from '../../taxi/admin/models/FleetVehicle.js';
import { ServiceLocation } from '../../taxi/admin/models/ServiceLocation.js';
import { Franchise } from '../../franchise/models/Franchise.js';
import { assertObjectId, parsePaging, parsePeriod } from '../../franchise/services/franchiseService.js';
import { getProvider } from '../providers/index.js';
import { EvVehicle, EV_VEHICLE_STATUS } from '../models/EvVehicle.js';
import { EvTrip, EV_TRIP_STATUS } from '../models/EvTrip.js';
import { EvAlert, EV_ALERT_STATUS, EV_ALERT_TYPES } from '../models/EvAlert.js';
import { finalizeTrip, getRuleOptions } from '../services/evRules.js';
import {
  getIngestState,
  ingestWebhook,
  pollOnce,
  syncVehiclesFromProvider,
} from '../services/evIngestService.js';
import {
  getDashboard,
  getTelemetryHistory,
  getUtilisation,
  getVehicleInScope,
  isOnline,
  scopedVehicleIds,
  toCsv,
  UTILISATION_CSV_COLUMNS,
  vehicleScopeFilter,
} from '../services/evReportService.js';

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Admin sees everything (optionally narrowed by query); a franchise sees only its vehicles.
const adminScope = (req) => ({
  franchiseId: req.query.franchise_id ? assertObjectId(req.query.franchise_id, 'franchise_id') : null,
  serviceLocationId: req.query.service_location_id ? assertObjectId(req.query.service_location_id, 'service_location_id') : null,
});
const franchiseScope = (req) => ({ franchiseId: req.auth.entity._id });

// ---------------------------------------------------------------- vehicles

const VEHICLE_FIELDS = [
  'registration_no', 'vin', 'make', 'model', 'year', 'battery_capacity_kwh', 'provider', 'external_id',
  'status', 'low_battery_threshold_pct', 'capabilities', 'notes',
];
const LINKS = {
  fleet_vehicle_id: { model: FleetVehicle, label: 'fleet vehicle' },
  driver_id: { model: Driver, label: 'driver' },
  franchise_id: { model: Franchise, label: 'franchise' },
  service_location_id: { model: ServiceLocation, label: 'service location' },
};

const pickVehicle = async (body = {}) => {
  const out = {};
  for (const key of VEHICLE_FIELDS) if (body[key] !== undefined) out[key] = body[key];
  if (out.status !== undefined && !Object.values(EV_VEHICLE_STATUS).includes(out.status)) {
    throw new ApiError(400, `status must be one of ${Object.values(EV_VEHICLE_STATUS).join(', ')}`);
  }
  if (out.low_battery_threshold_pct !== undefined) {
    const n = Number(out.low_battery_threshold_pct);
    if (!Number.isFinite(n) || n < 1 || n > 99) throw new ApiError(400, 'low_battery_threshold_pct must be 1-99');
    out.low_battery_threshold_pct = n;
  }
  if (out.capabilities !== undefined && (typeof out.capabilities !== 'object' || Array.isArray(out.capabilities))) {
    throw new ApiError(400, 'capabilities must be an object of flags');
  }
  for (const [key, { model, label }] of Object.entries(LINKS)) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === '') {
      out[key] = null;
      continue;
    }
    const id = assertObjectId(body[key], key);
    // eslint-disable-next-line no-await-in-loop
    if (!(await model.exists({ _id: id }))) throw new ApiError(400, `${label} not found`);
    out[key] = id;
  }
  return out;
};

const duplicateToApiError = (error) => {
  if (error?.code === 11000) {
    return new ApiError(409, 'An EV vehicle with this registration number or provider id already exists', {
      code: 'EV_VEHICLE_EXISTS',
      fields: Object.keys(error.keyPattern || {}),
    });
  }
  return error;
};

const listVehicles = (scopeOf) => asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = vehicleScopeFilter(scopeOf(req));
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.charging === 'true') filter['last_telemetry.charging_state'] = { $in: ['charging', 'fast_charging'] };
  if (req.query.low_battery === 'true') filter.$expr = { $lt: ['$last_telemetry.soc_pct', '$low_battery_threshold_pct'] };
  if (req.query.search) {
    const rx = new RegExp(escapeRx(req.query.search), 'i');
    filter.$or = [{ registration_no: rx }, { external_id: rx }, { vin: rx }, { make: rx }, { model: rx }];
  }
  const [items, total] = await Promise.all([
    EvVehicle.find(filter)
      .select('-trip_state')
      .populate('driver_id', 'name phone')
      .populate('franchise_id', 'name code')
      .populate('service_location_id', 'name')
      .sort({ registration_no: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EvVehicle.countDocuments(filter),
  ]);
  const now = new Date();
  const opts = getRuleOptions();
  return paged(res, { items: items.map((v) => ({ ...v, online: isOnline(v, now, opts) })), total, page, limit });
});

const getVehicle = (scopeOf) => asyncHandler(async (req, res) => {
  const vehicle = await getVehicleInScope(assertObjectId(req.params.id, 'vehicle id'), scopeOf(req));
  await vehicle.populate([
    { path: 'driver_id', select: 'name phone vehicleNumber' },
    { path: 'franchise_id', select: 'name code' },
    { path: 'service_location_id', select: 'name' },
    { path: 'fleet_vehicle_id', select: 'license_plate_number car_brand car_model' },
  ]);
  const [openTrip, recentTrips, alerts] = await Promise.all([
    vehicle.trip_state?.open_trip_id ? EvTrip.findById(vehicle.trip_state.open_trip_id).lean() : null,
    EvTrip.find({ vehicle_id: vehicle._id, status: EV_TRIP_STATUS.COMPLETED }).sort({ started_at: -1 }).limit(5).lean(),
    EvAlert.find({ vehicle_id: vehicle._id, active: true }).sort({ raised_at: -1 }).lean(),
  ]);
  const provider = getProvider();
  return ok(res, {
    vehicle,
    online: isOnline(vehicle),
    capabilities: { ...(vehicle.provider === provider.name ? provider.capabilities : {}), ...(vehicle.capabilities || {}) },
    open_trip: openTrip,
    recent_trips: recentTrips,
    live_alerts: alerts,
  });
});

const telemetryHistory = (scopeOf) => asyncHandler(async (req, res) => {
  const vehicle = await getVehicleInScope(assertObjectId(req.params.id, 'vehicle id'), scopeOf(req));
  const { start, end } = parsePeriod(req.query, { defaultDays: 1 });
  if (end - start > 92 * 86400000) throw new ApiError(400, 'History range is limited to 92 days');
  const history = await getTelemetryHistory(vehicle._id, { start, end, bucket: req.query.bucket ? String(req.query.bucket) : 'auto' });
  return ok(res, { vehicle_id: vehicle._id, from: start, to: end, ...history });
});

// ---------------------------------------------------------------- link pickers

/// Search configs for GET /admin/ev/lookups?type=&search=&id=. Read-only over the taxi models.
const LOOKUPS = {
  driver: {
    model: Driver,
    base: { deletedAt: null },
    fields: ['name', 'phone', 'vehicleNumber'],
    select: 'name phone vehicleNumber',
    sort: { name: 1 },
    label: (d) => [d.name, d.phone, d.vehicleNumber].filter(Boolean).join(' · '),
  },
  fleet_vehicle: {
    model: FleetVehicle,
    base: {},
    fields: ['license_plate_number', 'car_brand', 'car_model'],
    select: 'license_plate_number car_brand car_model',
    sort: { license_plate_number: 1 },
    label: (v) => [v.license_plate_number, [v.car_brand, v.car_model].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
  },
  service_location: {
    model: ServiceLocation,
    base: {},
    fields: ['name', 'service_location_name'],
    select: 'name service_location_name',
    sort: { name: 1 },
    label: (l) => l.name || l.service_location_name,
  },
};
export const EV_LOOKUP_TYPES = Object.keys(LOOKUPS);

/// [{ id, label }], at most 20. `id` returns just that record (to label a saved link).
export const adminLookups = asyncHandler(async (req, res) => {
  const type = String(req.query.type || '');
  const cfg = LOOKUPS[type];
  if (!cfg) throw new ApiError(400, `type must be one of ${EV_LOOKUP_TYPES.join(', ')}`);
  let filter = { ...cfg.base };
  if (req.query.id) {
    filter = { _id: assertObjectId(req.query.id, 'id') };
  } else if (req.query.search && String(req.query.search).trim()) {
    const rx = new RegExp(escapeRx(String(req.query.search).trim().slice(0, 60)), 'i');
    filter.$or = cfg.fields.map((f) => ({ [f]: rx }));
  }
  const docs = await cfg.model.find(filter).select(cfg.select).sort(cfg.sort).limit(20).lean();
  return ok(res, docs.map((d) => ({ id: String(d._id), label: cfg.label(d) || String(d._id) })));
});

export const adminCreateVehicle = asyncHandler(async (req, res) => {
  const data = await pickVehicle(req.body);
  for (const key of ['registration_no', 'external_id']) {
    if (!String(data[key] || '').trim()) throw new ApiError(400, `${key} is required`);
  }
  const provider = getProvider();
  if (!data.provider) {
    if (!provider.enabled) throw new ApiError(400, 'provider is required while no EV provider is configured');
    data.provider = provider.name;
  }
  if (!data.capabilities && data.provider === provider.name) data.capabilities = { ...provider.capabilities };
  try {
    return ok(res, await EvVehicle.create(data), 201);
  } catch (error) {
    throw duplicateToApiError(error);
  }
});

export const adminUpdateVehicle = asyncHandler(async (req, res) => {
  const vehicle = await getVehicleInScope(assertObjectId(req.params.id, 'vehicle id'));
  const data = await pickVehicle(req.body);
  const identityChanged = (data.provider !== undefined && data.provider !== vehicle.provider)
    || (data.external_id !== undefined && data.external_id !== vehicle.external_id);
  Object.assign(vehicle, data);
  if (identityChanged) {
    // New device: the old snapshot and trip no longer describe it.
    vehicle.last_telemetry = {};
    vehicle.trip_state = { open_trip_id: null, last_moving_at: null };
  }
  try {
    await vehicle.save();
  } catch (error) {
    throw duplicateToApiError(error);
  }
  return ok(res, vehicle);
});

export const adminDeleteVehicle = asyncHandler(async (req, res) => {
  const vehicle = await getVehicleInScope(assertObjectId(req.params.id, 'vehicle id'));
  const now = new Date();
  if (vehicle.trip_state?.open_trip_id) {
    const trip = await EvTrip.findById(vehicle.trip_state.open_trip_id);
    if (trip?.status === EV_TRIP_STATUS.OPEN) {
      finalizeTrip(trip, trip.last_point, { batteryCapacityKwh: vehicle.battery_capacity_kwh });
      await trip.save();
    }
  }
  await EvAlert.updateMany(
    { vehicle_id: vehicle._id, active: true },
    { $set: { active: false, status: EV_ALERT_STATUS.RESOLVED, resolved_at: now, resolved_by: req.auth.sub, resolution_note: 'Vehicle deleted' } },
  );
  vehicle.deletedAt = now;
  vehicle.status = EV_VEHICLE_STATUS.INACTIVE;
  // Frees the unique registration / provider id for re-registration.
  vehicle.registration_no = `DELETED-${vehicle._id}`;
  vehicle.external_id = `deleted:${vehicle._id}:${vehicle.external_id}`;
  vehicle.trip_state = { open_trip_id: null, last_moving_at: null };
  await vehicle.save();
  return ok(res, { id: vehicle._id, deleted: true });
});

// ---------------------------------------------------------------- provider / ingest

export const adminProviderStatus = asyncHandler(async (_req, res) => {
  const provider = getProvider();
  const vehicles = await EvVehicle.countDocuments({ provider: provider.name, deletedAt: null });
  return ok(res, {
    provider: await provider.status(),
    webhook: {
      supported: typeof provider.parseWebhook === 'function',
      secret_configured: Boolean(process.env.EV_WEBHOOK_SECRET),
      path: `/webhooks/ev/${provider.name}`,
    },
    vehicles_on_provider: vehicles,
    rules: getRuleOptions(),
    ingest: getIngestState(),
  });
});

export const adminPollNow = asyncHandler(async (_req, res) => ok(res, await pollOnce()));

export const adminSyncVehicles = asyncHandler(async (req, res) => {
  const dryRun = req.query.dry_run === 'true' || req.body?.dry_run === true;
  return ok(res, { dry_run: dryRun, ...(await syncVehiclesFromProvider({ create: !dryRun })) });
});

// ---------------------------------------------------------------- dashboard / trips / alerts / reports

const dashboard = (scopeOf) => asyncHandler(async (req, res) => ok(res, await getDashboard(scopeOf(req))));

/// Filter on vehicle_id limited to the caller's vehicles (and one vehicle if asked).
const vehicleIdFilter = async (req, scope) => {
  if (req.query.vehicle_id) {
    const vehicle = await getVehicleInScope(assertObjectId(req.query.vehicle_id, 'vehicle_id'), scope);
    return vehicle._id;
  }
  if (!scope.franchiseId && !scope.serviceLocationId) return null;
  return { $in: await scopedVehicleIds(scope) };
};

const listTrips = (scopeOf) => asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const { start, end } = parsePeriod(req.query, { defaultDays: 7 });
  const filter = { started_at: { $gte: start, $lt: end } };
  const vehicleFilter = await vehicleIdFilter(req, scopeOf(req));
  if (vehicleFilter) filter.vehicle_id = vehicleFilter;
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([
    EvTrip.find(filter)
      .select('-last_point')
      .populate('vehicle_id', 'registration_no make model')
      .populate('driver_id', 'name phone')
      .sort({ started_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EvTrip.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

const getTrip = (scopeOf) => asyncHandler(async (req, res) => {
  const trip = await EvTrip.findById(assertObjectId(req.params.id, 'trip id'))
    .populate('driver_id', 'name phone')
    .lean();
  if (!trip) throw new ApiError(404, 'Trip not found');
  const vehicle = await getVehicleInScope(trip.vehicle_id, scopeOf(req)).catch(() => {
    throw new ApiError(404, 'Trip not found');
  });
  // The route: raw points (bucketed if long) between start and end.
  const end = trip.ended_at || new Date();
  const route = await getTelemetryHistory(vehicle._id, {
    start: new Date(trip.started_at),
    end: new Date(new Date(end).getTime() + 1000),
    bucket: req.query.bucket ? String(req.query.bucket) : 'auto',
  });
  return ok(res, {
    trip,
    vehicle: { id: vehicle._id, registration_no: vehicle.registration_no, make: vehicle.make, model: vehicle.model },
    route,
  });
});

const listAlerts = (scopeOf) => asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = {};
  const vehicleFilter = await vehicleIdFilter(req, scopeOf(req));
  if (vehicleFilter) filter.vehicle_id = vehicleFilter;
  if (req.query.status === 'live') filter.active = true;
  else if (req.query.status) filter.status = String(req.query.status);
  if (req.query.type) {
    if (!EV_ALERT_TYPES.includes(String(req.query.type))) throw new ApiError(400, `type must be one of ${EV_ALERT_TYPES.join(', ')}`);
    filter.type = String(req.query.type);
  }
  if (req.query.severity) filter.severity = String(req.query.severity);
  if (req.query.from || req.query.to) {
    const { start, end } = parsePeriod(req.query);
    filter.raised_at = { $gte: start, $lt: end };
  }
  const [items, total] = await Promise.all([
    EvAlert.find(filter)
      .populate('vehicle_id', 'registration_no make model')
      .sort({ active: -1, raised_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EvAlert.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const adminAlertAction = asyncHandler(async (req, res) => {
  const alert = await EvAlert.findById(assertObjectId(req.params.id, 'alert id'));
  if (!alert) throw new ApiError(404, 'Alert not found');
  const now = new Date();
  if (req.params.action === 'acknowledge') {
    if (alert.status !== EV_ALERT_STATUS.OPEN) throw new ApiError(400, `Cannot acknowledge an alert that is ${alert.status}`);
    alert.status = EV_ALERT_STATUS.ACKNOWLEDGED;
    alert.acknowledged_at = now;
    alert.acknowledged_by = req.auth.sub;
  } else if (req.params.action === 'resolve') {
    if (alert.status === EV_ALERT_STATUS.RESOLVED) throw new ApiError(400, 'Alert is already resolved');
    // If the condition still holds, the next poll raises a fresh alert.
    alert.status = EV_ALERT_STATUS.RESOLVED;
    alert.active = false;
    alert.resolved_at = now;
    alert.resolved_by = req.auth.sub;
    alert.resolution_note = String(req.body?.note || 'Resolved manually').trim();
  } else {
    throw new ApiError(400, 'action must be acknowledge or resolve');
  }
  await alert.save();
  return ok(res, alert);
});

const utilisation = (scopeOf) => asyncHandler(async (req, res) => {
  const { start, end } = parsePeriod(req.query);
  if (end - start > 366 * 86400000) throw new ApiError(400, 'Report range is limited to 366 days');
  const scope = scopeOf(req);
  const vehicleId = req.query.vehicle_id ? assertObjectId(req.query.vehicle_id, 'vehicle_id') : null;
  const report = await getUtilisation(scope, { start, end, vehicleId });
  if (req.query.format === 'csv') {
    const name = `ev-utilisation-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.send(toCsv(report.items, UTILISATION_CSV_COLUMNS));
  }
  return ok(res, report);
});

// ---------------------------------------------------------------- webhook

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

/// Shared-secret check in constant time (hashing first evens out lengths).
/// Rejects everything while EV_WEBHOOK_SECRET is unset.
export const verifyWebhookSecret = (provided, expected = process.env.EV_WEBHOOK_SECRET) => {
  if (!expected) return false;
  if (!provided) return false;
  return crypto.timingSafeEqual(sha(provided), sha(expected));
};

export const webhookIngest = asyncHandler(async (req, res) => {
  if (!process.env.EV_WEBHOOK_SECRET) throw new ApiError(503, 'EV webhook is not configured');
  const provided = req.get('x-ev-webhook-secret')
    || (String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1];
  if (!verifyWebhookSecret(provided)) throw new ApiError(401, 'Invalid webhook secret');
  const provider = getProvider();
  if (!provider.enabled) throw new ApiError(503, provider.disabledReason);
  if (String(req.params.provider).toLowerCase() !== provider.name) {
    throw new ApiError(404, `Provider ${req.params.provider} is not the active EV provider`);
  }
  const { summary } = await ingestWebhook(req);
  return ok(res, summary, 202);
});

// ---------------------------------------------------------------- exports per panel

export const adminListVehicles = listVehicles(adminScope);
export const adminGetVehicle = getVehicle(adminScope);
export const adminTelemetryHistory = telemetryHistory(adminScope);
export const adminDashboard = dashboard(adminScope);
export const adminListTrips = listTrips(adminScope);
export const adminGetTrip = getTrip(adminScope);
export const adminListAlerts = listAlerts(adminScope);
export const adminUtilisation = utilisation(adminScope);

export const panelListVehicles = listVehicles(franchiseScope);
export const panelGetVehicle = getVehicle(franchiseScope);
export const panelTelemetryHistory = telemetryHistory(franchiseScope);
export const panelDashboard = dashboard(franchiseScope);
export const panelListTrips = listTrips(franchiseScope);
export const panelGetTrip = getTrip(franchiseScope);
export const panelListAlerts = listAlerts(franchiseScope);
export const panelUtilisation = utilisation(franchiseScope);
