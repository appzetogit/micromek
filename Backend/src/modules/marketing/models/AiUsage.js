import mongoose from 'mongoose';

/// One row per AI provider call (text generation or embedding batch).
const aiUsageSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    model: { type: String, default: '' },
    operation: { type: String, enum: ['text', 'embed'], required: true },
    purpose: { type: String, default: 'unspecified', index: true },
    // Who triggered it: an admin (id = admin id) or a background job.
    triggered_by: {
      kind: { type: String, enum: ['admin', 'system'], default: 'system' },
      id: { type: String, default: '' },
      name: { type: String, default: '' },
    },
    input_chars: { type: Number, default: 0 },
    output_chars: { type: Number, default: 0 },
    items: { type: Number, default: 1 }, // texts embedded in the call
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    tokens_estimated: { type: Boolean, default: true }, // true when the provider did not report tokens
    cost_estimate: { type: Number, default: null }, // filled in once a priced provider exists
    ok: { type: Boolean, default: true, index: true },
    error_code: { type: String, default: '' },
    duration_ms: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'ai_usage' },
);
aiUsageSchema.index({ createdAt: -1 });

export const AiUsage = mongoose.models.AiUsage || mongoose.model('AiUsage', aiUsageSchema);
