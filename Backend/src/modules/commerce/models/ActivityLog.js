import mongoose from 'mongoose';

// Who did what, for employee monitoring. Written fire-and-forget by services/activityService.js.
const activitySchema = new mongoose.Schema(
  {
    actor: {
      type: { type: String }, // staff | admin | franchise | customer | system
      id: String,
      name: String,
      role: String,
    },
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', default: null, index: true },
    action: { type: String, required: true, index: true }, // e.g. order.create, stock.adjust
    entity: { type: String, default: '' },
    entity_id: { type: String, default: '' },
    label: { type: String, default: '' }, // human name of the entity (order number, SKU, store code, ...)
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ 'actor.id': 1, createdAt: -1 });
activitySchema.index({ createdAt: -1 });

export const CommerceActivityLog =
  mongoose.models.CommerceActivityLog || mongoose.model('CommerceActivityLog', activitySchema);
