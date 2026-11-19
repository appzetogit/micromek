import mongoose from 'mongoose';

export const FRANCHISE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
});

// How a franchise's cut of a completed ride is worked out.
//  - percent_of_commission: a share of what the platform kept (Ride.commissionAmount)
//  - percent_of_fare:       a share of the whole fare
export const SHARE_TYPES = Object.freeze(['percent_of_commission', 'percent_of_fare']);

const shareRuleSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SHARE_TYPES, default: 'percent_of_commission' },
    value: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false },
);

const franchiseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    business_type: { type: String, enum: ['mobility', 'commerce', 'both'], default: 'mobility' },

    contact_name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, default: null, select: false },

    address: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    pincode: { type: String, default: '', trim: true },
    gst_number: { type: String, default: '', trim: true },
    pan_number: { type: String, default: '', trim: true },

    bank: {
      account_name: { type: String, default: '', trim: true },
      account_number: { type: String, default: '', trim: true },
      ifsc: { type: String, default: '', trim: true },
      bank_name: { type: String, default: '', trim: true },
      upi_id: { type: String, default: '', trim: true },
    },

    // Territory. A whole city (service location) or individual areas (zones).
    // One territory belongs to at most one non-rejected franchise - enforced in
    // franchiseService.assertTerritoryFree, not by an index, because a city and
    // a zone inside it also collide.
    service_location_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiServiceLocation' }],
    zone_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiZone' }],

    commission: {
      default: { type: shareRuleSchema, default: () => ({}) },
      // Per transport type (taxi, delivery, intercity). Falls back to default.
      by_transport_type: { type: Map, of: shareRuleSchema, default: () => new Map() },
    },
    settlement_cycle: { type: String, enum: ['weekly', 'fortnightly', 'monthly'], default: 'monthly' },
    contract_start: { type: Date, default: null },
    contract_end: { type: Date, default: null },

    status: {
      type: String,
      enum: Object.values(FRANCHISE_STATUS),
      default: FRANCHISE_STATUS.PENDING,
      index: true,
    },
    status_note: { type: String, default: '', trim: true },
    reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    reviewed_at: { type: Date, default: null },
    last_login_at: { type: Date, default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

franchiseSchema.index({ service_location_ids: 1 });
franchiseSchema.index({ zone_ids: 1 });

// The auth middleware reads these to refuse logins for non-approved accounts.
franchiseSchema.virtual('active').get(function active() {
  return this.status === FRANCHISE_STATUS.APPROVED && !this.deletedAt;
});

franchiseSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

export const Franchise = mongoose.models.Franchise || mongoose.model('Franchise', franchiseSchema);
