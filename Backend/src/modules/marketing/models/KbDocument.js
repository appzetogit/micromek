import mongoose from 'mongoose';
import { ADMIN_REF, KB_FORMATS, KB_SOURCE_TYPES, KB_STATUS } from '../constants.js';

const kbDocumentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    source_type: { type: String, enum: KB_SOURCE_TYPES, default: 'upload', index: true },
    format: { type: String, enum: KB_FORMATS, default: 'text' },
    file_name: { type: String, default: '', trim: true },
    // Normalised source text, kept so the document can be re-chunked / re-embedded.
    content: { type: String, default: '', select: false },
    // FAQ pairs for format faq_json (each pair becomes its own chunk).
    faqs: {
      type: [{ _id: false, question: String, answer: String }],
      default: undefined,
      select: false,
    },
    status: { type: String, enum: KB_STATUS, default: 'processing', index: true },
    error: { type: String, default: '' },
    tags: [{ type: String, trim: true, lowercase: true }],
    active: { type: Boolean, default: true, index: true },
    chunk_count: { type: Number, default: 0 },
    char_count: { type: Number, default: 0 },
    embedding_model: { type: String, default: '' },
    indexed_at: { type: Date, default: null },
    // Set for documents the system owns (e.g. commerce_products).
    system_key: { type: String, default: undefined },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
  },
  { timestamps: true },
);
kbDocumentSchema.index({ system_key: 1 }, { unique: true, partialFilterExpression: { system_key: { $type: 'string' } } });

export const KbDocument = mongoose.models.KbDocument || mongoose.model('KbDocument', kbDocumentSchema);
