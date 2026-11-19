import mongoose from 'mongoose';

export const STAFF_ROLES = Object.freeze(['store_manager', 'sales_staff', 'billing_staff']);

const staffSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, trim: true },
    email: { type: String, default: undefined, trim: true, lowercase: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: STAFF_ROLES, required: true },
    store_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore' }],
    active: { type: Boolean, default: true },
    last_login_at: { type: Date, default: null },
    created_by: { type: String, default: '' },
  },
  { timestamps: true },
);

staffSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
staffSchema.index({ store_ids: 1 });
staffSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

export const CommerceStaff = mongoose.models.CommerceStaff || mongoose.model('CommerceStaff', staffSchema);
