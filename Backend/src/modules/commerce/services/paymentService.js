import crypto from 'node:crypto';
import { ApiError } from '../../../utils/ApiError.js';
import { razorpayApi } from '../../taxi/bus/services/busRefundService.js';
import { resolveConfiguredGatewayCredentials } from '../../taxi/services/paymentGatewayService.js';
import { CommerceOrder } from '../models/Order.js';

/// Razorpay via the platform's existing gateway config (Admin > Payment Gateways,
/// resolved by resolveConfiguredGatewayCredentials('razor_pay')) and the shared
/// razorpayApi helper. Amounts: rupees in our documents, paise on the wire.

export const createRazorpayOrder = async (order) => {
  if (order.payment.method !== 'online') throw new ApiError(400, 'Order is not an online-payment order');
  if (order.payment.status !== 'pending') throw new ApiError(409, `Payment is already ${order.payment.status}`);
  if (order.status === 'cancelled') throw new ApiError(409, 'Order is cancelled');
  const { keyId } = await resolveConfiguredGatewayCredentials('razor_pay');
  const amount = Math.round(order.totals.grand_total * 100);
  // Re-use an existing Razorpay order for retries so one order never has two live payment intents.
  if (order.payment.razorpay_order_id) {
    return { key_id: keyId, razorpay_order_id: order.payment.razorpay_order_id, amount, currency: 'INR', order_number: order.number };
  }
  const rp = await razorpayApi({
    method: 'POST',
    path: '/orders',
    body: {
      amount,
      currency: 'INR',
      receipt: order.number.slice(0, 40),
      notes: { source: 'commerce_order', commerce_order_id: String(order._id), store_id: String(order.store_id) },
    },
  });
  const set = await CommerceOrder.updateOne(
    { _id: order._id, 'payment.razorpay_order_id': null },
    { $set: { 'payment.razorpay_order_id': rp.id } },
  );
  if (!set.modifiedCount) {
    // Another request attached one first - use that.
    const fresh = await CommerceOrder.findById(order._id).select('payment.razorpay_order_id').lean();
    return { key_id: keyId, razorpay_order_id: fresh.payment.razorpay_order_id, amount, currency: 'INR', order_number: order.number };
  }
  return { key_id: keyId, razorpay_order_id: rp.id, amount, currency: 'INR', order_number: order.number };
};

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/// Checkout signature check, then an atomic pending -> paid flip. Idempotent for the same payment id.
export const verifyRazorpayPayment = async (order, { razorpay_order_id: rpOrderId, razorpay_payment_id: rpPaymentId, razorpay_signature: signature }) => {
  if (!rpOrderId || !rpPaymentId || !signature) throw new ApiError(400, 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required');
  if (order.payment.razorpay_order_id !== rpOrderId) throw new ApiError(400, 'Payment does not belong to this order');
  if (order.payment.status === 'paid' && order.payment.razorpay_payment_id === rpPaymentId) return order;

  const { keySecret } = await resolveConfiguredGatewayCredentials('razor_pay');
  const expected = crypto.createHmac('sha256', keySecret).update(`${rpOrderId}|${rpPaymentId}`).digest('hex');
  if (!safeEqualHex(expected, signature)) throw new ApiError(400, 'Invalid payment signature');

  const rpOrder = await razorpayApi({ path: `/orders/${encodeURIComponent(rpOrderId)}` });
  const expectedPaise = Math.round(order.totals.grand_total * 100);
  if (Number(rpOrder?.amount) !== expectedPaise) throw new ApiError(400, 'Payment amount does not match the order');

  const entry = { amount: order.totals.grand_total, method: 'razorpay', reference: rpPaymentId, at: new Date(), by: { type: 'customer', id: String(order.customer_id), name: '' } };
  const paid = await CommerceOrder.findOneAndUpdate(
    { _id: order._id, 'payment.status': 'pending', status: { $ne: 'cancelled' } },
    {
      $set: { 'payment.status': 'paid', 'payment.paid_amount': order.totals.grand_total, 'payment.razorpay_payment_id': rpPaymentId },
      $push: { 'payment.entries': entry, timeline: { status: order.status, note: 'Online payment received', at: new Date(), by: entry.by } },
    },
    { returnDocument: 'after' },
  );
  if (paid) return paid;

  const fresh = await CommerceOrder.findById(order._id);
  if (fresh.payment.status === 'paid' && fresh.payment.razorpay_payment_id === rpPaymentId) return fresh;
  if (fresh.status === 'cancelled') {
    // Paid after the reservation expired: keep the money on record for a refund.
    await CommerceOrder.updateOne(
      { _id: order._id, 'payment.status': 'pending' },
      { $set: { 'payment.status': 'refund_due', 'payment.paid_amount': order.totals.grand_total, 'payment.razorpay_payment_id': rpPaymentId }, $push: { 'payment.entries': entry } },
    );
    throw new ApiError(409, 'Order expired before payment completed; the amount will be refunded', { code: 'ORDER_EXPIRED' });
  }
  throw new ApiError(409, `Payment is already ${fresh.payment.status}`);
};
