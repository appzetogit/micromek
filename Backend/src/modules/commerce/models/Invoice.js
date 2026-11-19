import mongoose from 'mongoose';

// Tax invoice: an immutable snapshot of the order at issue time. Never updated; a
// correction is a credit note (not built yet), not an edit.
const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceOrder', required: true, unique: true },
    order_number: String,
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', required: true, index: true },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', default: null, index: true },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceCustomer', required: true, index: true },
    type: { type: String, enum: ['retail', 'wholesale'] },
    issued_at: { type: Date, default: Date.now },
    seller: { type: mongoose.Schema.Types.Mixed, required: true },
    buyer: { type: mongoose.Schema.Types.Mixed, required: true },
    ship_to: { type: mongoose.Schema.Types.Mixed, default: null },
    items: { type: [mongoose.Schema.Types.Mixed], required: true },
    totals: { type: mongoose.Schema.Types.Mixed, required: true },
    payment: { method: String, status: String, paid_amount: Number },
    issued_by: { type: { type: String }, id: String, name: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const immutable = function blockInvoiceUpdate() {
  throw new Error('Invoices are immutable');
};
invoiceSchema.pre('save', function blockInvoiceResave() {
  if (!this.isNew) throw new Error('Invoices are immutable');
});
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace']) {
  invoiceSchema.pre(op, immutable);
}

export const CommerceInvoice = mongoose.models.CommerceInvoice || mongoose.model('CommerceInvoice', invoiceSchema);
