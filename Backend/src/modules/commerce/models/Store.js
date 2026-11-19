import mongoose from 'mongoose';

export const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    line1: { type: String, default: '', trim: true },
    line2: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    pincode: { type: String, default: '', trim: true },
    country: { type: String, default: 'India', trim: true },
    // Optional [lng, lat] for city (local) delivery.
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: true },
);

const storeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    address: { type: addressSchema, default: () => ({}) },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },
    gstin: { type: String, default: '', trim: true, uppercase: true },
    // Allocation to a franchise; this store's orders and invoices roll up to it.
    franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', default: null, index: true },
    // Shiprocket "pickup location" nickname configured in their panel for this store.
    shiprocket_pickup: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

storeSchema.index({ location: '2dsphere' });

export const CommerceStore = mongoose.models.CommerceStore || mongoose.model('CommerceStore', storeSchema);
