import { ApiError } from '../../../utils/ApiError.js';
import { EvVehicle } from '../models/EvVehicle.js';
import { EvTelemetry } from '../models/EvTelemetry.js';
import { EvTrip, EV_TRIP_STATUS } from '../models/EvTrip.js';
import { EvAlert } from '../models/EvAlert.js';
import { getRuleOptions, round } from './evRules.js';

/// Read models shared by the admin and franchise panels. `scope` is
/// `{ franchiseId }` for a franchise (only its vehicles) or `{}` / admin
/// filters for the admin panel.

export const vehicleScopeFilter = (scope = {}) => {
  const filter = { deletedAt: null };
  if (scope.franchiseId) filter.franchise_id = scope.franchiseId;
  if (scope.serviceLocationId) filter.service_location_id = scope.serviceLocationId;
  return filter;
};

export const scopedVehicleIds = async (scope) =>
  (await EvVehicle.find(vehicleScopeFilter(scope)).select('_id').lean()).map((v) => v._id);

export const getVehicleInScope = async (id, scope = {}) => {
  const vehicle = await EvVehicle.findOne({ ...vehicleScopeFilter(scope), _id: id });
  if (!vehicle) throw new ApiError(404, 'EV vehicle not found');
  return vehicle;
};

export const isOnline = (vehicle, now = new Date(), opts = getRuleOptions()) => {
  const at = vehicle.last_telemetry?.recorded_at;
  return Boolean(at) && now.getTime() - new Date(at).getTime() <= opts.offlineMinutes * 60000;
};

const isCharging = (v) => ['charging', 'fast_charging'].includes(v.last_telemetry?.charging_state);
const isLow = (v) => {
  const soc = v.last_telemetry?.soc_pct;
  return soc !== null && soc !== undefined && soc < (v.low_battery_threshold_pct || 20);
};

export const mapPoint = (v, now, opts) => ({
  id: v._id,
  registration_no: v.registration_no,
  make: v.make,
  model: v.model,
  status: v.status,
  lat: v.last_telemetry?.location?.lat ?? null,
  lng: v.last_telemetry?.location?.lng ?? null,
  heading: v.last_telemetry?.heading ?? null,
  speed_kmh: v.last_telemetry?.speed_kmh ?? null,
  soc_pct: v.last_telemetry?.soc_pct ?? null,
  range_km: v.last_telemetry?.range_km ?? null,
  charging_state: v.last_telemetry?.charging_state || 'unknown',
  ignition: v.last_telemetry?.ignition ?? null,
  recorded_at: v.last_telemetry?.recorded_at || null,
  online: isOnline(v, now, opts),
  low_battery: isLow(v),
});

/// Fleet dashboard: counts, battery picture, live alerts and map points.
/// Computed in memory from vehicle snapshots, fine into the low thousands of vehicles.
export const getDashboard = async (scope = {}, now = new Date()) => {
  const opts = getRuleOptions();
  const vehicles = await EvVehicle.find(vehicleScopeFilter(scope))
    .select('registration_no make model status last_telemetry low_battery_threshold_pct')
    .lean();
  const byStatus = { active: 0, inactive: 0, maintenance: 0 };
  let socSum = 0;
  let socCount = 0;
  let sohSum = 0;
  let sohCount = 0;
  const counts = { charging: 0, low_battery: 0, offline: 0, online: 0, moving: 0, never_reported: 0 };
  for (const v of vehicles) {
    byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    if (v.status === 'inactive') continue;
    const t = v.last_telemetry || {};
    if (!t.recorded_at) counts.never_reported += 1;
    if (isOnline(v, now, opts)) counts.online += 1;
    else counts.offline += 1;
    if (isCharging(v)) counts.charging += 1;
    if (isLow(v)) counts.low_battery += 1;
    if ((t.speed_kmh || 0) >= opts.tripMinSpeedKmh) counts.moving += 1;
    if (t.soc_pct !== null && t.soc_pct !== undefined) { socSum += t.soc_pct; socCount += 1; }
    if (t.soh_pct !== null && t.soh_pct !== undefined) { sohSum += t.soh_pct; sohCount += 1; }
  }
  const ids = vehicles.map((v) => v._id);
  const alertCounts = await EvAlert.aggregate([
    { $match: { vehicle_id: { $in: ids }, active: true } },
    { $group: { _id: { type: '$type', severity: '$severity' }, count: { $sum: 1 } } },
  ]);
  const alerts = { total: 0, by_type: {}, by_severity: {} };
  for (const a of alertCounts) {
    alerts.total += a.count;
    alerts.by_type[a._id.type] = (alerts.by_type[a._id.type] || 0) + a.count;
    alerts.by_severity[a._id.severity] = (alerts.by_severity[a._id.severity] || 0) + a.count;
  }
  return {
    generated_at: now,
    total: vehicles.length,
    by_status: byStatus,
    ...counts,
    avg_soc_pct: socCount ? round(socSum / socCount, 1) : null,
    avg_soh_pct: sohCount ? round(sohSum / sohCount, 1) : null,
    open_alerts: alerts,
    offline_after_minutes: opts.offlineMinutes,
    map: vehicles.filter((v) => v.status !== 'inactive' && v.last_telemetry?.location?.lat !== undefined
      && v.last_telemetry?.location?.lat !== null).map((v) => mapPoint(v, now, opts)),
  };
};

const MAX_POINTS = 5000;

/// Telemetry / movement history for one vehicle.
///   bucket=raw         raw points (capped at 5000)
///   bucket=<minutes>   averaged per N-minute bucket ($dateTrunc, MongoDB >= 5)
///   bucket=auto        (default) raw if the span is short, else ~1000 buckets
export const getTelemetryHistory = async (vehicleId, { start, end, bucket = 'auto' }) => {
  const spanMinutes = (end - start) / 60000;
  let binMinutes = 0;
  if (bucket === 'auto' || bucket === undefined || bucket === '') {
    binMinutes = spanMinutes <= 360 ? 0 : Math.ceil(spanMinutes / 1000);
  } else if (bucket !== 'raw') {
    binMinutes = Number.parseInt(bucket, 10);
    if (!Number.isFinite(binMinutes) || binMinutes < 1 || binMinutes > 1440) {
      throw new ApiError(400, 'bucket must be raw, auto or 1-1440 minutes');
    }
  }
  const match = { vehicle_id: vehicleId, recorded_at: { $gte: start, $lt: end } };
  if (!binMinutes) {
    const points = await EvTelemetry.find(match).sort({ recorded_at: 1 }).limit(MAX_POINTS).select('-_id -vehicle_id').lean();
    return { bucket_minutes: 0, truncated: points.length === MAX_POINTS, points };
  }
  const points = await EvTelemetry.aggregate([
    { $match: match },
    { $sort: { recorded_at: 1 } },
    {
      $group: {
        _id: { $dateTrunc: { date: '$recorded_at', unit: 'minute', binSize: binMinutes } },
        samples: { $sum: 1 },
        soc_pct: { $avg: '$soc_pct' },
        soh_pct: { $last: '$soh_pct' },
        speed_kmh: { $avg: '$speed_kmh' },
        max_speed_kmh: { $max: '$speed_kmh' },
        range_km: { $last: '$range_km' },
        odometer_km: { $max: '$odometer_km' },
        location: { $last: '$location' },
        charging_state: { $last: '$charging_state' },
        ignition: { $last: '$ignition' },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: MAX_POINTS },
    {
      $project: {
        _id: 0,
        recorded_at: '$_id',
        samples: 1,
        soc_pct: { $round: ['$soc_pct', 1] },
        soh_pct: 1,
        speed_kmh: { $round: ['$speed_kmh', 1] },
        max_speed_kmh: 1,
        range_km: 1,
        odometer_km: 1,
        location: 1,
        charging_state: 1,
        ignition: 1,
      },
    },
  ]);
  return { bucket_minutes: binMinutes, truncated: points.length === MAX_POINTS, points };
};

/// Utilisation & performance per vehicle over [start, end), from completed
/// trips that started in the period.
export const getUtilisation = async (scope = {}, { start, end, vehicleId = null }) => {
  const filter = vehicleScopeFilter(scope);
  if (vehicleId) filter._id = vehicleId;
  const vehicles = await EvVehicle.find(filter)
    .select('registration_no make model status battery_capacity_kwh franchise_id')
    .lean();
  const ids = vehicles.map((v) => v._id);
  const stats = await EvTrip.aggregate([
    { $match: { vehicle_id: { $in: ids }, status: EV_TRIP_STATUS.COMPLETED, started_at: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: '$vehicle_id',
        trips: { $sum: 1 },
        distance_km: { $sum: '$distance_km' },
        minutes: { $sum: '$duration_minutes' },
        energy_used_pct: { $sum: { $ifNull: ['$energy_used_pct', 0] } },
        energy_used_kwh: { $sum: { $ifNull: ['$energy_used_kwh', 0] } },
        max_speed_kmh: { $max: '$max_speed_kmh' },
      },
    },
  ]);
  const byVehicle = new Map(stats.map((s) => [String(s._id), s]));
  const periodHours = (end - start) / 3600000;
  const rows = vehicles.map((v) => {
    const s = byVehicle.get(String(v._id)) || {};
    const distance = s.distance_km || 0;
    const hours = (s.minutes || 0) / 60;
    const pct = s.energy_used_pct || 0;
    const kwh = s.energy_used_kwh || 0;
    return {
      vehicle_id: v._id,
      registration_no: v.registration_no,
      make: v.make,
      model: v.model,
      status: v.status,
      trips: s.trips || 0,
      distance_km: round(distance, 2),
      active_hours: round(hours, 2),
      utilisation_pct: periodHours ? round((hours / periodHours) * 100, 1) : 0,
      avg_speed_kmh: hours ? round(distance / hours, 1) : 0,
      max_speed_kmh: s.max_speed_kmh || 0,
      energy_used_pct: round(pct, 1),
      energy_used_kwh: kwh ? round(kwh, 2) : null,
      km_per_soc_pct: pct > 0 ? round(distance / pct, 2) : null,
      kwh_per_100km: kwh > 0 && distance > 0 ? round((kwh / distance) * 100, 2) : null,
    };
  });
  rows.sort((a, b) => b.distance_km - a.distance_km);
  const sum = (k) => rows.reduce((acc, r) => acc + (r[k] || 0), 0);
  const totalPct = sum('energy_used_pct');
  const totalKm = sum('distance_km');
  return {
    period: { from: start, to: end },
    totals: {
      vehicles: rows.length,
      trips: sum('trips'),
      distance_km: round(totalKm, 2),
      active_hours: round(sum('active_hours'), 2),
      energy_used_pct: round(totalPct, 1),
      energy_used_kwh: round(sum('energy_used_kwh'), 2),
      km_per_soc_pct: totalPct > 0 ? round(totalKm / totalPct, 2) : null,
      avg_utilisation_pct: rows.length ? round(sum('utilisation_pct') / rows.length, 1) : 0,
    },
    items: rows,
  };
};

export const UTILISATION_CSV_COLUMNS = [
  'registration_no', 'make', 'model', 'status', 'trips', 'distance_km', 'active_hours', 'utilisation_pct',
  'avg_speed_kmh', 'max_speed_kmh', 'energy_used_pct', 'energy_used_kwh', 'km_per_soc_pct', 'kwh_per_100km',
];

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows, columns) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n');
