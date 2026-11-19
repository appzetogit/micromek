import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    parent_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceCategory', default: null },
    image: { type: String, default: '' },
    sort: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const CommerceCategory = mongoose.models.CommerceCategory || mongoose.model('CommerceCategory', categorySchema);
