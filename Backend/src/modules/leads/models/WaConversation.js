import mongoose from 'mongoose';
import { ADMIN_REF, CONVERSATION_STATUS } from './constants.js';

const waConversationSchema = new mongoose.Schema(
  {
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'WaContact', required: true, index: true },
    wa_id: { type: String, required: true, trim: true, index: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null, index: true },
    // open: waiting for staff | bot: auto-replies (later phase) | human: staff handling | closed
    status: { type: String, enum: CONVERSATION_STATUS, default: 'open', index: true },
    last_message: {
      direction: { type: String, enum: ['in', 'out'], default: 'in' },
      type: { type: String, default: '' },
      body: { type: String, default: '' },
      at: { type: Date, default: null },
    },
    last_inbound_at: { type: Date, default: null },
    unread_count: { type: Number, default: 0 },
    handed_over_at: { type: Date, default: null },
    handed_over_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    closed_at: { type: Date, default: null },
    closed_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
  },
  { timestamps: true },
);

waConversationSchema.index({ status: 1, 'last_message.at': -1 });

export const WaConversation = mongoose.models.WaConversation || mongoose.model('WaConversation', waConversationSchema);
