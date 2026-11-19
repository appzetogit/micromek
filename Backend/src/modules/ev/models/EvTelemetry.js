import mongoose from 'mongoose';

const TTL_DAYS = Math.max(1, Number(process.env.EV_TELEMETRY_TTL_DAYS) || 180);

/// Raw telemetry points, one per (vehicle, recorded_at). Stored in a MongoDB
/// time-series collection (MongoDB >= 5.0): `vehicle_id` is the metaField, so
/// per-vehicle range scans are cheap, and old points expire after
/// EV_TELEMETRY_TTL_DAYS (default 180).
///
/// Mongoose creates the collection with these options on first model init
/// (autoCreate). If an ordinary `ev_telemetry` collection already exists it is
/// NOT converted; drop it first. Time-series collections allow no unique
/// indexes, so duplicates are prevented by the ingest service comparing
/// recorded_at with EvVehicle.last_telemetry.
const evTelemetrySchema = new mongoose.Schema(
  {
    vehicle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'EvVehicle', required: true },
    recorded_at: { type: Date, required: true },
    location: { lat: Number, lng: Number },
    speed_kmh: Number,
    heading: Number,
    odometer_km: Number,
    soc_pct: Number,
    soh_pct: Number,
    charging_state: String,
    range_km: Number,
    ignition: Boolean,
    status: String,
  },
  {
    collection: 'ev_telemetry',
    versionKey: false,
    timeseries: { timeField: 'recorded_at', metaField: 'vehicle_id', granularity: 'minutes' },
    expireAfterSeconds: TTL_DAYS * 86400,
  },
);

evTelemetrySchema.index({ vehicle_id: 1, recorded_at: -1 });

export const EvTelemetry = mongoose.models.EvTelemetry || mongoose.model('EvTelemetry', evTelemetrySchema);
