import mongoose from 'mongoose';

// One row per (store, product). available = qty_on_hand - reserved.
// Never read-modify-write these rows: go through services/inventoryService.js (guarded $inc).
const inventorySchema = new mongoose.Schema(
  {
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true, index: true },
    qty_on_hand: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    reorder_level: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

inventorySchema.index({ store_id: 1, product_id: 1 }, { unique: true });

export const CommerceInventory = mongoose.models.CommerceInventory || mongoose.model('CommerceInventory', inventorySchema);
