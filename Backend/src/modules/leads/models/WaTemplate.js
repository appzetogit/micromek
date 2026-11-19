import mongoose from 'mongoose';

/// Copy of the WABA's message templates, refreshed by "templates sync".
const waTemplateSchema = new mongoose.Schema(
  {
    wa_template_id: { type: String, default: '', trim: true },
    name: { type: String, required: true, trim: true },
    language: { type: String, required: true, trim: true },
    status: { type: String, default: '', trim: true, index: true },
    category: { type: String, default: '', trim: true },
    components: { type: mongoose.Schema.Types.Mixed, default: [] },
    rejected_reason: { type: String, default: '' },
    // Number of {{n}} placeholders in the body, for building parameters.
    body_param_count: { type: Number, default: 0 },
    synced_at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

waTemplateSchema.index({ name: 1, language: 1 }, { unique: true });

export const WaTemplate = mongoose.models.WaTemplate || mongoose.model('WaTemplate', waTemplateSchema);
