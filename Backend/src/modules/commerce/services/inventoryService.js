import { ApiError } from '../../../utils/ApiError.js';
import { CommerceInventory } from '../models/Inventory.js';
import { CommerceStockMovement } from '../models/StockMovement.js';

/// Stock changes are single-document conditional updates ($inc guarded in the
/// filter), so concurrent checkouts can never oversell and nothing is read then
/// written. Multi-line operations compensate on failure instead of using
/// transactions (works on standalone Mongo).

const available = (qty) => ({ $expr: { $gte: [{ $subtract: ['$qty_on_hand', '$reserved'] }, qty] } });

/// Merges duplicate product lines: [{product_id, qty}] -> [{product_id, qty}] unique.
export const mergeLines = (items = []) => {
  const map = new Map();
  for (const { product_id: id, qty } of items) {
    const key = String(id);
    map.set(key, { product_id: id, qty: (map.get(key)?.qty || 0) + Number(qty) });
  }
  return [...map.values()];
};

const logMovements = (docs) =>
  docs.length && CommerceStockMovement.insertMany(docs).catch((e) => console.error('[commerce] movement log failed', e.message));

export const releaseItems = async (storeId, items) => {
  for (const { product_id: productId, qty } of mergeLines(items)) {
    // Pipeline update: atomic per row, never goes below zero.
    // eslint-disable-next-line no-await-in-loop
    await CommerceInventory.updateOne(
      { store_id: storeId, product_id: productId },
      [{ $set: { reserved: { $max: [0, { $subtract: ['$reserved', qty] }] } } }],
      { updatePipeline: true },
    );
  }
};

/// Reserves every line or none (compensating release on the first shortage).
export const reserveItems = async (storeId, items) => {
  const done = [];
  for (const line of mergeLines(items)) {
    // eslint-disable-next-line no-await-in-loop
    const row = await CommerceInventory.findOneAndUpdate(
      { store_id: storeId, product_id: line.product_id, ...available(line.qty) },
      { $inc: { reserved: line.qty } },
      { returnDocument: 'after' },
    );
    if (!row) {
      await releaseItems(storeId, done);
      throw new ApiError(409, 'Insufficient stock', { code: 'OUT_OF_STOCK', product_id: String(line.product_id), requested: line.qty });
    }
    done.push(line);
  }
};

/// Reserved -> sold: takes the units off qty_on_hand.
export const commitItems = async (storeId, items, { orderId = null, actor = null } = {}) => {
  const moves = [];
  for (const { product_id: productId, qty } of mergeLines(items)) {
    // eslint-disable-next-line no-await-in-loop
    const row = await CommerceInventory.findOneAndUpdate(
      { store_id: storeId, product_id: productId, reserved: { $gte: qty }, qty_on_hand: { $gte: qty } },
      { $inc: { reserved: -qty, qty_on_hand: -qty } },
    );
    if (!row) {
      // Should not happen (the units were reserved); clamp rather than fail a delivery.
      console.warn(`[commerce] commit without full reservation store=${storeId} product=${productId} qty=${qty}`);
      // eslint-disable-next-line no-await-in-loop
      await CommerceInventory.updateOne({ store_id: storeId, product_id: productId }, [
        {
          $set: {
            qty_on_hand: { $max: [0, { $subtract: ['$qty_on_hand', qty] }] },
            reserved: { $max: [0, { $subtract: ['$reserved', qty] }] },
          },
        },
      ], { updatePipeline: true });
    }
    moves.push({ store_id: storeId, product_id: productId, type: 'sale', qty: -qty, order_id: orderId, actor });
  }
  await logMovements(moves);
};

/// Returned goods back on the shelf.
export const restockItems = async (storeId, items, { orderId = null, actor = null, reason = 'order returned' } = {}) => {
  const moves = [];
  for (const { product_id: productId, qty } of mergeLines(items)) {
    // eslint-disable-next-line no-await-in-loop
    await CommerceInventory.updateOne({ store_id: storeId, product_id: productId }, { $inc: { qty_on_hand: qty } }, { upsert: true });
    moves.push({ store_id: storeId, product_id: productId, type: 'return', qty, order_id: orderId, reason, actor });
  }
  await logMovements(moves);
};

/// Manual stock correction / goods received. Negative deltas cannot eat into reserved units.
export const adjustStock = async ({ storeId, productId, delta, reason = '', actor = null }) => {
  const d = Number(delta);
  if (!Number.isInteger(d) || d === 0) throw new ApiError(400, 'delta must be a non-zero integer');
  const row = d > 0
    ? await CommerceInventory.findOneAndUpdate(
      { store_id: storeId, product_id: productId },
      { $inc: { qty_on_hand: d } },
      { upsert: true, returnDocument: 'after' },
    )
    : await CommerceInventory.findOneAndUpdate(
      { store_id: storeId, product_id: productId, ...available(-d) },
      { $inc: { qty_on_hand: d } },
      { returnDocument: 'after' },
    );
  if (!row) throw new ApiError(409, 'Cannot remove more than the unreserved stock', { code: 'INSUFFICIENT_STOCK' });
  await logMovements([{ store_id: storeId, product_id: productId, type: 'adjust', qty: d, reason, actor }]);
  return row;
};

export const transferStock = async ({ fromStoreId, toStoreId, productId, qty, reason = '', actor = null }) => {
  const q = Number(qty);
  if (!Number.isInteger(q) || q < 1) throw new ApiError(400, 'qty must be a positive integer');
  if (String(fromStoreId) === String(toStoreId)) throw new ApiError(400, 'Source and destination stores must differ');
  const source = await CommerceInventory.findOneAndUpdate(
    { store_id: fromStoreId, product_id: productId, ...available(q) },
    { $inc: { qty_on_hand: -q } },
    { returnDocument: 'after' },
  );
  if (!source) throw new ApiError(409, 'Insufficient unreserved stock at the source store', { code: 'INSUFFICIENT_STOCK' });
  let dest;
  try {
    dest = await CommerceInventory.findOneAndUpdate(
      { store_id: toStoreId, product_id: productId },
      { $inc: { qty_on_hand: q } },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (error) {
    await CommerceInventory.updateOne({ store_id: fromStoreId, product_id: productId }, { $inc: { qty_on_hand: q } });
    throw error;
  }
  await logMovements([
    { store_id: fromStoreId, product_id: productId, type: 'transfer_out', qty: -q, ref_store_id: toStoreId, reason, actor },
    { store_id: toStoreId, product_id: productId, type: 'transfer_in', qty: q, ref_store_id: fromStoreId, reason, actor },
  ]);
  return { source, destination: dest };
};

/// Map<productId, available> for one store.
export const availabilityMap = async (storeId, productIds) => {
  const rows = await CommerceInventory.find({ store_id: storeId, product_id: { $in: productIds } })
    .select('product_id qty_on_hand reserved').lean();
  return new Map(rows.map((r) => [String(r.product_id), Math.max(0, r.qty_on_hand - r.reserved)]));
};
