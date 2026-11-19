import mongoose from 'mongoose';
import { ADMIN_REF, BROADCAST_STATUS } from './constants.js';

const recipientSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    name: { type: String, default: '' },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'skipped'], default: 'pending' },
    wa_message_id: { type: String, default: '' },
    error: { type: String, default: '' },
    at: { type: Date, default: null },
  },
  { _id: false },
);

const waBroadcastSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    template: {
      name: { type: String, required: true, trim: true },
      language: { type: String, default: 'en', trim: true },
      // Same for every recipient; "{{name}}" inside a text parameter is replaced per recipient.
      components: { type: mongoose.Schema.Types.Mixed, default: [] },
    },
    audience: {
      type: { type: String, enum: ['phones', 'lead_filter'], required: true },
      phones: [{ type: String, trim: true }],
      lead_filter: {
        status: [String],
        source: [String],
        type: { type: [String] },
        tags: [String],
        assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
        created_from: { type: Date, default: null },
        created_to: { type: Date, default: null },
      },
    },
    scheduled_at: { type: Date, default: null },
    status: { type: String, enum: BROADCAST_STATUS, default: 'draft', index: true },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    approved_at: { type: Date, default: null },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    recipients: { type: [recipientSchema], default: [] },
    totals: {
      recipients: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    last_error: { type: String, default: '' },
    // Claimed by one job runner at a time (safe with several app instances).
    locked_until: { type: Date, default: null },
  },
  { timestamps: true },
);

waBroadcastSchema.index({ status: 1, scheduled_at: 1 });

export const WaBroadcast = mongoose.models.WaBroadcast || mongoose.model('WaBroadcast', waBroadcastSchema);
