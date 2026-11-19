import mongoose from 'mongoose';
import { ADMIN_REF } from './constants.js';

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const waMessageSchema = new mongoose.Schema(
  {
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'WaContact', required: true, index: true },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'WaConversation', default: null, index: true },
    wa_id: { type: String, required: true, trim: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    type: { type: String, default: 'text' },
    body: { type: String, default: '' },
    media: { type: mongoose.Schema.Types.Mixed, default: undefined },
    location: { type: mongoose.Schema.Types.Mixed, default: undefined },
    interactive: { type: mongoose.Schema.Types.Mixed, default: undefined },
    context: { type: mongoose.Schema.Types.Mixed, default: undefined },
    referral: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Meta's message id (wamid.*). Unset until Meta accepts an outbound send.
    wa_message_id: { type: String, trim: true },
    status: { type: String, default: 'received', index: true },
    statuses: { type: [statusEventSchema], default: [] },
    template: {
      name: String,
      language: String,
      components: { type: mongoose.Schema.Types.Mixed, default: undefined },
    },
    error: { type: mongoose.Schema.Types.Mixed, default: undefined },
    sent_by: { type: mongoose.Schema.Types.ObjectId, ref: ADMIN_REF, default: null },
    origin: { type: String, enum: ['customer', 'staff', 'event', 'broadcast', 'bot', 'system'], default: 'customer' },
    broadcast: { type: mongoose.Schema.Types.ObjectId, ref: 'WaBroadcast', default: null },
    // Stops automated notifications going out twice, e.g. "order:<id>:shipped".
    dedupe_key: { type: String, trim: true },
    wa_timestamp: { type: Date, default: null },
  },
  { timestamps: true },
);

waMessageSchema.index(
  { wa_message_id: 1 },
  { unique: true, partialFilterExpression: { wa_message_id: { $type: 'string' } } },
);
waMessageSchema.index(
  { dedupe_key: 1 },
  { unique: true, partialFilterExpression: { dedupe_key: { $type: 'string' } } },
);
waMessageSchema.index({ contact: 1, createdAt: -1 });

export const WaMessage = mongoose.models.WaMessage || mongoose.model('WaMessage', waMessageSchema);
