import mongoose from 'mongoose';

export const EV_TRIP_STATUS = Object.freeze({ OPEN: 'open', COMPLETED: 'completed' });

const pointSchema = new mongoose.Schema({ lat: Number, lng: Number }, { _id: false });

/// A trip derived from telemetry by the ingest service (see services/evRules.js
/// decideTrip). Not linked to taxi rides; a ride may span or contain trips.
const evTripSchema = new mongoose.Schema(
  {
    vehicle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'EvVehicle', required: true },
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', default: null },
    status: { type: String, enum: Object.values(EV_TRIP_STATUS), default: EV_TRIP_STATUS.OPEN },

    started_at: { type: Date, required: true },
    ended_at: { type: Date, default: null },
    start_location: { type: pointSchema, default: null },
    end_location: { type: pointSchema, default: null },
    start_odometer_km: { type: Number, default: null },
    end_odometer_km: { type: Number, default: null },
    start_soc_pct: { type: Number, default: null },
    end_soc_pct: { type: Number, default: null },

    distance_km: { type: Number, default: 0 },
    duration_minutes: { type: Number, default: 0 },
    energy_used_pct: { type: Number, default: null }, // start SOC - end SOC (negative if it charged)
    energy_used_kwh: { type: Number, default: null }, // pct x battery capacity, when known
    max_speed_kmh: { type: Number, default: 0 },
    avg_speed_kmh: { type: Number, default: 0 }, // distance / duration
    points: { type: Number, default: 0 },
    // Last point folded in: base for the next increment, and the end point on idle-out.
    last_point: {
      recorded_at: { type: Date, default: null },
      location: { type: pointSchema, default: null },
      odometer_km: { type: Number, default: null },
      soc_pct: { type: Number, default: null },
    },
  },
  { timestamps: true },
);

evTripSchema.index({ vehicle_id: 1, started_at: -1 });
evTripSchema.index({ status: 1, started_at: -1 });

export const EvTrip = mongoose.models.EvTrip || mongoose.model('EvTrip', evTripSchema);
