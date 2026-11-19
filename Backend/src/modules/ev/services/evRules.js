/// Pure rule functions (no DB, no env reads except getRuleOptions) so they can
/// be unit-tested in isolation. The ingest service wires them to the models.

const envNum = (env, key, fallback) => {
  const n = Number(env[key]);
  return env[key] !== undefined && env[key] !== '' && Number.isFinite(n) ? n : fallback;
};

export const getRuleOptions = (env = process.env) => ({
  criticalPct: envNum(env, 'EV_CRITICAL_BATTERY_PCT', 10),
  // An alert clears only once SOC is this many points above its threshold, so
  // a battery hovering around 20 % does not flap open/resolved every poll.
  hysteresisPct: envNum(env, 'EV_BATTERY_HYSTERESIS_PCT', 2),
  offlineMinutes: envNum(env, 'EV_OFFLINE_MINUTES', 15),
  overspeedKmh: envNum(env, 'EV_OVERSPEED_KMH', 100), // 0 disables
  tripMinSpeedKmh: envNum(env, 'EV_TRIP_MIN_SPEED_KMH', 3),
  tripIdleMinutes: envNum(env, 'EV_TRIP_IDLE_MINUTES', 5),
  tripGapMinutes: envNum(env, 'EV_TRIP_GAP_MINUTES', 30),
  tripMinKm: envNum(env, 'EV_TRIP_MIN_KM', 0.2),
  maxOdometerJumpKm: envNum(env, 'EV_MAX_ODOMETER_JUMP_KM', 50),
});

export const round = (n, digits = 2) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
};

const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

export const haversineKm = (a, b) => {
  if (!a || !b || [a.lat, a.lng, b.lat, b.lng].some((v) => v === null || v === undefined)) return null;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const minutesBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

// ---------------------------------------------------------------- alerts

/// Decides, per alert type, whether the condition is currently true.
///   active: true  → raise (if not already live) / keep
///   active: false → auto-resolve if live
///   active: null  → not enough data, leave as is
/// `point` is the newest normalized telemetry (or null when the poll returned
/// nothing for this vehicle); `lastRecordedAt` is the newest timestamp we have
/// ever stored (point or snapshot); `since` is when we started expecting data
/// (vehicle createdAt) for vehicles that never reported.
export const evaluateAlerts = ({ vehicle = {}, point = null, lastRecordedAt = null, since = null, now = new Date(), opts }) => {
  const o = opts || getRuleOptions();
  const out = [];
  const threshold = Number(vehicle.low_battery_threshold_pct) || 20;
  const reg = vehicle.registration_no || vehicle.external_id || 'Vehicle';

  // Offline: judged on the newest data we have, never on the point alone.
  const newest = point?.recorded_at || lastRecordedAt || null;
  const reference = newest || since;
  if (o.offlineMinutes > 0 && reference) {
    const silentFor = minutesBetween(reference, now);
    out.push({
      type: 'offline',
      active: silentFor > o.offlineMinutes,
      severity: 'warning',
      value: Math.round(silentFor),
      message: newest
        ? `${reg} has sent no telemetry for ${Math.round(silentFor)} min`
        : `${reg} has never sent telemetry`,
    });
  }

  if (!point) return out;

  const soc = point.soc_pct;
  if (soc !== null && soc !== undefined) {
    const critical = o.criticalPct;
    let criticalActive = null;
    if (soc < critical) criticalActive = true;
    else if (soc >= critical + o.hysteresisPct) criticalActive = false;
    out.push({
      type: 'critical_battery',
      active: criticalActive,
      severity: 'critical',
      value: soc,
      message: `${reg} battery critical at ${round(soc, 1)}%`,
    });

    // Low battery covers threshold..critical; once critical, the critical alert
    // takes over and low is resolved (escalated) to avoid two alerts for one cause.
    let lowActive = null;
    if (soc < critical) lowActive = false;
    else if (soc < threshold) lowActive = true;
    else if (soc >= threshold + o.hysteresisPct) lowActive = false;
    // While charging, never raise a *new* battery alert (a live one stays until SOC recovers).
    const charging = point.charging_state === 'charging' || point.charging_state === 'fast_charging';
    if (charging) {
      if (lowActive === true) lowActive = null;
      if (out[out.length - 1].active === true) out[out.length - 1].active = null;
    }
    out.push({
      type: 'low_battery',
      active: lowActive,
      severity: 'warning',
      value: soc,
      message: `${reg} battery low at ${round(soc, 1)}% (threshold ${threshold}%)`,
    });
  }

  if (o.overspeedKmh > 0 && point.speed_kmh !== null && point.speed_kmh !== undefined) {
    out.push({
      type: 'overspeed',
      active: point.speed_kmh > o.overspeedKmh,
      severity: 'warning',
      value: point.speed_kmh,
      message: `${reg} at ${Math.round(point.speed_kmh)} km/h (limit ${o.overspeedKmh})`,
    });
  }

  // Charging fault only when the vendor says so in its status text.
  if (point.status) {
    const fault = /fault|error|fail/i.test(point.status);
    out.push({
      type: 'charging_fault',
      active: fault,
      severity: 'critical',
      value: point.soc_pct ?? null,
      message: `${reg} reports a charging fault: ${point.status}`,
    });
  }
  return out;
};

// ---------------------------------------------------------------- trips

/// "Moving" = speed at/above EV_TRIP_MIN_SPEED_KMH, or ignition on when the
/// vendor reports no speed. Ignition on at a red light is not moving, but it
/// keeps the trip open (see decideTrip).
export const isMoving = (point, opts) => {
  const o = opts || getRuleOptions();
  if (point.speed_kmh !== null && point.speed_kmh !== undefined) return point.speed_kmh >= o.tripMinSpeedKmh;
  return point.ignition === true;
};

/// Distance between two consecutive points: odometer delta when both have one
/// and it is sane, else great-circle distance between GPS fixes (GPS jitter
/// under 30 m while stationary is ignored).
export const incrementKm = (prev, point, opts) => {
  const o = opts || getRuleOptions();
  if (!prev) return 0;
  const a = prev.odometer_km;
  const b = point.odometer_km;
  if (a !== null && a !== undefined && b !== null && b !== undefined) {
    const delta = b - a;
    if (delta >= 0 && delta <= o.maxOdometerJumpKm) return delta;
  }
  const d = haversineKm(prev.location, point.location);
  if (d === null) return 0;
  if (d < 0.03 && !(point.speed_kmh > 0)) return 0;
  return d;
};

/// Trip state machine, one step per new point.
///   no open trip  + moving                         → start
///   no open trip  + not moving                     → none
///   open trip     + gap since last point > GAP      → end at last point (restart if moving)
///   open trip     + ignition explicitly off         → end at this point
///   open trip     + moving                          → continue
///   open trip     + stopped >= IDLE minutes         → end at last moving point
///   open trip     + stopped < IDLE                  → continue (traffic light)
/// Returns { action: 'none'|'start'|'continue'|'end', increment_km, end_at: 'point'|'last_point', restart }.
export const decideTrip = ({ openTrip = null, lastMovingAt = null, prev = null, point, opts }) => {
  const o = opts || getRuleOptions();
  const moving = isMoving(point, o);
  if (!openTrip) return { action: moving ? 'start' : 'none', increment_km: 0, moving };

  const lastAt = openTrip.last_point?.recorded_at || openTrip.started_at;
  if (lastAt && minutesBetween(lastAt, point.recorded_at) > o.tripGapMinutes) {
    return { action: 'end', end_at: 'last_point', increment_km: 0, restart: moving, moving };
  }
  const inc = incrementKm(openTrip.last_point?.recorded_at ? openTrip.last_point : prev, point, o);
  if (point.ignition === false && !moving) return { action: 'end', end_at: 'point', increment_km: inc, moving };
  if (moving) return { action: 'continue', increment_km: inc, moving };
  const idleRef = lastMovingAt || openTrip.started_at;
  if (minutesBetween(idleRef, point.recorded_at) >= o.tripIdleMinutes) {
    return { action: 'end', end_at: 'last_point', increment_km: 0, moving };
  }
  return { action: 'continue', increment_km: inc, moving };
};

/// For a vehicle that sent nothing this poll: closes a trip that has been
/// quiet for longer than the idle window.
export const shouldTimeoutTrip = ({ openTrip, lastMovingAt, now = new Date(), opts }) => {
  const o = opts || getRuleOptions();
  if (!openTrip) return false;
  const ref = lastMovingAt || openTrip.last_point?.recorded_at || openTrip.started_at;
  return minutesBetween(ref, now) >= Math.max(o.tripIdleMinutes, 1);
};

const snap = (p) => ({
  recorded_at: p.recorded_at,
  location: p.location || null,
  odometer_km: p.odometer_km ?? null,
  soc_pct: p.soc_pct ?? null,
});

export const newTrip = (vehicle, point) => ({
  vehicle_id: vehicle._id,
  driver_id: vehicle.driver_id || null,
  status: 'open',
  started_at: point.recorded_at,
  start_location: point.location || null,
  start_odometer_km: point.odometer_km ?? null,
  start_soc_pct: point.soc_pct ?? null,
  distance_km: 0,
  max_speed_kmh: point.speed_kmh || 0,
  points: 1,
  last_point: snap(point),
});

/// Folds a point into an open trip (mutates and returns it).
export const foldPoint = (trip, point, km) => {
  trip.distance_km = round((trip.distance_km || 0) + (km || 0), 3);
  trip.max_speed_kmh = Math.max(trip.max_speed_kmh || 0, point.speed_kmh || 0);
  trip.points = (trip.points || 0) + 1;
  trip.last_point = snap({
    ...point,
    // Keep the last known value when this point lacks one.
    location: point.location || trip.last_point?.location || null,
    odometer_km: point.odometer_km ?? trip.last_point?.odometer_km ?? null,
    soc_pct: point.soc_pct ?? trip.last_point?.soc_pct ?? null,
  });
  return trip;
};

/// Closes a trip at `end` (a point or trip.last_point). Mutates and returns it.
export const finalizeTrip = (trip, end, { batteryCapacityKwh = null } = {}) => {
  const e = end || trip.last_point || {};
  trip.status = 'completed';
  trip.ended_at = e.recorded_at || trip.last_point?.recorded_at || trip.started_at;
  trip.end_location = e.location || trip.last_point?.location || null;
  trip.end_odometer_km = e.odometer_km ?? trip.last_point?.odometer_km ?? null;
  trip.end_soc_pct = e.soc_pct ?? trip.last_point?.soc_pct ?? null;
  if (trip.start_odometer_km !== null && trip.start_odometer_km !== undefined
    && trip.end_odometer_km !== null && trip.end_odometer_km !== undefined) {
    const odo = trip.end_odometer_km - trip.start_odometer_km;
    if (odo >= 0) trip.distance_km = round(odo, 3);
  }
  const minutes = Math.max(0, minutesBetween(trip.started_at, trip.ended_at));
  trip.duration_minutes = round(minutes, 1);
  trip.avg_speed_kmh = minutes > 0 ? round((trip.distance_km || 0) / (minutes / 60), 1) : 0;
  if (trip.start_soc_pct !== null && trip.start_soc_pct !== undefined
    && trip.end_soc_pct !== null && trip.end_soc_pct !== undefined) {
    trip.energy_used_pct = round(trip.start_soc_pct - trip.end_soc_pct, 1);
    trip.energy_used_kwh = batteryCapacityKwh ? round((trip.energy_used_pct / 100) * batteryCapacityKwh, 2) : null;
  }
  return trip;
};
