import mongoose from 'mongoose';
import { CHARGING_STATES } from '../providers/baseProvider.js';

export const EV_VEHICLE_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  MAINTENANCE: 'maintenance',
});

const { ObjectId } = mongoose.Schema.Types;

const pointSchema = new mongoose.Schema({ lat: Number, lng: Number }, { _id: false });

/// Latest normalized telemetry, copied on every ingest so dashboards and the
/// fleet map never have to touch the time-series collection.
const snapshotSchema = new mongoose.Schema(
  {
    recorded_at: { type: Date, default: null },
    received_at: { type: Date, default: null },
    location: { type: pointSchema, default: null },
    speed_kmh: { type: Number, default: null },
    heading: { type: Number, default: null },
    odometer_km: { type: Number, default: null },
    soc_pct: { type: Number, default: null },
    soh_pct: { type: Number, default: null },
    charging_state: { type: String, enum: CHARGING_STATES, default: 'unknown' },
    range_km: { type: Number, default: null },
    ignition: { type: Boolean, default: null },
    status: { type: String, default: null },
  },
  { _id: false },
);

const evVehicleSchema = new mongoose.Schema(
  {
    registration_no: { type: String, required: true, trim: true, uppercase: true },
    vin: { type: String, default: null, trim: true },
    make: { type: String, default: '', trim: true },
    model: { type: String, default: '', trim: true },
    year: { type: Number, default: null },
    battery_capacity_kwh: { type: Number, default: null, min: 0 },

    // Identity at the telematics vendor. Credentials are never stored here.
    provider: { type: String, required: true, trim: true, lowercase: true },
    external_id: { type: String, required: true, trim: true },

    // Optional links into the taxi / franchise modules.
    fleet_vehicle_id: { type: ObjectId, ref: 'TaxiFleetVehicle', default: null },
    driver_id: { type: ObjectId, ref: 'TaxiDriver', default: null },
    franchise_id: { type: ObjectId, ref: 'Franchise', default: null },
    service_location_id: { type: ObjectId, ref: 'TaxiServiceLocation', default: null },

    status: { type: String, enum: Object.values(EV_VEHICLE_STATUS), default: EV_VEHICLE_STATUS.ACTIVE },
    low_battery_threshold_pct: { type: Number, default: 20, min: 1, max: 99 },
    // Copied from the provider on create/sync; editable per vehicle.
    capabilities: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    notes: { type: String, default: '', trim: true },

    last_telemetry: { type: snapshotSchema, default: () => ({}) },
    // Ingestion bookkeeping for trip detection (see services/evRules.js).
    trip_state: {
      open_trip_id: { type: ObjectId, ref: 'EvTrip', default: null },
      last_moving_at: { type: Date, default: null },
    },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Unique across all docs; deletion rewrites both values (see controller), like Franchise.
evVehicleSchema.index({ provider: 1, external_id: 1 }, { unique: true });
evVehicleSchema.index({ registration_no: 1 }, { unique: true });
evVehicleSchema.index({ franchise_id: 1, deletedAt: 1, status: 1 });
evVehicleSchema.index({ provider: 1, deletedAt: 1, status: 1 });

export const EvVehicle = mongoose.models.EvVehicle || mongoose.model('EvVehicle', evVehicleSchema);
