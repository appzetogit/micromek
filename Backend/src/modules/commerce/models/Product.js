import mongoose from 'mongoose';

export const GST_RATES = Object.freeze([0, 0.25, 3, 5, 12, 18, 28]);
export const UNITS = Object.freeze(['pcs', 'kg', 'g', 'l', 'ml', 'box', 'pack', 'dozen', 'm']);

// Wholesale price applies when the line quantity is >= min_qty (highest matching tier wins).
const tierSchema = new mongoose.Schema(
  { min_qty: { type: Number, required: true, min: 1 }, price: { type: Number, required: true, min: 0 } },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: '' },
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceCategory', default: null, index: true },
    brand: { type: String, default: '', trim: true },
    images: [{ type: String }],
    hsn: { type: String, default: '', trim: true },
    gst_rate: { type: Number, enum: GST_RATES, default: 18 },
    unit: { type: String, enum: UNITS, default: 'pcs' },
    // Rupees. When tax_inclusive the price already contains GST (typical MRP retail).
    mrp: { type: Number, default: 0, min: 0 },
    price: { type: Number, required: true, min: 0 },
    tax_inclusive: { type: Boolean, default: true },
    wholesale_tiers: { type: [tierSchema], default: [] },
    weight_kg: { type: Number, default: 0.5, min: 0 }, // per unit, for shipping
    // Simple variants: each variant is its own product (own SKU/stock) sharing a group key.
    variant_group: { type: String, default: '', trim: true, index: true },
    variant_label: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

productSchema.index({ name: 'text', brand: 'text', sku: 'text' });

export const CommerceProduct = mongoose.models.CommerceProduct || mongoose.model('CommerceProduct', productSchema);
