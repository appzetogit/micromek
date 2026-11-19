import { ApiError } from '../../../utils/ApiError.js';

/// Telematics provider contract.
///
/// The client has not picked a telematics vendor yet, so the rest of the EV
/// module only talks to this interface. A provider is a plain object/class with:
///
///   name                       string, stored on EvVehicle.provider ('mock', 'generic_rest', ...)
///   enabled                    boolean; false → every call throws 503 with `disabledReason`
///   capabilities               { gps, soc, soh, charging, range, odometer, ignition, webhook }
///                              true when the vendor reports the field; the UI hides the rest.
///   async listVehicles()       → [{ external_id, registration_no, vin, make, model,
///                                   battery_capacity_kwh }]  (unknown fields null)
///   async getLatestTelemetry(externalIds[])
///                              → [normalized telemetry] (see normalizeTelemetry). Ids the
///                                vendor has no data for are simply omitted.
///   parseWebhook(req)          optional → [normalized telemetry] from a push payload.
///   async status()             optional → extra info for the admin provider-status page.
///
/// Normalized telemetry shape (null for anything the vendor does not supply):
///   { external_id, recorded_at: Date, location: { lat, lng } | null, speed_kmh, heading,
///     odometer_km, soc_pct, soh_pct, charging_state, range_km, ignition, status }
///   charging_state ∈ CHARGING_STATES.
export const CHARGING_STATES = Object.freeze(['charging', 'not_charging', 'fast_charging', 'unknown']);

export const DEFAULT_CAPABILITIES = Object.freeze({
  gps: true,
  soc: true,
  soh: false,
  charging: true,
  range: false,
  odometer: false,
  ignition: false,
  webhook: false,
});

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const clamp = (n, min, max) => (n === null ? null : Math.min(max, Math.max(min, n)));

const bool = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'running', 'acc_on'].includes(s)) return true;
  if (['0', 'false', 'off', 'no', 'stopped', 'acc_off'].includes(s)) return false;
  return null;
};

/// Accepts Date, ISO string, epoch seconds or epoch milliseconds.
export const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const normalizeChargingState = (value, map = {}) => {
  if (value === null || value === undefined || value === '') return 'unknown';
  const key = String(value).trim();
  if (map[key] && CHARGING_STATES.includes(map[key])) return map[key];
  const s = key.toLowerCase();
  if (CHARGING_STATES.includes(s)) return s;
  if (/fast|dc|rapid|super/.test(s)) return 'fast_charging';
  if (/^(not|no|idle|disconnected|unplugged|complete|done|stopped|false|0)/.test(s)) return 'not_charging';
  if (/charg|true|^1$|plugged|ac/.test(s)) return 'charging';
  return 'unknown';
};

/// Coerces a provider record into the normalized shape. Returns null when the
/// record is unusable (no id or no timestamp) so callers can just filter.
export const normalizeTelemetry = (raw = {}, { chargingMap = {} } = {}) => {
  const externalId = raw.external_id === null || raw.external_id === undefined ? '' : String(raw.external_id).trim();
  const recordedAt = toDate(raw.recorded_at);
  if (!externalId || !recordedAt) return null;
  const lat = num(raw.location?.lat ?? raw.lat);
  const lng = num(raw.location?.lng ?? raw.lng ?? raw.lon);
  const validLocation = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
  const speed = num(raw.speed_kmh);
  const heading = num(raw.heading);
  return {
    external_id: externalId,
    recorded_at: recordedAt,
    location: validLocation ? { lat, lng } : null,
    speed_kmh: speed === null ? null : Math.max(0, speed),
    heading: heading === null ? null : ((heading % 360) + 360) % 360,
    odometer_km: num(raw.odometer_km),
    soc_pct: clamp(num(raw.soc_pct), 0, 100),
    soh_pct: clamp(num(raw.soh_pct), 0, 100),
    charging_state: normalizeChargingState(raw.charging_state, chargingMap),
    range_km: num(raw.range_km) === null ? null : Math.max(0, num(raw.range_km)),
    ignition: bool(raw.ignition),
    status: raw.status === null || raw.status === undefined || raw.status === '' ? null : String(raw.status),
  };
};

/// Base class with the disabled behaviour; real providers override the methods.
export class EvTelemetryProvider {
  constructor({ name, capabilities = {} } = {}) {
    this.name = name;
    this.enabled = true;
    this.disabledReason = null;
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };
  }

  assertEnabled() {
    if (!this.enabled) throw new ApiError(503, this.disabledReason || 'EV telematics provider is disabled');
  }

  // eslint-disable-next-line class-methods-use-this
  async listVehicles() {
    throw new ApiError(501, `Provider ${this.name} does not support listing vehicles`);
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async getLatestTelemetry(_externalIds = []) {
    throw new ApiError(501, `Provider ${this.name} does not support polling telemetry`);
  }

  async status() {
    return { name: this.name, enabled: this.enabled, disabled_reason: this.disabledReason, capabilities: this.capabilities };
  }
}

export class DisabledProvider extends EvTelemetryProvider {
  constructor(name, reason) {
    super({ name: name || 'none' });
    this.enabled = false;
    this.disabledReason = reason;
  }

  async listVehicles() {
    this.assertEnabled();
  }

  async getLatestTelemetry() {
    this.assertEnabled();
  }
}
