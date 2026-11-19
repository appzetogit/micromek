import { EvTelemetryProvider, normalizeTelemetry } from './baseProvider.js';

/// Development provider. Simulates a small EV fleet driving loops around a
/// centre point, parking, charging and discharging, so the whole pipeline
/// (trips, alerts, reports) can be exercised without a vendor.
///
/// Every vehicle follows a 120-minute cycle, offset per vehicle:
///   0-50 min  driving a ~25 km loop at ~30 km/h, SOC -0.6 %/min, ignition on
///   50-70     parked
///   70-100    charging, SOC +1 %/min (even vehicles report fast_charging)
///   100-120   parked (vehicle #5 goes silent here → offline alert)
/// Vehicle #3 starts low, so it crosses the low and critical battery levels.
/// State is a pure function of time, so restarts give the same picture.
///
/// Env: EV_MOCK_VEHICLES (default 5), EV_MOCK_CENTER "lat,lng" (default 12.9716,77.5946).

const CYCLE_MIN = 120;
const DRIVE_END = 50;
const PARK1_END = 70;
const CHARGE_END = 100;
const DRAIN_PER_MIN = 0.6;
const CHARGE_PER_MIN = 1;
const SPEED_KMH = 30;
const LOOP_KM = (SPEED_KMH * DRIVE_END) / 60; // 25 km per cycle
const START_SOC = [82, 64, 31, 90, 55, 72, 47, 60, 38, 77];
const KM_PER_DEG_LAT = 111.32;

const pad = (n) => String(n).padStart(3, '0');
export const mockExternalId = (i) => `MOCK-EV-${pad(i + 1)}`;

const parseCenter = (value) => {
  const [lat, lng] = String(value || '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: 12.9716, lng: 77.5946 };
};

export class MockProvider extends EvTelemetryProvider {
  constructor({ count, center, now } = {}) {
    super({
      name: 'mock',
      capabilities: { gps: true, soc: true, soh: true, charging: true, range: true, odometer: true, ignition: true, webhook: true },
    });
    this.count = Math.max(1, Math.min(50, Number(count ?? process.env.EV_MOCK_VEHICLES) || 5));
    this.center = center || parseCenter(process.env.EV_MOCK_CENTER);
    this.now = now || (() => new Date());
  }

  async listVehicles() {
    return Array.from({ length: this.count }, (_, i) => ({
      external_id: mockExternalId(i),
      registration_no: `MOCK-EV-${pad(i + 1)}`,
      vin: `MOCKVIN${pad(i + 1)}0000000`,
      make: i % 2 ? 'MG' : 'Tata',
      model: i % 2 ? 'ZS EV' : 'Nexon EV',
      battery_capacity_kwh: i % 2 ? 50.3 : 40.5,
    }));
  }

  /// Telemetry for vehicle index `i` at time `at`, or null when it is "offline".
  simulate(i, at = this.now()) {
    // 30 s resolution, so polls in the same window return the same point.
    const t = new Date(Math.floor(at.getTime() / 30000) * 30000);
    const minutes = t.getTime() / 60000 + i * 23; // per-vehicle offset
    const cycle = Math.floor(minutes / CYCLE_MIN);
    const m = minutes - cycle * CYCLE_MIN;
    if (i === 4 && m >= CHARGE_END) return null;

    const capacity = i % 2 ? 50.3 : 40.5;
    const startSoc = START_SOC[i % START_SOC.length];
    let soc;
    let phase;
    if (m < DRIVE_END) { soc = startSoc - DRAIN_PER_MIN * m; phase = 'driving'; } else if (m < PARK1_END) {
      soc = startSoc - DRAIN_PER_MIN * DRIVE_END; phase = 'parked';
    } else if (m < CHARGE_END) {
      soc = startSoc - DRAIN_PER_MIN * DRIVE_END + CHARGE_PER_MIN * (m - PARK1_END); phase = 'charging';
    } else { soc = startSoc; phase = 'parked'; }
    soc = Math.max(0, Math.min(100, soc));

    const driveFrac = Math.min(m, DRIVE_END) / DRIVE_END;
    const angle = driveFrac * 2 * Math.PI + i;
    const radiusKm = LOOP_KM / (2 * Math.PI);
    const lat = this.center.lat + ((radiusKm * Math.sin(angle)) / KM_PER_DEG_LAT) + i * 0.01;
    const lng = this.center.lng
      + ((radiusKm * Math.cos(angle)) / (KM_PER_DEG_LAT * Math.cos((this.center.lat * Math.PI) / 180)));
    const driving = phase === 'driving';
    const kmPerPct = (capacity / 100) * 6.5; // ~6.5 km per kWh
    return normalizeTelemetry({
      external_id: mockExternalId(i),
      recorded_at: t,
      location: { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) },
      speed_kmh: driving ? Math.round(SPEED_KMH + 8 * Math.sin(m)) : 0,
      heading: driving ? Math.round(((angle * 180) / Math.PI + 90) % 360) : null,
      odometer_km: Number((1000 * (i + 1) + cycle * LOOP_KM + LOOP_KM * driveFrac).toFixed(2)),
      soc_pct: Number(soc.toFixed(1)),
      soh_pct: 97 - i,
      charging_state: phase === 'charging' ? (i % 2 ? 'charging' : 'fast_charging') : 'not_charging',
      range_km: Math.round(soc * kmPerPct),
      ignition: driving,
      status: driving ? 'moving' : phase,
    });
  }

  async getLatestTelemetry(externalIds = []) {
    const at = this.now();
    return externalIds
      .map((id) => {
        const match = /^MOCK-EV-(\d+)$/.exec(String(id));
        return match ? this.simulate(Number(match[1]) - 1, at) : null;
      })
      .filter(Boolean);
  }

  /// Accepts already-normalized points: an array, { data: [...] } or one object.
  // eslint-disable-next-line class-methods-use-this
  parseWebhook(req) {
    const body = req.body || {};
    const list = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [body];
    return list.map((p) => normalizeTelemetry(p)).filter(Boolean);
  }
}

export const createMockProvider = (options) => new MockProvider(options);
