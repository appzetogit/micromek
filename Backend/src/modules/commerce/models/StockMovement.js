import mongoose from 'mongoose';

export const MOVEMENT_TYPES = Object.freeze(['adjust', 'transfer_out', 'transfer_in', 'sale', 'return']);

const movementSchema = new mongoose.Schema(
  {
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', required: true, index: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true, index: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    qty: { type: Number, required: true }, // signed change to qty_on_hand
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceOrder', default: null },
    ref_store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', default: null },
    reason: { type: String, default: '', trim: true },
    actor: { type: { type: String }, id: String, name: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

movementSchema.index({ createdAt: -1 });

export const CommerceStockMovement =
  mongoose.models.CommerceStockMovement || mongoose.model('CommerceStockMovement', movementSchema);
