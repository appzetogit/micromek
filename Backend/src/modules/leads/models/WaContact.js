import mongoose from 'mongoose';
import { OPT_IN_STATUS } from './constants.js';

const waContactSchema = new mongoose.Schema(
  {
    // WhatsApp id = phone in international format, digits only (e.g. 919876543210).
    wa_id: { type: String, required: true, unique: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    name: { type: String, default: '', trim: true },
    profile_name: { type: String, default: '', trim: true },
    opt_in: {
      status: { type: String, enum: OPT_IN_STATUS, default: 'unknown' },
      at: { type: Date, default: null },
      source: { type: String, default: '', trim: true },
    },
    last_inbound_at: { type: Date, default: null },
    last_outbound_at: { type: Date, default: null },
    tags: [{ type: String, trim: true }],
  },
  { timestamps: true },
);

export const WaContact = mongoose.models.WaContact || mongoose.model('WaContact', waContactSchema);
