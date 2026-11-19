import { ApiError } from '../../../utils/ApiError.js';
import { assertObjectId } from '../../franchise/services/franchiseService.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceRefund, REFUND_METHODS } from '../models/Refund.js';
import { logActivity } from './activityService.js';
import { round2 } from './pricing.js';

/// Refund records. Bookkeeping only: nothing here calls Razorpay or any other gateway; the
/// money is sent by hand and `payment_reference` records how.
///
/// Over-refund guard: order.payment.refund_committed is the sum of every refund that is not
/// rejected. A refund is only created after a guarded update raises it, and that update refuses
/// to take refund_committed above payment.paid_amount, so concurrent refunds cannot exceed
/// what was paid. Rejecting a refund gives its amount back.

const SYSTEM = { type: 'system', id: '', name: 'system' };
const actorFor = (req) => {
  const a = req?.commerce?.actor;
  return a ? { type: a.type, id: String(a.id || ''), name: a.name || '' } : SYSTEM;
};
const EPS = 0.001;

/// Refundable balance right now: paid - committed.
export const refundableAmount = (order) =>
  round2(Math.max(0, (order.payment?.paid_amount || 0) - (order.payment?.refund_committed || 0)));

const commit = async (orderId, amount, filter = {}) =>
  CommerceOrder.findOneAndUpdate(
    {
      _id: orderId,
      ...filter,
      'payment.paid_amount': { $gt: 0 },
      $expr: { $lte: [{ $add: [{ $ifNull: ['$payment.refund_committed', 0] }, amount] }, { $add: ['$payment.paid_amount', EPS] }] },
    },
    [{ $set: { 'payment.refund_committed': { $round: [{ $add: [{ $ifNull: ['$payment.refund_committed', 0] }, amount] }, 2] } } }],
    { returnDocument: 'after', updatePipeline: true },
  ).lean();

const uncommit = (orderId, amount) =>
  CommerceOrder.updateOne(
    { _id: orderId },
    [{ $set: { 'payment.refund_committed': { $max: [0, { $round: [{ $subtract: [{ $ifNull: ['$payment.refund_committed', 0] }, amount] }, 2] }] } } }],
    { updatePipeline: true },
  );

/// Creates a refund in `requested`. amount defaults to the whole refundable balance.
/// `filter` is the caller's store scope on the order.
export const createRefund = async (req, orderOrId, { amount, reason = '', method = 'original', notes = '', auto = false } = {}, filter = {}) => {
  const order = orderOrId?._id
    ? orderOrId
    : await CommerceOrder.findOne({ _id: assertObjectId(orderOrId, 'order id'), ...filter }).lean();
  if (!order) throw new ApiError(404, 'Order not found');
  if (!REFUND_METHODS.includes(method)) throw new ApiError(400, `method must be one of ${REFUND_METHODS.join(', ')}`);
  const fresh = await CommerceOrder.findOne({ _id: order._id, ...filter }).select('payment').lean();
  if (!fresh) throw new ApiError(404, 'Order not found');
  const amt = round2(amount === undefined || amount === null || amount === '' ? refundableAmount(fresh) : Number(amount));
  if (!(amt > 0)) throw new ApiError(400, 'Nothing to refund: amount must be > 0 and the order must have payments');
  if (!(await commit(order._id, amt, filter))) {
    throw new ApiError(409, 'Refund exceeds the amount paid less refunds already requested', {
      code: 'REFUND_EXCEEDS_PAID', refundable: refundableAmount((await CommerceOrder.findById(order._id).select('payment').lean()) || {}),
    });
  }
  const actor = actorFor(req);
  try {
    const refund = await CommerceRefund.create({
      order_id: order._id,
      order_number: order.number,
      store_id: order.store_id,
      franchise_id: order.franchise_id || null,
      customer_id: order.customer_id || null,
      customer_name: order.customer_snapshot?.name || '',
      amount: amt,
      reason: String(reason || '').slice(0, 500),
      method,
      auto,
      notes: String(notes || '').slice(0, 1000),
      requested_by: actor,
      requested_at: new Date(),
    });
    logActivity(req, 'refund.request', {
      store_id: order.store_id, entity: 'refund', entity_id: refund._id, label: `${order.number} · ₹${amt}`, meta: { order_id: String(order._id), amount: amt, auto },
    });
    return refund;
  } catch (error) {
    await uncommit(order._id, amt);
    throw error;
  }
};

/// Called after an order is cancelled / returned: flags refund_due and opens a refund for the
/// unrefunded balance. Never throws (the status change already happened).
export const autoRefundForOrder = async (req, orderId, to) => {
  try {
    const flagged = await CommerceOrder.findOneAndUpdate(
      { _id: orderId, 'payment.paid_amount': { $gt: 0 }, 'payment.status': { $in: ['paid', 'partial', 'partially_refunded'] } },
      { $set: { 'payment.status': 'refund_due' } },
      { returnDocument: 'after' },
    ).lean();
    if (!flagged || !(refundableAmount(flagged) > 0)) return null;
    return await createRefund(req, flagged, { reason: `Order ${to}`, auto: true });
  } catch (error) {
    console.error('[commerce] auto refund failed', String(orderId), error.message);
    return null;
  }
};

const scopedRefund = async (id, filter) => {
  const refund = await CommerceRefund.findOne({ _id: assertObjectId(id, 'refund id'), ...filter }).lean();
  if (!refund) throw new ApiError(404, 'Refund not found');
  return refund;
};

const move = async (req, id, filter, from, set, action) => {
  const current = await scopedRefund(id, filter);
  const updated = await CommerceRefund.findOneAndUpdate(
    { _id: current._id, status: { $in: from }, ...filter },
    { $set: set },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) throw new ApiError(409, `Refund is ${current.status}; cannot ${action}`, { code: 'INVALID_REFUND_STATE' });
  logActivity(req, `refund.${action}`, {
    store_id: updated.store_id, entity: 'refund', entity_id: updated._id, label: `${updated.order_number} · ₹${updated.amount}`,
    meta: { order_id: String(updated.order_id), amount: updated.amount, from: current.status },
  });
  return updated;
};

export const approveRefund = (req, id, { notes } = {}, filter = {}) =>
  move(req, id, filter, ['requested'], {
    status: 'approved', approved_by: actorFor(req), approved_at: new Date(), ...(notes ? { notes: String(notes).slice(0, 1000) } : {}),
  }, 'approve');

export const rejectRefund = async (req, id, { reason } = {}, filter = {}) => {
  if (!String(reason || '').trim()) throw new ApiError(400, 'reason is required');
  const refund = await move(req, id, filter, ['requested', 'approved'], {
    status: 'rejected', rejected_by: actorFor(req), rejected_at: new Date(), rejection_reason: String(reason).trim().slice(0, 500),
  }, 'reject');
  await uncommit(refund.order_id, refund.amount);
  return refund;
};

/// approved -> paid. Then the order's refunded_amount grows and payment.status becomes
/// refunded (everything paid has been given back) or partially_refunded.
export const markRefundPaid = async (req, id, { reference, method, notes } = {}, filter = {}) => {
  const ref = String(reference || '').trim();
  if (!ref) throw new ApiError(400, 'reference is required (UTR, receipt or note of how the money was returned)');
  if (method !== undefined && !REFUND_METHODS.includes(method)) throw new ApiError(400, `method must be one of ${REFUND_METHODS.join(', ')}`);
  const refund = await move(req, id, filter, ['approved'], {
    status: 'paid', paid_by: actorFor(req), paid_at: new Date(), payment_reference: ref.slice(0, 120),
    ...(method ? { method } : {}), ...(notes ? { notes: String(notes).slice(0, 1000) } : {}),
  }, 'pay');
  await CommerceOrder.updateOne(
    { _id: refund.order_id },
    [
      { $set: { 'payment.refunded_amount': { $round: [{ $add: [{ $ifNull: ['$payment.refunded_amount', 0] }, refund.amount] }, 2] } } },
      {
        $set: {
          'payment.status': {
            $cond: [{ $gte: ['$payment.refunded_amount', { $subtract: ['$payment.paid_amount', EPS] }] }, 'refunded', 'partially_refunded'],
          },
        },
      },
    ],
    { updatePipeline: true },
  );
  return refund;
};
