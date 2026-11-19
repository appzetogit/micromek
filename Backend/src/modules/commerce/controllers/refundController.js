import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok } from '../../shared/guards.js';
import { assertObjectId, parsePaging, parsePeriod } from '../../franchise/services/franchiseService.js';
import { CommerceRefund, REFUND_STATUSES } from '../models/Refund.js';
import { storeFilter } from '../services/accessService.js';
import { approveRefund, createRefund, markRefundPaid, rejectRefund } from '../services/refundService.js';
import { searchRegex } from './helpers.js';

/// Refund records (admin). Store-scoped through storeFilter so the same handlers work for a
/// scoped caller later.

export const listRefunds = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = storeFilter(req, req.query.store_id);
  if (req.query.status && REFUND_STATUSES.includes(String(req.query.status))) filter.status = String(req.query.status);
  if (req.query.order_id) filter.order_id = assertObjectId(req.query.order_id, 'order_id');
  if (req.query.customer_id) filter.customer_id = assertObjectId(req.query.customer_id, 'customer_id');
  if (req.query.franchise_id && req.commerce.actor.type === 'admin') filter.franchise_id = assertObjectId(req.query.franchise_id, 'franchise_id');
  if (req.query.from || req.query.to) {
    const { start, end } = parsePeriod(req.query);
    filter.createdAt = { $gte: start, $lt: end };
  }
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ order_number: rx }, { customer_name: rx }, { payment_reference: rx }];
  }
  const [items, total, sums] = await Promise.all([
    CommerceRefund.find(filter).populate('store_id', 'code name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceRefund.countDocuments(filter),
    CommerceRefund.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ]);
  const summary = Object.fromEntries(sums.map((s) => [s._id, { count: s.count, amount: Math.round(s.amount * 100) / 100 }]));
  return ok(res, { items, total, page, limit, pages: Math.ceil(total / limit) || 0, summary });
});

export const getRefundCtl = asyncHandler(async (req, res) => {
  const refund = await CommerceRefund.findOne({ _id: assertObjectId(req.params.id, 'refund id'), ...storeFilter(req) })
    .populate('store_id', 'code name').populate('order_id', 'number status payment totals.grand_total').lean();
  if (!refund) throw new ApiError(404, 'Refund not found');
  return ok(res, refund);
});

/// POST /orders/:id/refunds { amount?, reason, method, notes } - amount defaults to the refundable balance.
export const createRefundCtl = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const refund = await createRefund(req, req.params.id, {
    amount: body.amount, reason: body.reason, method: body.method || 'original', notes: body.notes,
  }, storeFilter(req));
  return ok(res, refund, 201);
});

export const listOrderRefunds = asyncHandler(async (req, res) => ok(res, await CommerceRefund.find({
  order_id: assertObjectId(req.params.id, 'order id'), ...storeFilter(req),
}).sort({ createdAt: -1 }).lean()));

export const approveRefundCtl = asyncHandler(async (req, res) => ok(res, await approveRefund(req, req.params.id, req.body || {}, storeFilter(req))));
export const rejectRefundCtl = asyncHandler(async (req, res) => ok(res, await rejectRefund(req, req.params.id, req.body || {}, storeFilter(req))));
export const payRefundCtl = asyncHandler(async (req, res) => ok(res, await markRefundPaid(req, req.params.id, req.body || {}, storeFilter(req))));
