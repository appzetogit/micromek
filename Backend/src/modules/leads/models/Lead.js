import mongoose from 'mongoose';
import { ACTIVITY_TYPES, ADMIN_REF, LEAD_SOURCES, LEAD_STATUS, LEAD_TYPES } from './constants.js';

const activitySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    note: { type: String, default: '', trim: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    at: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: true },
);

const leadSchema = new mongoose.Schema(
  {
    source: { type: String, enum: LEAD_SOURCES, default: 'manual', index: true },
    campaign: {
      campaign_id: { type: String, default: '' },
      campaign_name: { type: String, default: '' },
      adset_id: { type: String, default: '' },
      adset_name: { type: String, default: '' },
      ad_id: { type: String, default: '' },
      ad_name: { type: String, default: '' },
      form_id: { type: String, default: '' },
      page_id: { type: String, default: '' },
      platform: { type: String, default: '' },
      source_url: { type: String, default: '' },
      utm_source: { type: String, default: '' },
      utm_medium: { type: String, default: '' },
      utm_campaign: { type: String, default: '' },
    },
    // Meta Lead Ads id - unique so webhook retries don't duplicate.
    leadgen_id: { type: String, trim: true },
    form_answers: { type: mongoose.Schema.Types.Mixed, default: undefined },

    name: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true, index: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    city: { type: String, default: '', trim: true },
    requirement: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    type: { type: String, enum: LEAD_TYPES, default: 'enquiry' },

    status: { type: String, enum: Object.values(LEAD_STATUS), default: LEAD_STATUS.NEW, index: true },
    lost_reason: { type: String, default: '', trim: true },
    status_changed_at: { type: Date, default: null },
    won_at: { type: Date, default: null },
    lost_at: { type: Date, default: null },

    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null, index: true },
    assigned_at: { type: Date, default: null },
    auto_assigned: { type: Boolean, default: false },

    // Commerce store / franchise this lead belongs to (optional, not populated here).
    store_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', default: null },
    tags: [{ type: String, trim: true, lowercase: true }],
    value: { type: Number, default: 0, min: 0 },

    next_follow_up_at: { type: Date, default: null, index: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    order_number: { type: String, default: '', trim: true },

    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'WaContact', default: null },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'WaConversation', default: null },
    first_response_at: { type: Date, default: null },
    last_contact_at: { type: Date, default: null },

    timeline: { type: [activitySchema], default: [] },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

leadSchema.index(
  { leadgen_id: 1 },
  { unique: true, partialFilterExpression: { leadgen_id: { $type: 'string' } } },
);
leadSchema.index({ phone: 1, status: 1 });
leadSchema.index({ assigned_to: 1, status: 1, createdAt: -1 });
leadSchema.index({ createdAt: -1 });

export const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
