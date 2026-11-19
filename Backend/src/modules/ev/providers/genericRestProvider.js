import { ApiError } from '../../../utils/ApiError.js';
import { EvTelemetryProvider, normalizeTelemetry } from './baseProvider.js';

/// Config-driven adapter for a JSON/REST telematics API. Covers vendors that
/// expose "list vehicles" and "latest telemetry for these ids" endpoints; a
/// vendor with an odd API should get its own provider file instead.
///
/// Env (credentials live only here, never in the DB):
///   EV_API_BASE_URL              https://api.vendor.example/v1           (required)
///   EV_API_KEY                   secret token                             (required)
///   EV_API_AUTH_HEADER           header name, default "Authorization"
///   EV_API_AUTH_SCHEME           prefix, default "Bearer" ("" → raw key)
///   EV_API_TIMEOUT_MS            default 10000
///   EV_API_VEHICLES_PATH         default "/vehicles"
///   EV_API_VEHICLES_LIST_KEY     dot path to the array in the response, default "" (body is the array)
///   EV_API_TELEMETRY_PATH        default "/telemetry/latest"
///   EV_API_TELEMETRY_METHOD      GET (ids in query) | POST (ids in JSON body), default GET
///   EV_API_TELEMETRY_IDS_PARAM   query param / body key for the ids, default "ids" (comma-joined in GET)
///   EV_API_TELEMETRY_LIST_KEY    dot path to the array, default ""
///   EV_API_BATCH_SIZE            ids per telemetry request, default 50
///   EV_FIELD_MAP                 JSON { normalizedField: "dot.path.in.vendor.record" } for telemetry
///                                e.g. {"external_id":"vehicleId","recorded_at":"ts","location.lat":"gps.lat",
///                                      "location.lng":"gps.lon","soc_pct":"battery.soc"}
///   EV_VEHICLE_FIELD_MAP         JSON same idea for listVehicles (external_id, registration_no, vin,
///                                make, model, battery_capacity_kwh)
///   EV_FIELD_SCALE               JSON { normalizedField: multiplier } e.g. {"speed_kmh":1.609344} for mph
///   EV_CHARGING_STATE_MAP        JSON { "VENDOR_VALUE": "charging|not_charging|fast_charging|unknown" }
///   EV_CAPABILITIES              JSON overrides e.g. {"soh":false,"range":true,"webhook":true}
///   EV_WEBHOOK_LIST_KEY          dot path to the array in a webhook body, default "" (array or single record)

const TELEMETRY_FIELDS = [
  'external_id', 'recorded_at', 'location.lat', 'location.lng', 'speed_kmh', 'heading', 'odometer_km',
  'soc_pct', 'soh_pct', 'charging_state', 'range_km', 'ignition', 'status',
];
const VEHICLE_FIELDS = ['external_id', 'registration_no', 'vin', 'make', 'model', 'battery_capacity_kwh'];

export const getPath = (obj, path) => {
  if (!path) return obj;
  return String(path).split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
};

const parseJsonEnv = (env, name, fallback = {}) => {
  const value = env[name];
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
};

/// Maps one vendor record with { field: path } → flat object keyed by normalized
/// field (dotted keys like location.lat are expanded). Unmapped fields fall back
/// to a same-named property on the record.
export const mapRecord = (record, fields, fieldMap = {}, scale = {}) => {
  const out = {};
  for (const field of fields) {
    let value = getPath(record, fieldMap[field] || field);
    if (scale[field] !== undefined && value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
      value = Number(value) * Number(scale[field]);
    }
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      out[parent] = { ...(out[parent] || {}), [child]: value };
    } else {
      out[field] = value;
    }
  }
  return out;
};

export class GenericRestProvider extends EvTelemetryProvider {
  constructor(env = process.env) {
    super({ name: 'generic_rest', capabilities: { webhook: true, ...parseJsonEnv(env, 'EV_CAPABILITIES', {}) } });
    this.baseUrl = String(env.EV_API_BASE_URL || '').replace(/\/+$/, '');
    this.apiKey = env.EV_API_KEY || '';
    if (!this.baseUrl || !this.apiKey) {
      this.enabled = false;
      this.disabledReason = 'EV_PROVIDER=generic_rest needs EV_API_BASE_URL and EV_API_KEY';
    }
    this.authHeader = env.EV_API_AUTH_HEADER || 'Authorization';
    this.authScheme = env.EV_API_AUTH_SCHEME ?? 'Bearer';
    this.timeoutMs = Number(env.EV_API_TIMEOUT_MS) || 10000;
    this.vehiclesPath = env.EV_API_VEHICLES_PATH || '/vehicles';
    this.vehiclesListKey = env.EV_API_VEHICLES_LIST_KEY || '';
    this.telemetryPath = env.EV_API_TELEMETRY_PATH || '/telemetry/latest';
    this.telemetryMethod = String(env.EV_API_TELEMETRY_METHOD || 'GET').toUpperCase();
    this.idsParam = env.EV_API_TELEMETRY_IDS_PARAM || 'ids';
    this.telemetryListKey = env.EV_API_TELEMETRY_LIST_KEY || '';
    this.batchSize = Math.max(1, Number(env.EV_API_BATCH_SIZE) || 50);
    this.webhookListKey = env.EV_WEBHOOK_LIST_KEY || '';
    this.fieldMap = parseJsonEnv(env, 'EV_FIELD_MAP', {});
    this.vehicleFieldMap = parseJsonEnv(env, 'EV_VEHICLE_FIELD_MAP', {});
    this.scale = parseJsonEnv(env, 'EV_FIELD_SCALE', {});
    this.chargingMap = parseJsonEnv(env, 'EV_CHARGING_STATE_MAP', {});
    this.lastError = null;
    this.lastSuccessAt = null;
  }

  async request(path, { method = 'GET', query = null, body = null } = {}) {
    this.assertEnabled();
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const headers = {
      Accept: 'application/json',
      [this.authHeader]: this.authScheme ? `${this.authScheme} ${this.apiKey}` : this.apiKey,
    };
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? `timed out after ${this.timeoutMs} ms` : error?.message;
      this.lastError = { at: new Date(), message: `Request to ${url.pathname} failed: ${reason}` };
      throw new ApiError(502, `EV provider request failed: ${reason}`);
    }
    if (!response.ok) {
      // Never echo the response body: some vendors reflect the auth header back.
      this.lastError = { at: new Date(), message: `${url.pathname} responded ${response.status}` };
      throw new ApiError(502, `EV provider responded ${response.status}`);
    }
    const json = await response.json().catch(() => {
      throw new ApiError(502, 'EV provider returned invalid JSON');
    });
    this.lastSuccessAt = new Date();
    return json;
  }

  async listVehicles() {
    const json = await this.request(this.vehiclesPath);
    const list = getPath(json, this.vehiclesListKey);
    if (!Array.isArray(list)) throw new ApiError(502, 'EV provider vehicle list is not an array (check EV_API_VEHICLES_LIST_KEY)');
    return list
      .map((r) => mapRecord(r, VEHICLE_FIELDS, this.vehicleFieldMap))
      .filter((v) => v.external_id !== undefined && v.external_id !== null && v.external_id !== '')
      .map((v) => ({
        external_id: String(v.external_id),
        registration_no: v.registration_no ? String(v.registration_no) : null,
        vin: v.vin ? String(v.vin) : null,
        make: v.make ? String(v.make) : null,
        model: v.model ? String(v.model) : null,
        battery_capacity_kwh: Number.isFinite(Number(v.battery_capacity_kwh)) && v.battery_capacity_kwh !== null
          ? Number(v.battery_capacity_kwh) : null,
      }));
  }

  normalize(records = []) {
    return records
      .map((r) => normalizeTelemetry(mapRecord(r, TELEMETRY_FIELDS, this.fieldMap, this.scale), { chargingMap: this.chargingMap }))
      .filter(Boolean);
  }

  async getLatestTelemetry(externalIds = []) {
    const ids = [...new Set(externalIds.map(String))];
    const out = [];
    for (let i = 0; i < ids.length; i += this.batchSize) {
      const chunk = ids.slice(i, i + this.batchSize);
      // eslint-disable-next-line no-await-in-loop
      const json = this.telemetryMethod === 'POST'
        ? await this.request(this.telemetryPath, { method: 'POST', body: { [this.idsParam]: chunk } })
        : await this.request(this.telemetryPath, { query: { [this.idsParam]: chunk.join(',') } });
      const list = getPath(json, this.telemetryListKey);
      if (!Array.isArray(list)) throw new ApiError(502, 'EV provider telemetry is not an array (check EV_API_TELEMETRY_LIST_KEY)');
      out.push(...this.normalize(list));
    }
    return out;
  }

  parseWebhook(req) {
    const list = getPath(req.body || {}, this.webhookListKey);
    return this.normalize(Array.isArray(list) ? list : list ? [list] : []);
  }

  async status() {
    return {
      ...(await super.status()),
      base_url_host: this.baseUrl ? new URL(this.baseUrl).host : null,
      last_success_at: this.lastSuccessAt,
      last_error: this.lastError,
      mapped_fields: Object.keys(this.fieldMap),
    };
  }
}

export const createGenericRestProvider = (env) => new GenericRestProvider(env);
