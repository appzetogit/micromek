import mongoose from 'mongoose';
import { addressSchema } from './Store.js';

const customerSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['retail', 'wholesale'], default: 'retail', index: true },
    // App customers link to their TaxiUser; walk-in / wholesale customers have none.
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiUser', default: null },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true, index: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    business_name: { type: String, default: '', trim: true },
    gstin: { type: String, default: '', trim: true, uppercase: true },
    addresses: { type: [addressSchema], default: [] },
    home_store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', default: null, index: true },
    credit_limit: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

customerSchema.index({ user_id: 1 }, { unique: true, partialFilterExpression: { user_id: { $type: 'objectId' } } });

export const CommerceCustomer = mongoose.models.CommerceCustomer || mongoose.model('CommerceCustomer', customerSchema);
