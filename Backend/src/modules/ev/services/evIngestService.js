import mongoose from 'mongoose';
import { emit } from '../../shared/events.js';
import { getProvider } from '../providers/index.js';
import { EvVehicle, EV_VEHICLE_STATUS } from '../models/EvVehicle.js';
import { EvTelemetry } from '../models/EvTelemetry.js';
import { EvTrip, EV_TRIP_STATUS } from '../models/EvTrip.js';
import { EvAlert, EV_ALERT_STATUS } from '../models/EvAlert.js';
import {
  decideTrip,
  evaluateAlerts,
  finalizeTrip,
  foldPoint,
  getRuleOptions,
  newTrip,
  shouldTimeoutTrip,
} from './evRules.js';

/// Telemetry ingestion. Polling (pollOnce / startEvTelemetryLoop) and webhooks
/// (ingestWebhook) both end in processTelemetryBatch, so trips and alerts
/// behave the same whichever way the vendor delivers data.

const POLLED_STATUSES = [EV_VEHICLE_STATUS.ACTIVE, EV_VEHICLE_STATUS.MAINTENANCE];

const state = { running: false, lastRun: null, lastError: null, timer: null };

const emptySummary = () => ({
  vehicles: 0,
  received: 0,
  written: 0,
  skipped_duplicate: 0,
  unknown_vehicle: 0,
  alerts_raised: 0,
  alerts_resolved: 0,
  trips_started: 0,
  trips_ended: 0,
});

const snapshotOf = (p, receivedAt) => ({
  recorded_at: p.recorded_at,
  received_at: receivedAt,
  location: p.location,
  speed_kmh: p.speed_kmh,
  heading: p.heading,
  odometer_km: p.odometer_km,
  soc_pct: p.soc_pct,
  soh_pct: p.soh_pct,
  charging_state: p.charging_state,
  range_km: p.range_km,
  ignition: p.ignition,
  status: p.status,
});

// ---------------------------------------------------------------- alerts

const reconcileAlerts = async (vehicle, decisions, { now, summary }) => {
  if (!decisions.length) return;
  const live = await EvAlert.find({ vehicle_id: vehicle._id, active: true });
  const byType = new Map(live.map((a) => [a.type, a]));
  for (const d of decisions) {
    const existing = byType.get(d.type);
    if (d.active === true) {
      if (existing) {
        existing.last_seen_at = now;
        // eslint-disable-next-line no-await-in-loop
        await existing.save();
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const alert = await EvAlert.create({
          vehicle_id: vehicle._id,
          type: d.type,
          severity: d.severity,
          message: d.message,
          value: d.value ?? null,
          location: vehicle.last_telemetry?.location || undefined,
          raised_at: now,
          last_seen_at: now,
        });
        summary.alerts_raised += 1;
        emit('ev.alert.raised', { alert: alert.toObject(), vehicle: vehicle.toObject ? vehicle.toObject() : vehicle });
      } catch (error) {
        // 11000 = a concurrent run (poll vs webhook) raised it first; that's fine.
        if (error?.code !== 11000) throw error;
      }
    } else if (d.active === false && existing) {
      existing.active = false;
      existing.status = EV_ALERT_STATUS.RESOLVED;
      existing.resolved_at = now;
      existing.resolution_note = d.type === 'low_battery' && vehicle.last_telemetry?.soc_pct < getRuleOptions().criticalPct
        ? 'Escalated to critical_battery'
        : 'Auto-resolved: condition cleared';
      // eslint-disable-next-line no-await-in-loop
      await existing.save();
      summary.alerts_resolved += 1;
    }
  }
};

// ---------------------------------------------------------------- trips

const closeTrip = async (trip, end, vehicle, opts, summary) => {
  finalizeTrip(trip, end, { batteryCapacityKwh: vehicle.battery_capacity_kwh });
  // Creeping around a car park is not a trip.
  if ((trip.distance_km || 0) < opts.tripMinKm) {
    await EvTrip.deleteOne({ _id: trip._id });
  } else {
    await trip.save();
    summary.trips_ended += 1;
  }
};

/// Runs one point through the trip state machine. Returns the new trip_state.
const stepTrip = async (vehicle, tripState, prev, point, opts, summary) => {
  let trip = tripState.open_trip_id ? await EvTrip.findById(tripState.open_trip_id) : null;
  if (trip && trip.status !== EV_TRIP_STATUS.OPEN) trip = null;
  const decision = decideTrip({ openTrip: trip, lastMovingAt: tripState.last_moving_at, prev, point, opts });
  let lastMovingAt = decision.moving ? point.recorded_at : tripState.last_moving_at;
  let openTripId = trip?._id || null;

  if (decision.action === 'start' || (decision.action === 'end' && decision.restart)) {
    if (decision.action === 'end') await closeTrip(trip, trip.last_point, vehicle, opts, summary);
    const created = await EvTrip.create(newTrip(vehicle, point));
    summary.trips_started += 1;
    openTripId = created._id;
    lastMovingAt = point.recorded_at;
  } else if (decision.action === 'continue') {
    foldPoint(trip, point, decision.increment_km);
    await trip.save();
  } else if (decision.action === 'end') {
    if (decision.end_at === 'point') foldPoint(trip, point, decision.increment_km);
    await closeTrip(trip, decision.end_at === 'point' ? point : trip.last_point, vehicle, opts, summary);
    openTripId = null;
  }
  return { open_trip_id: openTripId, last_moving_at: lastMovingAt };
};

// ---------------------------------------------------------------- batch

/// Core ingest: normalized points from any source → telemetry rows, snapshot,
/// trips, alerts. Points older than or equal to the stored snapshot are
/// dropped (duplicate poll / out-of-order webhook). Alerts are evaluated on
/// each vehicle's newest point only.
export const processTelemetryBatch = async (provider, points = [], { now = new Date(), vehicles = null } = {}) => {
  const opts = getRuleOptions();
  const summary = emptySummary();
  summary.received = points.length;
  const byExternal = new Map();
  for (const p of points) {
    if (!byExternal.has(p.external_id)) byExternal.set(p.external_id, []);
    byExternal.get(p.external_id).push(p);
  }
  const list = vehicles || await EvVehicle.find({
    provider: provider.name,
    external_id: { $in: [...byExternal.keys()] },
    deletedAt: null,
    status: { $in: POLLED_STATUSES },
  });
  const vehicleByExternal = new Map(list.map((v) => [v.external_id, v]));
  summary.unknown_vehicle = [...byExternal.keys()].filter((id) => !vehicleByExternal.has(id))
    .reduce((n, id) => n + byExternal.get(id).length, 0);

  const rows = [];
  const touched = new Set();
  for (const [externalId, vehiclePoints] of byExternal) {
    const vehicle = vehicleByExternal.get(externalId);
    if (!vehicle) continue;
    summary.vehicles += 1;
    vehiclePoints.sort((a, b) => a.recorded_at - b.recorded_at);

    let prev = vehicle.last_telemetry?.recorded_at ? vehicle.last_telemetry : null;
    let tripState = {
      open_trip_id: vehicle.trip_state?.open_trip_id || null,
      last_moving_at: vehicle.trip_state?.last_moving_at || null,
    };
    let newest = null;
    for (const point of vehiclePoints) {
      if (prev?.recorded_at && point.recorded_at <= prev.recorded_at) {
        summary.skipped_duplicate += 1;
        continue;
      }
      const { external_id: _ignored, ...fields } = point;
      rows.push({ ...fields, vehicle_id: vehicle._id, location: fields.location || undefined });
      // eslint-disable-next-line no-await-in-loop
      tripState = await stepTrip(vehicle, tripState, prev, point, opts, summary);
      prev = point;
      newest = point;
    }
    if (!newest) continue;
    touched.add(String(vehicle._id));

    vehicle.last_telemetry = snapshotOf(newest, now);
    vehicle.trip_state = tripState;
    // eslint-disable-next-line no-await-in-loop
    await EvVehicle.updateOne(
      { _id: vehicle._id },
      { $set: { last_telemetry: vehicle.last_telemetry, trip_state: tripState } },
    );
    const decisions = evaluateAlerts({ vehicle, point: newest, now, opts })
      .filter((d) => vehicle.status !== EV_VEHICLE_STATUS.MAINTENANCE || d.type !== 'offline');
    // eslint-disable-next-line no-await-in-loop
    await reconcileAlerts(vehicle, decisions, { now, summary });
  }

  if (rows.length) {
    await EvTelemetry.insertMany(rows, { ordered: false });
    summary.written = rows.length;
  }
  return { summary, touched };
};

/// Vehicles that sent nothing new: offline check and idle trip timeout.
const processSilentVehicles = async (vehicles, { now, summary }) => {
  const opts = getRuleOptions();
  for (const vehicle of vehicles) {
    if (vehicle.trip_state?.open_trip_id && shouldTimeoutTrip({
      openTrip: { started_at: vehicle.createdAt, last_point: vehicle.last_telemetry },
      lastMovingAt: vehicle.trip_state.last_moving_at,
      now,
      opts,
    })) {
      // eslint-disable-next-line no-await-in-loop
      const trip = await EvTrip.findById(vehicle.trip_state.open_trip_id);
      // eslint-disable-next-line no-await-in-loop
      if (trip && trip.status === EV_TRIP_STATUS.OPEN) await closeTrip(trip, trip.last_point, vehicle, opts, summary);
      // eslint-disable-next-line no-await-in-loop
      await EvVehicle.updateOne({ _id: vehicle._id }, { $set: { 'trip_state.open_trip_id': null } });
    }
    if (vehicle.status === EV_VEHICLE_STATUS.MAINTENANCE) continue;
    const decisions = evaluateAlerts({
      vehicle,
      point: null,
      lastRecordedAt: vehicle.last_telemetry?.recorded_at || null,
      since: vehicle.createdAt,
      now,
      opts,
    });
    // eslint-disable-next-line no-await-in-loop
    await reconcileAlerts(vehicle, decisions, { now, summary });
  }
};

// ---------------------------------------------------------------- poll

const dbReady = () => mongoose.connection.readyState === 1;

/// One polling pass over every active/maintenance vehicle of the configured
/// provider. Never overlaps itself; returns a summary (also kept for the
/// provider-status endpoint).
export const pollOnce = async ({ now = () => new Date() } = {}) => {
  const provider = getProvider();
  if (!provider.enabled) return { skipped: true, reason: provider.disabledReason };
  if (state.running) return { skipped: true, reason: 'A poll is already running' };
  if (!dbReady()) return { skipped: true, reason: 'Database not connected' };
  state.running = true;
  const startedAt = new Date();
  try {
    const vehicles = await EvVehicle.find({ provider: provider.name, deletedAt: null, status: { $in: POLLED_STATUSES } });
    let result = { summary: emptySummary(), touched: new Set() };
    if (vehicles.length) {
      const points = await provider.getLatestTelemetry(vehicles.map((v) => v.external_id));
      result = await processTelemetryBatch(provider, points, { now: now(), vehicles });
    }
    const silent = vehicles.filter((v) => !result.touched.has(String(v._id)));
    await processSilentVehicles(silent, { now: now(), summary: result.summary });
    const summary = {
      ...result.summary,
      vehicles: vehicles.length,
      provider: provider.name,
      started_at: startedAt,
      duration_ms: Date.now() - startedAt.getTime(),
    };
    state.lastRun = summary;
    state.lastError = null;
    return summary;
  } catch (error) {
    state.lastError = { at: new Date(), message: error?.message || String(error) };
    throw error;
  } finally {
    state.running = false;
  }
};

/// Starts the background poller. No-op (returns null) when the provider is
/// disabled or EV_POLL_SECONDS=0. The timer is unref'd so it never keeps the
/// process alive; call the returned stop() on shutdown if you like.
export const startEvTelemetryLoop = () => {
  if (state.timer) return { stop: stopEvTelemetryLoop };
  const provider = getProvider();
  const seconds = process.env.EV_POLL_SECONDS === undefined ? 60 : Number(process.env.EV_POLL_SECONDS);
  if (!provider.enabled) {
    console.log(`[ev] telemetry loop not started: ${provider.disabledReason}`);
    return null;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.log('[ev] telemetry loop disabled (EV_POLL_SECONDS<=0); webhook ingest still works');
    return null;
  }
  const tick = () => {
    pollOnce().catch((error) => console.error('[ev] telemetry poll failed:', error?.message || error));
  };
  state.timer = setInterval(tick, Math.max(10, seconds) * 1000);
  state.timer.unref?.();
  setTimeout(tick, 5000).unref?.();
  console.log(`[ev] telemetry loop started: provider=${provider.name}, every ${Math.max(10, seconds)}s`);
  return { stop: stopEvTelemetryLoop };
};

export const stopEvTelemetryLoop = () => {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
};

export const getIngestState = () => ({
  loop_running: Boolean(state.timer),
  poll_in_progress: state.running,
  last_run: state.lastRun,
  last_error: state.lastError,
});

// ---------------------------------------------------------------- webhook

export const ingestWebhook = async (req) => {
  const provider = getProvider();
  provider.assertEnabled();
  if (typeof provider.parseWebhook !== 'function') return { summary: { ...emptySummary(), note: 'Provider has no webhook parser' } };
  const points = provider.parseWebhook(req) || [];
  const { summary } = await processTelemetryBatch(provider, points, { now: new Date() });
  return { summary };
};

// ---------------------------------------------------------------- sync

/// Imports the vendor's vehicle list. Existing vehicles (same provider +
/// external_id) get blank make/model/capacity/VIN filled in; new ones are
/// created active when `create` is true (dry run otherwise).
export const syncVehiclesFromProvider = async ({ create = true } = {}) => {
  const provider = getProvider();
  provider.assertEnabled();
  const remote = await provider.listVehicles();
  const existing = await EvVehicle.find({ provider: provider.name, external_id: { $in: remote.map((r) => r.external_id) } });
  const byId = new Map(existing.map((v) => [v.external_id, v]));
  const result = { total: remote.length, created: 0, updated: 0, unchanged: 0, would_create: 0, errors: [] };
  for (const r of remote) {
    const v = byId.get(r.external_id);
    if (v) {
      let changed = false;
      for (const key of ['make', 'model', 'vin', 'battery_capacity_kwh']) {
        if ((v[key] === null || v[key] === undefined || v[key] === '') && r[key] !== null && r[key] !== undefined) {
          v[key] = r[key];
          changed = true;
        }
      }
      if (changed) {
        // eslint-disable-next-line no-await-in-loop
        await v.save();
        result.updated += 1;
      } else {
        result.unchanged += 1;
      }
      continue;
    }
    if (!create) {
      result.would_create += 1;
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await EvVehicle.create({
        registration_no: r.registration_no || r.external_id,
        vin: r.vin,
        make: r.make || '',
        model: r.model || '',
        battery_capacity_kwh: r.battery_capacity_kwh,
        provider: provider.name,
        external_id: r.external_id,
        capabilities: { ...provider.capabilities },
      });
      result.created += 1;
    } catch (error) {
      result.errors.push({
        external_id: r.external_id,
        message: error?.code === 11000 ? 'registration_no already used by another vehicle' : error.message,
      });
    }
  }
  return result;
};
