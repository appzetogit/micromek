import mongoose from 'mongoose';
import { ADMIN_REF } from './constants.js';

const leadFollowUpSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    due_at: { type: Date, required: true },
    note: { type: String, default: '', trim: true },
    channel: { type: String, enum: ['call', 'whatsapp', 'email', 'visit', 'other'], default: 'call' },
    status: { type: String, enum: ['pending', 'done', 'cancelled'], default: 'pending', index: true },
    done_at: { type: Date, default: null },
    outcome: { type: String, default: '', trim: true },
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null, index: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    done_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    overdue: { type: Boolean, default: false },
    reminded_at: { type: Date, default: null },
  },
  { timestamps: true },
);

leadFollowUpSchema.index({ status: 1, due_at: 1 });

export const LeadFollowUp = mongoose.models.LeadFollowUp || mongoose.model('LeadFollowUp', leadFollowUpSchema);
