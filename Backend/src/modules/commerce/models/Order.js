import mongoose from 'mongoose';
import { addressSchema } from './Store.js';
import { ORDER_STATUSES } from '../services/pricing.js';

export const ORDER_CHANNELS = Object.freeze(['app', 'whatsapp', 'phone', 'pos', 'lead']);
export const PAYMENT_METHODS = Object.freeze(['cash', 'online', 'credit']);
export const PAYMENT_STATUSES = Object.freeze(['pending', 'partial', 'paid', 'refund_due', 'refunded']);
// reserved: held against stock; committed: deducted from qty_on_hand; released: hold returned;
// restocked: committed stock put back after a return.
export const STOCK_STATES = Object.freeze(['reserved', 'committed', 'released', 'restocked']);

const actorSchema = new mongoose.Schema(
  { type: { type: String }, id: String, name: String },
  { _id: false },
);

const itemSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true },
    sku: String,
    name: String,
    hsn: String,
    unit: String,
    qty: { type: Number, required: true, min: 1 },
    unit_price: Number, // price charged per unit, as entered (incl. GST if tax_inclusive)
    tax_inclusive: Boolean,
    mrp: Number,
    discount: { type: Number, default: 0 },
    gst_rate: Number,
    taxable_value: Number,
    cgst: Number,
    sgst: Number,
    igst: Number,
    total: Number,
    weight_kg: Number,
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceStore', required: true, index: true },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', default: null, index: true },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceCustomer', required: true, index: true },
    customer_snapshot: { name: String, phone: String, email: String, gstin: String, business_name: String },
    channel: { type: String, enum: ORDER_CHANNELS, default: 'app' },
    type: { type: String, enum: ['retail', 'wholesale'], default: 'retail' },
    fulfilment: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
    ship_to: { type: addressSchema, default: null },
    items: { type: [itemSchema], validate: (v) => v.length > 0 },
    totals: {
      supply_type: { type: String, enum: ['intra', 'inter'] },
      subtotal: Number, // taxable value
      discount: Number,
      cgst: Number,
      sgst: Number,
      igst: Number,
      tax: Number,
      shipping: Number,
      round_off: Number,
      grand_total: Number,
    },
    payment: {
      method: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
      status: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
      paid_amount: { type: Number, default: 0 },
      razorpay_order_id: { type: String, default: null, index: true },
      razorpay_payment_id: { type: String, default: null },
      due_date: { type: Date, default: null },
      entries: [
        {
          _id: false,
          amount: Number,
          method: String,
          reference: String,
          at: { type: Date, default: Date.now },
          by: actorSchema,
        },
      ],
    },
    status: { type: String, enum: ORDER_STATUSES, default: 'placed', index: true },
    stock_state: { type: String, enum: STOCK_STATES, default: 'reserved' },
    timeline: [
      {
        _id: false,
        status: String,
        note: String,
        at: { type: Date, default: Date.now },
        by: actorSchema,
      },
    ],
    notes: { type: String, default: '' },
    created_by: { type: actorSchema, default: null },
    invoice_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceInvoice', default: null },
    shipment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceShipment', default: null },
  },
  { timestamps: true },
);

orderSchema.index({ store_id: 1, createdAt: -1 });
orderSchema.index({ status: 1, 'payment.method': 1, 'payment.status': 1, createdAt: 1 });
orderSchema.index({ 'created_by.id': 1, createdAt: -1 });

export const CommerceOrder = mongoose.models.CommerceOrder || mongoose.model('CommerceOrder', orderSchema);
