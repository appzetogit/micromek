import { ApiError } from '../../../utils/ApiError.js';
import { emit } from '../../shared/events.js';
import { assertObjectId } from '../../franchise/services/franchiseService.js';
import { nextSequence } from '../models/Counter.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceProduct } from '../models/Product.js';
import { CommerceStore } from '../models/Store.js';
import { actorOf, canSetOrderStatus } from './accessService.js';
import { autoRefundForOrder } from './refundService.js';
import { commitItems, releaseItems, reserveItems, restockItems } from './inventoryService.js';
import { canTransition, financialYear, ORDER_TRANSITIONS, priceOrder, round2 } from './pricing.js';

const MAX_LINES = 200;

export const getStoreOr404 = async (id, { activeOnly = true } = {}) => {
  const store = await CommerceStore.findOne({ _id: assertObjectId(id, 'store_id'), ...(activeOnly ? { active: true } : {}) }).lean();
  if (!store) throw new ApiError(404, 'Store not found');
  return store;
};

const storeState = (store) => store.gstin || store.address?.state || '';

export const validateAddress = (addr) => {
  if (!addr || typeof addr !== 'object') throw new ApiError(400, 'ship_to address is required for delivery');
  for (const key of ['name', 'phone', 'line1', 'city', 'state', 'pincode']) {
    if (!String(addr[key] || '').trim()) throw new ApiError(400, `ship_to.${key} is required`);
  }
  if (!/^\d{6}$/.test(String(addr.pincode).trim())) throw new ApiError(400, 'ship_to.pincode must be 6 digits');
  const { _id, ...rest } = addr;
  return rest;
};

const normalizeItems = (items) => {
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, 'items must be a non-empty array');
  if (items.length > MAX_LINES) throw new ApiError(400, `At most ${MAX_LINES} lines per order`);
  return items.map((i) => {
    const qty = Number(i?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new ApiError(400, 'Each item needs an integer qty >= 1');
    return { product_id: assertObjectId(i.product_id, 'product_id'), qty, unit_price: i.unit_price, discount: i.discount };
  });
};

const outstandingCredit = async (customerId) => {
  const [row] = await CommerceOrder.aggregate([
    { $match: { customer_id: customerId, 'payment.method': 'credit', status: { $ne: 'cancelled' }, 'payment.status': { $in: ['pending', 'partial'] } } },
    { $group: { _id: null, due: { $sum: { $subtract: ['$totals.grand_total', '$payment.paid_amount'] } } } },
  ]);
  return round2(row?.due || 0);
};

/// Prices, reserves stock and creates an order. Used by app checkout and staff entry.
export const createOrder = async ({
  store, customer, items, type = 'retail', channel = 'app', fulfilment = 'delivery', shipTo = null,
  paymentMethod = 'cash', shipping = 0, notes = '', allowOverride = false, actor, initialStatus = 'placed', dueDate = null,
}) => {
  const lines = normalizeItems(items);
  const ids = [...new Set(lines.map((l) => String(l.product_id)))];
  const products = await CommerceProduct.find({ _id: { $in: ids }, active: true }).lean();
  if (products.length !== ids.length) throw new ApiError(400, 'One or more products are unavailable');
  const productsById = new Map(products.map((p) => [String(p._id), p]));

  const ship = fulfilment === 'delivery' ? validateAddress(shipTo) : null;
  const placeOfSupply = ship?.state || (type === 'wholesale' && customer.gstin) || storeState(store);
  const { lines: priced, totals } = priceOrder({
    items: lines, productsById, type, storeState: storeState(store), placeOfSupply, shipping: Number(shipping) || 0, allowOverride,
  });
  if (totals.grand_total <= 0 && paymentMethod === 'online') throw new ApiError(400, 'Nothing to pay online');

  if (paymentMethod === 'credit') {
    if (!(customer.credit_limit > 0)) throw new ApiError(400, 'Customer has no credit limit set');
    const due = await outstandingCredit(customer._id);
    if (due + totals.grand_total > customer.credit_limit) {
      throw new ApiError(409, 'Credit limit exceeded', { code: 'CREDIT_LIMIT', outstanding: due, limit: customer.credit_limit });
    }
  }

  await reserveItems(store._id, lines);
  try {
    const fy = financialYear();
    const seq = await nextSequence(`order:${store.code}:${fy}`);
    const order = await CommerceOrder.create({
      number: `SO-${store.code}-${fy}-${String(seq).padStart(5, '0')}`,
      store_id: store._id,
      franchise_id: store.franchise_id || null,
      customer_id: customer._id,
      customer_snapshot: {
        name: customer.name, phone: customer.phone, email: customer.email, gstin: customer.gstin, business_name: customer.business_name,
      },
      channel,
      type,
      fulfilment,
      ship_to: ship,
      items: priced,
      totals,
      payment: { method: paymentMethod, status: totals.grand_total <= 0 ? 'paid' : 'pending', paid_amount: 0, due_date: dueDate },
      status: initialStatus,
      stock_state: 'reserved',
      timeline: [{ status: initialStatus, note: `Order via ${channel}`, by: actor }],
      notes: String(notes || '').slice(0, 2000),
      created_by: actor,
    });
    emit('commerce.order.created', { order: order.toObject() });
    return order;
  } catch (error) {
    await releaseItems(store._id, lines);
    throw error;
  }
};

/// Stock side effects of a status change, each guarded by an atomic stock_state flip
/// so a retried / concurrent transition can never double-commit or double-release.
const applyStockEffects = async (order, to, actor) => {
  const flip = async (from, next) =>
    (await CommerceOrder.updateOne({ _id: order._id, stock_state: from }, { $set: { stock_state: next } })).modifiedCount === 1;
  if (to === 'cancelled' && (await flip('reserved', 'released'))) await releaseItems(order.store_id, order.items);
  if ((to === 'shipped' || to === 'delivered') && (await flip('reserved', 'committed'))) {
    await commitItems(order.store_id, order.items, { orderId: order._id, actor });
  }
  if (to === 'returned' && (await flip('committed', 'restocked'))) {
    await restockItems(order.store_id, order.items, { orderId: order._id, actor });
  }
};

/// Moves an order to `to`. `filter` adds the caller's store scope. `system` skips role checks
/// (shipping webhooks, jobs). Returns the updated order.
export const transitionOrder = async (req, orderId, to, { note = '', filter = {}, system = false } = {}) => {
  if (!ORDER_TRANSITIONS[to]) throw new ApiError(400, `Unknown status ${to}`);
  if (!system && !canSetOrderStatus(req, to)) throw new ApiError(403, `Your role cannot move orders to ${to}`);
  const actor = system ? { type: 'system', id: '', name: 'system' } : actorOf(req);
  const order = await CommerceOrder.findOne({ _id: assertObjectId(orderId, 'order id'), ...filter }).lean();
  if (!order) throw new ApiError(404, 'Order not found');
  const from = order.status;
  if (!canTransition(from, to)) throw new ApiError(409, `Cannot move an order from ${from} to ${to}`, { code: 'INVALID_TRANSITION' });
  if (to !== 'cancelled' && order.payment.method === 'online' && order.payment.status !== 'paid' && actor.type !== 'admin') {
    throw new ApiError(409, 'Online payment not received yet', { code: 'PAYMENT_PENDING' });
  }

  const updated = await CommerceOrder.findOneAndUpdate(
    { _id: order._id, status: from, ...filter },
    { $set: { status: to }, $push: { timeline: { status: to, note: String(note || '').slice(0, 500), at: new Date(), by: actor } } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new ApiError(409, 'Order was updated by someone else; reload and retry', { code: 'CONFLICT' });

  if (to === 'cancelled' || to === 'returned') {
    // Separate atomic step so a payment that landed concurrently is still flagged; it also opens
    // a CommerceRefund (status requested) for the unrefunded balance.
    await autoRefundForOrder(req, updated._id, to);
  }
  await applyStockEffects(updated, to, actor);
  emit('commerce.order.status_changed', { order: updated.toObject(), from, to });
  return updated;
};

/// Records a counter / bank / UPI payment against an order (billing). Atomic: the
/// filter refuses over-payment, the pipeline recomputes the status in the same write.
export const recordPayment = async (req, orderId, { amount, method = 'cash', reference = '' }, filter = {}) => {
  const amt = round2(amount);
  if (!(amt > 0)) throw new ApiError(400, 'amount must be > 0');
  const entry = { amount: amt, method: String(method).slice(0, 30), reference: String(reference || '').slice(0, 120), at: new Date(), by: actorOf(req) };
  const updated = await CommerceOrder.findOneAndUpdate(
    {
      _id: assertObjectId(orderId, 'order id'),
      ...filter,
      status: { $ne: 'cancelled' },
      'payment.status': { $in: ['pending', 'partial'] },
      $expr: { $lte: [{ $add: ['$payment.paid_amount', amt] }, { $add: ['$totals.grand_total', 0.01] }] },
    },
    [
      { $set: { 'payment.paid_amount': { $round: [{ $add: ['$payment.paid_amount', amt] }, 2] }, 'payment.entries': { $concatArrays: [{ $ifNull: ['$payment.entries', []] }, { $literal: [entry] }] } } },
      { $set: { 'payment.status': { $cond: [{ $gte: ['$payment.paid_amount', '$totals.grand_total'] }, 'paid', 'partial'] } } },
    ],
    { returnDocument: 'after', updatePipeline: true },
  );
  if (!updated) throw new ApiError(409, 'Payment not accepted: order not found, cancelled, already paid, or amount exceeds balance');
  return updated;
};
