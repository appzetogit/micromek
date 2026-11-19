import mongoose from 'mongoose';

export const SETTLEMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  APPROVED: 'approved',
  PAID: 'paid',
  CANCELLED: 'cancelled',
});

const breakdownSchema = new mongoose.Schema(
  {
    transport_type: { type: String, default: 'taxi' },
    rides: { type: Number, default: 0 },
    gross_fare: { type: Number, default: 0 },
    platform_commission: { type: Number, default: 0 },
    franchise_share: { type: Number, default: 0 },
    rule_type: { type: String, default: '' },
    rule_value: { type: Number, default: 0 },
  },
  { _id: false },
);

const adjustmentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true }, // + credit to franchise, - deduction
    reason: { type: String, required: true, trim: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const franchiseSettlementSchema = new mongoose.Schema(
  {
    franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', required: true, index: true },
    period_start: { type: Date, required: true },
    period_end: { type: Date, required: true }, // exclusive
    source: { type: String, enum: ['mobility', 'commerce'], default: 'mobility' },

    rides: { type: Number, default: 0 },
    gross_fare: { type: Number, default: 0 },
    platform_commission: { type: Number, default: 0 },
    franchise_share: { type: Number, default: 0 },
    adjustments: { type: [adjustmentSchema], default: [] },
    payable: { type: Number, default: 0 },
    breakdown: { type: [breakdownSchema], default: [] },

    status: {
      type: String,
      enum: Object.values(SETTLEMENT_STATUS),
      default: SETTLEMENT_STATUS.DRAFT,
      index: true,
    },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    approved_at: { type: Date, default: null },
    paid_at: { type: Date, default: null },
    payment_reference: { type: String, default: '', trim: true },
    payment_mode: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

// Cleared when a settlement is cancelled, so the period can be generated again.
franchiseSettlementSchema.add({ is_live: { type: Boolean, default: true } });

// One live settlement per franchise, source and period start. Overlap with
// other periods is checked in the service. ($in is not portable in partial
// filters on older servers, hence the boolean.)
franchiseSettlementSchema.index(
  { franchise_id: 1, source: 1, period_start: 1 },
  { unique: true, partialFilterExpression: { is_live: true } },
);

export const FranchiseSettlement =
  mongoose.models.FranchiseSettlement ||
  mongoose.model('FranchiseSettlement', franchiseSettlementSchema);
