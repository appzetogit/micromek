import mongoose from 'mongoose';

export const REFUND_METHODS = Object.freeze(['original', 'cash', 'upi', 'bank_transfer', 'store_credit']);
// requested -> approved -> paid; requested|approved -> rejected.
export const REFUND_STATUSES = Object.freeze(['requested', 'approved', 'paid', 'rejected']);

const actorSchema = new mongoose.Schema({ type: { type: String }, id: String, name: String }, { _id: false });

/// Money owed back on an order. Bookkeeping only: no payment gateway is called (see README).
const refundSchema = new mongoose.Schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceOrder', required: true, index: true },
    order_number: { type: String, default: '' },
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', required: true, index: true },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', default: null },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceCustomer', default: null },
    customer_name: { type: String, default: '' },
    amount: { type: Number, required: true, min: 0.01 },
    reason: { type: String, default: '' },
    method: { type: String, enum: REFUND_METHODS, default: 'original' },
    status: { type: String, enum: REFUND_STATUSES, default: 'requested', index: true },
    auto: { type: Boolean, default: false }, // created by a cancel / return of a paid order
    requested_by: { type: actorSchema, default: null },
    requested_at: { type: Date, default: Date.now },
    approved_by: { type: actorSchema, default: null },
    approved_at: { type: Date, default: null },
    rejected_by: { type: actorSchema, default: null },
    rejected_at: { type: Date, default: null },
    rejection_reason: { type: String, default: '' },
    paid_by: { type: actorSchema, default: null },
    paid_at: { type: Date, default: null },
    payment_reference: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

refundSchema.index({ store_id: 1, createdAt: -1 });
refundSchema.index({ status: 1, createdAt: -1 });

export const CommerceRefund = mongoose.models.CommerceRefund || mongoose.model('CommerceRefund', refundSchema);
