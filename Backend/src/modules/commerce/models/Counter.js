import mongoose from 'mongoose';

// Sequences for order / invoice numbers, keyed e.g. "invoice:BLR1:2526".
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

export const CommerceCounter = mongoose.models.CommerceCounter || mongoose.model('CommerceCounter', counterSchema);

export const nextSequence = async (key) => {
  const doc = await CommerceCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return doc.seq;
};
