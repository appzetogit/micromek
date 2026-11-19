import mongoose from 'mongoose';
import { ADMIN_REF, CAMPAIGN_OBJECTIVES, CAMPAIGN_STATUS } from '../constants.js';
import { historySchema, publishResultSchema } from './ContentItem.js';

const copySchema = new mongoose.Schema(
  {
    headline: { type: String, default: '' },
    primary_text: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { _id: false },
);

const adSetSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    audience_description: { type: String, default: '' },
    targeting: { type: mongoose.Schema.Types.Mixed, default: {} },
    budget_share: { type: Number, default: 100, min: 0, max: 100 }, // percent of the campaign budget
    optimization_goal: { type: String, default: '' },
    placements: [{ type: String }],
  },
  { _id: true, minimize: false },
);

const adSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    ad_set_index: { type: Number, default: 0 },
    headline: { type: String, default: '' },
    primary_text: { type: String, default: '' },
    description: { type: String, default: '' },
    call_to_action: { type: String, default: 'LEARN_MORE' },
    media_urls: [{ type: String }],
    link_url: { type: String, default: '' },
    variations: { type: [copySchema], default: [] },
  },
  { _id: true },
);

export const recommendationSchema = new mongoose.Schema(
  {
    kind: { type: String, default: 'general' }, // objective | budget | audience | creative | schedule | performance
    severity: { type: String, enum: ['info', 'warning'], default: 'info' },
    message: { type: String, required: true },
  },
  { _id: false },
);

const adCampaignDraftSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    goal: { type: String, default: '' },
    objective: { type: String, enum: CAMPAIGN_OBJECTIVES, default: 'OUTCOME_TRAFFIC' },
    audience: {
      description: { type: String, default: '' },
      targeting: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    budget: {
      kind: { type: String, enum: ['daily', 'lifetime'], default: 'daily' },
      amount: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: 'INR' },
    },
    schedule: {
      start_at: { type: Date, default: null },
      end_at: { type: Date, default: null },
    },
    product_ids: [{ type: mongoose.Schema.Types.ObjectId }],
    ad_sets: { type: [adSetSchema], default: [] },
    ads: { type: [adSchema], default: [] },
    recommendations: { type: [recommendationSchema], default: [] },
    // Entered manually for now (later pulled from the Marketing API insights edge).
    metrics: {
      impressions: { type: Number, default: null },
      clicks: { type: Number, default: null },
      spend: { type: Number, default: null },
      leads: { type: Number, default: null },
      purchases: { type: Number, default: null },
      revenue: { type: Number, default: null },
      updated_at: { type: Date, default: null },
    },
    performance_suggestions: { type: [recommendationSchema], default: [] },
    status: { type: String, enum: CAMPAIGN_STATUS, default: 'draft', index: true },
    ai_generated: { type: Boolean, default: false },
    ai_prompt: { type: String, default: '' },
    ai_meta: { provider: { type: String, default: '' }, model: { type: String, default: '' } },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    reviewed_at: { type: Date, default: null },
    review_notes: { type: String, default: '' },
    publish: { type: publishResultSchema, default: () => ({}) },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true, minimize: false },
);

export const AdCampaignDraft = mongoose.models.MktAdCampaignDraft || mongoose.model('MktAdCampaignDraft', adCampaignDraftSchema);
