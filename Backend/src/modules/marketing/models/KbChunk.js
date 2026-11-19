import mongoose from 'mongoose';
import { KB_SOURCE_TYPES } from '../constants.js';

const kbChunkSchema = new mongoose.Schema(
  {
    doc: { type: mongoose.Schema.Types.ObjectId, ref: 'KbDocument', required: true, index: true },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    embedding_model: { type: String, default: '' },
    position: { type: Number, default: 0 },
    // Denormalised from the document so retrieval is a single query.
    source_type: { type: String, enum: KB_SOURCE_TYPES, default: 'upload' },
    active: { type: Boolean, default: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);
kbChunkSchema.index({ embedding_model: 1, active: 1, source_type: 1 });

export const KbChunk = mongoose.models.KbChunk || mongoose.model('KbChunk', kbChunkSchema);
