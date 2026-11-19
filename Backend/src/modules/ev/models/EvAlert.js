import mongoose from 'mongoose';

export const EV_ALERT_TYPES = Object.freeze(['low_battery', 'critical_battery', 'offline', 'charging_fault', 'overspeed']);
export const EV_ALERT_SEVERITY = Object.freeze(['info', 'warning', 'critical']);
export const EV_ALERT_STATUS = Object.freeze({ OPEN: 'open', ACKNOWLEDGED: 'acknowledged', RESOLVED: 'resolved' });

/// One alert per episode. `active` is true while open or acknowledged; a
/// partial unique index on (vehicle_id, type) where active:true means the poller
/// can never raise a second copy of an alert that is still live. The ingest
/// service auto-resolves it when the condition clears; acknowledging only
/// marks it seen.
const evAlertSchema = new mongoose.Schema(
  {
    vehicle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'EvVehicle', required: true },
    type: { type: String, enum: EV_ALERT_TYPES, required: true },
    severity: { type: String, enum: EV_ALERT_SEVERITY, default: 'warning' },
    message: { type: String, default: '' },
    status: { type: String, enum: Object.values(EV_ALERT_STATUS), default: EV_ALERT_STATUS.OPEN },
    active: { type: Boolean, default: true },
    value: { type: Number, default: null }, // e.g. SOC or speed when raised
    location: { lat: Number, lng: Number },
    raised_at: { type: Date, default: Date.now },
    last_seen_at: { type: Date, default: Date.now },
    acknowledged_at: { type: Date, default: null },
    acknowledged_by: { type: mongoose.Schema.Types.ObjectId, default: null },
    resolved_at: { type: Date, default: null },
    resolved_by: { type: mongoose.Schema.Types.ObjectId, default: null }, // null → auto-resolved
    resolution_note: { type: String, default: '' },
  },
  { timestamps: true },
);

evAlertSchema.index(
  { vehicle_id: 1, type: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_live_alert_per_type' },
);
evAlertSchema.index({ status: 1, raised_at: -1 });
evAlertSchema.index({ vehicle_id: 1, raised_at: -1 });

export const EvAlert = mongoose.models.EvAlert || mongoose.model('EvAlert', evAlertSchema);
