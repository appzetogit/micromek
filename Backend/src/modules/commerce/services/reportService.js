import { Franchise } from '../../franchise/models/Franchise.js';
import { CommerceInventory } from '../models/Inventory.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceProduct } from '../models/Product.js';
import { CommerceStore } from '../models/Store.js';
import { round2 } from './pricing.js';

/// Sales reports. `scope` is a store filter fragment from accessService.storeFilter.
/// Cancelled orders are excluded; returned orders are reported separately.

const salesMatch = (scope, start, end) => ({ ...scope, createdAt: { $gte: start, $lt: end }, status: { $nin: ['cancelled', 'returned'] } });

const money = (row) => ({
  ...row,
  revenue: round2(row.revenue),
  taxable: round2(row.taxable),
  tax: round2(row.tax),
  avg_order_value: row.orders ? round2(row.revenue / row.orders) : 0,
});

export const salesReport = async ({ scope = {}, start, end, group = 'day' }) => {
  const keys = {
    day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } },
    store: '$store_id',
    franchise: '$franchise_id',
    channel: '$channel',
    type: '$type',
  };
  if (!keys[group]) group = 'day';
  const rows = await CommerceOrder.aggregate([
    { $match: salesMatch(scope, start, end) },
    {
      $group: {
        _id: keys[group],
        orders: { $sum: 1 },
        revenue: { $sum: '$totals.grand_total' },
        taxable: { $sum: '$totals.subtotal' },
        tax: { $sum: '$totals.tax' },
        collected: { $sum: '$payment.paid_amount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  let names = new Map();
  if (group === 'store') {
    const stores = await CommerceStore.find({ _id: { $in: rows.map((r) => r._id) } }).select('name code').lean();
    names = new Map(stores.map((s) => [String(s._id), `${s.name} (${s.code})`]));
  } else if (group === 'franchise') {
    const list = await Franchise.find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }).select('name code').lean();
    names = new Map(list.map((f) => [String(f._id), `${f.name} (${f.code})`]));
  }
  const items = rows.map((r) => money({
    key: r._id === null ? (group === 'franchise' ? 'company-owned' : null) : r._id,
    label: names.get(String(r._id)) || undefined,
    orders: r.orders,
    revenue: r.revenue,
    taxable: r.taxable,
    tax: r.tax,
    collected: round2(r.collected),
  }));
  const totals = items.reduce((a, r) => ({ orders: a.orders + r.orders, revenue: a.revenue + r.revenue, tax: a.tax + r.tax }), { orders: 0, revenue: 0, tax: 0 });
  return { group, period: { from: start, to: end }, totals: { ...totals, revenue: round2(totals.revenue), tax: round2(totals.tax) }, items };
};

export const topProducts = async ({ scope = {}, start, end, limit = 20 }) =>
  CommerceOrder.aggregate([
    { $match: salesMatch(scope, start, end) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product_id',
        sku: { $first: '$items.sku' },
        name: { $first: '$items.name' },
        qty: { $sum: '$items.qty' },
        revenue: { $sum: '$items.total' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: Math.min(100, Number(limit) || 20) },
    { $project: { _id: 0, product_id: '$_id', sku: 1, name: 1, qty: 1, orders: 1, revenue: { $round: ['$revenue', 2] } } },
  ]);

export const lowStock = async ({ scope = {}, limit = 200 }) =>
  CommerceInventory.aggregate([
    { $match: { ...scope, $expr: { $lte: [{ $subtract: ['$qty_on_hand', '$reserved'] }, '$reorder_level'] } } },
    { $limit: Math.min(500, Number(limit) || 200) },
    { $lookup: { from: CommerceProduct.collection.name, localField: 'product_id', foreignField: '_id', as: 'product' } },
    { $lookup: { from: CommerceStore.collection.name, localField: 'store_id', foreignField: '_id', as: 'store' } },
    { $set: { store: { $arrayElemAt: ['$store', 0] }, product: { $arrayElemAt: ['$product', 0] } } },
    { $project: { 'store._id': 1, 'store.code': 1, 'store.name': 1, 'product._id': 1, 'product.sku': 1, 'product.name': 1, 'product.unit': 1, qty_on_hand: 1, reserved: 1, reorder_level: 1, available: { $subtract: ['$qty_on_hand', '$reserved'] } } },
    { $sort: { available: 1 } },
  ]);

/// Employee monitoring: orders entered and value per staff member.
export const staffPerformance = async ({ scope = {}, start, end }) =>
  CommerceOrder.aggregate([
    { $match: { ...scope, createdAt: { $gte: start, $lt: end }, 'created_by.type': 'staff' } },
    {
      $group: {
        _id: '$created_by.id',
        name: { $first: '$created_by.name' },
        orders: { $sum: 1 },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        value: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 0, '$totals.grand_total'] } },
      },
    },
    { $sort: { value: -1 } },
    { $project: { _id: 0, staff_id: '$_id', name: 1, orders: 1, cancelled: 1, value: { $round: ['$value', 2] } } },
  ]);
