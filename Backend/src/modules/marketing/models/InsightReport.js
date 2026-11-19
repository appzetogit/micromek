import mongoose from 'mongoose';
import { ADMIN_REF, REPORT_STATUS } from '../constants.js';

const insightReportSchema = new mongoose.Schema(
  {
    period: {
      days: { type: Number, required: true },
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // the plain summary the narrative was written from
    narrative: { type: String, default: '' },
    status: { type: String, enum: REPORT_STATUS, default: 'draft', index: true },
    ai_meta: { provider: { type: String, default: '' }, model: { type: String, default: '' } },
    generated_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    reviewed_at: { type: Date, default: null },
    review_notes: { type: String, default: '' },
  },
  { timestamps: true, minimize: false },
);

export const InsightReport = mongoose.models.MktInsightReport || mongoose.model('MktInsightReport', insightReportSchema);
