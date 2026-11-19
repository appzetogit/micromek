import mongoose from 'mongoose';
import { ADMIN_REF, CONTENT_CHANNELS, CONTENT_KINDS, CONTENT_STATUS } from '../constants.js';

export const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

/// Placeholder for what a real publisher reports back.
export const publishResultSchema = new mongoose.Schema(
  {
    publisher: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    last_attempt_at: { type: Date, default: null },
    locked_until: { type: Date, default: null },
    external_id: { type: String, default: '' },
    permalink: { type: String, default: '' },
    error: { type: String, default: '' },
    published_at: { type: Date, default: null },
    raw: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

const contentItemSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: CONTENT_CHANNELS, required: true, index: true },
    kind: { type: String, enum: CONTENT_KINDS, default: 'post' },
    title: { type: String, default: '', trim: true }, // headline for ad copy
    body: { type: String, default: '' }, // caption / primary text / message
    description: { type: String, default: '' }, // ad link description
    call_to_action: { type: String, default: '' },
    hashtags: [{ type: String, trim: true }],
    media_urls: [{ type: String, trim: true }],
    link_url: { type: String, default: '', trim: true },
    product_ids: [{ type: mongoose.Schema.Types.ObjectId }],
    campaign_draft: { type: mongoose.Schema.Types.ObjectId, ref: 'MktAdCampaignDraft', default: null },
    scheduled_at: { type: Date, default: null, index: true },
    status: { type: String, enum: CONTENT_STATUS, default: 'draft', index: true },

    ai_generated: { type: Boolean, default: false },
    ai_prompt: { type: String, default: '' },
    ai_meta: {
      provider: { type: String, default: '' },
      model: { type: String, default: '' },
      theme: { type: String, default: '' },
      tone: { type: String, default: '' },
      batch_id: { type: String, default: '' },
      variation: { type: Number, default: 0 },
    },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    submitted_at: { type: Date, default: null },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    reviewed_at: { type: Date, default: null },
    review_notes: { type: String, default: '' },
    publish: { type: publishResultSchema, default: () => ({}) },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);
contentItemSchema.index({ status: 1, scheduled_at: 1 });

export const ContentItem = mongoose.models.MktContentItem || mongoose.model('MktContentItem', contentItemSchema);
