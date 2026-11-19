import mongoose from 'mongoose';
import { SHIPMENT_STATUSES } from '../shipping/status.js';

export const SHIPPING_PROVIDERS = Object.freeze(['local_porter', 'shiprocket', 'bigship']);

const shipmentSchema = new mongoose.Schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceOrder', required: true, index: true },
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', required: true, index: true },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', default: null },
    provider: { type: String, enum: SHIPPING_PROVIDERS, required: true },
    status: { type: String, enum: SHIPMENT_STATUSES, default: 'created', index: true },
    // true while this is the order's live shipment (unique per order); false once cancelled/failed.
    active: { type: Boolean, default: true },
    awb: { type: String, default: null, index: true },
    courier_id: { type: String, default: '' },
    courier_name: { type: String, default: '' },
    provider_order_id: { type: String, default: '' },
    provider_shipment_id: { type: String, default: '' },
    tracking_url: { type: String, default: '' },
    charge: { type: Number, default: 0 },
    cod_amount: { type: Number, default: 0 },
    package: {
      weight_kg: Number,
      length_cm: Number,
      breadth_cm: Number,
      height_cm: Number,
    },
    pickup: { type: mongoose.Schema.Types.Mixed, default: null },
    drop: { type: mongoose.Schema.Types.Mixed, default: null },
    events: [
      {
        _id: false,
        status: String,
        raw_status: String,
        location: String,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
    // For local_porter: the taxi-platform delivery booked for it (see shipping/localPorter.js).
    platform_delivery_id: { type: String, default: null },
    last_polled_at: { type: Date, default: null },
    webhook_seen_at: { type: Date, default: null },
    created_by: { type: { type: String }, id: String, name: String },
    error: { type: String, default: '' },
  },
  { timestamps: true },
);

shipmentSchema.index({ order_id: 1 }, { unique: true, partialFilterExpression: { active: true } });
shipmentSchema.index({ provider: 1, status: 1, last_polled_at: 1 });

export const CommerceShipment = mongoose.models.CommerceShipment || mongoose.model('CommerceShipment', shipmentSchema);
