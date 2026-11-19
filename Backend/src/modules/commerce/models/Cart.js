import mongoose from 'mongoose';

const cartSchema = new mongoose.Schema(
  {
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceCustomer', required: true, unique: true },
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', default: null },
    items: [
      {
        _id: false,
        product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true },
        qty: { type: Number, required: true, min: 1 },
      },
    ],
    item_count: { type: Number, default: 0 },
    // Set once when commerce.cart.abandoned is emitted; cleared on every cart change.
    abandoned_notified_at: { type: Date, default: null },
    last_activity_at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

cartSchema.index({ abandoned_notified_at: 1, item_count: 1, last_activity_at: 1 });

export const CommerceCart = mongoose.models.CommerceCart || mongoose.model('CommerceCart', cartSchema);
