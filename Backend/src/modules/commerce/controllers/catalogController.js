import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok, paged } from '../../shared/guards.js';
import { Franchise } from '../../franchise/models/Franchise.js';
import { assertObjectId, parsePaging } from '../../franchise/services/franchiseService.js';
import { CommerceCategory } from '../models/Category.js';
import { CommerceInventory } from '../models/Inventory.js';
import { CommerceProduct, GST_RATES } from '../models/Product.js';
import { CommerceStockMovement } from '../models/StockMovement.js';
import { CommerceStore } from '../models/Store.js';
import { actorOf, assertStoreAccess, storeFilter } from '../services/accessService.js';
import { logActivity } from '../services/activityService.js';
import { adjustStock, availabilityMap, transferStock } from '../services/inventoryService.js';
import { money, pick, required, rethrowDuplicate, searchRegex, slugify, toBool } from './helpers.js';

const PUBLIC_STORE_FIELDS = 'code name phone address location active';
const GSTIN_RX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

// ---------- payload sanitizers ----------

const storePayload = async (body = {}, { partial = false } = {}) => {
  if (!partial) required(body, ['code', 'name']);
  const out = pick(body, ['code', 'name', 'phone', 'email', 'shiprocket_pickup']);
  if (body.address !== undefined) out.address = pick(body.address || {}, ['line1', 'line2', 'city', 'state', 'pincode', 'country']);
  if (body.lat !== undefined || body.lng !== undefined) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError(400, 'Invalid lat/lng');
    out.location = { type: 'Point', coordinates: [lng, lat] };
  }
  if (body.gstin !== undefined) {
    const g = String(body.gstin || '').trim().toUpperCase();
    if (g && !GSTIN_RX.test(g)) throw new ApiError(400, 'Invalid GSTIN');
    out.gstin = g;
  }
  if (body.active !== undefined) out.active = toBool(body.active);
  if (body.franchise_id !== undefined) out.franchise_id = await resolveFranchise(body.franchise_id);
  return out;
};

const resolveFranchise = async (value) => {
  if (value === null || value === '') return null;
  const franchise = await Franchise.findOne({ _id: assertObjectId(value, 'franchise_id'), deletedAt: null }).select('business_type status').lean();
  if (!franchise) throw new ApiError(404, 'Franchise not found');
  if (franchise.business_type === 'mobility') throw new ApiError(400, 'Franchise business_type must be commerce or both');
  if (franchise.status !== 'approved') throw new ApiError(400, `Franchise is ${franchise.status}`);
  return franchise._id;
};

const productPayload = (body = {}, { partial = false } = {}) => {
  if (!partial) required(body, ['sku', 'name', 'price']);
  const out = pick(body, ['sku', 'name', 'description', 'brand', 'hsn', 'unit', 'variant_group', 'variant_label']);
  if (body.slug !== undefined || (!partial && body.name)) out.slug = slugify(body.slug || `${body.name}-${body.sku}`);
  if (body.category_id !== undefined) out.category_id = body.category_id ? assertObjectId(body.category_id, 'category_id') : null;
  if (body.images !== undefined) out.images = (Array.isArray(body.images) ? body.images : []).map(String).slice(0, 12);
  for (const key of ['price', 'mrp', 'weight_kg']) if (body[key] !== undefined) out[key] = money(body[key], key);
  if (body.gst_rate !== undefined) {
    if (!GST_RATES.includes(Number(body.gst_rate))) throw new ApiError(400, `gst_rate must be one of ${GST_RATES.join(', ')}`);
    out.gst_rate = Number(body.gst_rate);
  }
  if (body.tax_inclusive !== undefined) out.tax_inclusive = toBool(body.tax_inclusive);
  if (body.active !== undefined) out.active = toBool(body.active);
  if (body.wholesale_tiers !== undefined) {
    const tiers = (Array.isArray(body.wholesale_tiers) ? body.wholesale_tiers : []).map((t) => {
      const minQty = Number(t?.min_qty);
      if (!Number.isInteger(minQty) || minQty < 1) throw new ApiError(400, 'wholesale_tiers[].min_qty must be an integer >= 1');
      return { min_qty: minQty, price: money(t.price, 'wholesale_tiers[].price') };
    });
    if (new Set(tiers.map((t) => t.min_qty)).size !== tiers.length) throw new ApiError(400, 'Duplicate wholesale tier min_qty');
    out.wholesale_tiers = tiers.sort((a, b) => a.min_qty - b.min_qty);
  }
  if (out.mrp && out.price && out.price > out.mrp) throw new ApiError(400, 'price cannot exceed mrp');
  return out;
};

// ---------- public catalogue ----------

export const publicStores = asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (req.query.city) filter['address.city'] = searchRegex(req.query.city);
  return ok(res, await CommerceStore.find(filter).select(PUBLIC_STORE_FIELDS).sort({ name: 1 }).lean());
});

export const publicCategories = asyncHandler(async (_req, res) =>
  ok(res, await CommerceCategory.find({ active: true }).sort({ sort: 1, name: 1 }).lean()));

const productFilter = (query, { includeInactive = false } = {}) => {
  const filter = includeInactive ? {} : { active: true };
  if (query.category_id) filter.category_id = assertObjectId(query.category_id, 'category_id');
  if (query.brand) filter.brand = searchRegex(query.brand);
  if (query.search) {
    const rx = searchRegex(query.search);
    filter.$or = [{ name: rx }, { sku: rx }, { brand: rx }];
  }
  if (includeInactive && query.active !== undefined) filter.active = toBool(query.active);
  return filter;
};

/// Catalogue with per-store availability when store_id is given; in_stock=1 hides sold-out items.
export const listProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const staffView = Boolean(req.commerce && req.commerce.actor.type !== 'customer');
  const filter = productFilter(req.query, { includeInactive: staffView });
  let storeId = null;
  if (req.query.store_id) storeId = staffView ? assertStoreAccess(req, req.query.store_id) : assertObjectId(req.query.store_id, 'store_id');
  if (storeId && toBool(req.query.in_stock)) {
    const inStock = await CommerceInventory.find({ store_id: storeId, $expr: { $gt: [{ $subtract: ['$qty_on_hand', '$reserved'] }, 0] } }).distinct('product_id');
    filter._id = { $in: inStock };
  }
  const [items, total] = await Promise.all([
    CommerceProduct.find(filter).sort({ name: 1 }).skip(skip).limit(limit).populate('category_id', 'name slug').lean(),
    CommerceProduct.countDocuments(filter),
  ]);
  if (storeId) {
    const avail = await availabilityMap(storeId, items.map((p) => p._id));
    for (const p of items) p.available = avail.get(String(p._id)) || 0;
  }
  return paged(res, { items, total, page, limit });
});

export const getProduct = asyncHandler(async (req, res) => {
  const key = String(req.params.idOrSlug);
  const filter = /^[a-f0-9]{24}$/i.test(key) ? { _id: key } : { slug: key.toLowerCase() };
  const product = await CommerceProduct.findOne({ ...filter, active: true }).populate('category_id', 'name slug').lean();
  if (!product) throw new ApiError(404, 'Product not found');
  if (req.query.store_id) {
    const avail = await availabilityMap(assertObjectId(req.query.store_id, 'store_id'), [product._id]);
    product.available = avail.get(String(product._id)) || 0;
  }
  if (product.variant_group) {
    product.variants = await CommerceProduct.find({ variant_group: product.variant_group, active: true, _id: { $ne: product._id } })
      .select('name slug sku variant_label price mrp images').lean();
  }
  return ok(res, product);
});

// ---------- admin: stores ----------

export const adminListStores = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { ...storeFilter(req, null, '_id') };
  if (req.query.active !== undefined) filter.active = toBool(req.query.active);
  if (req.query.franchise_id) filter.franchise_id = req.query.franchise_id === 'none' ? null : assertObjectId(req.query.franchise_id, 'franchise_id');
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ name: rx }, { code: rx }, { 'address.city': rx }];
  }
  const [items, total] = await Promise.all([
    CommerceStore.find(filter).populate('franchise_id', 'name code').sort({ name: 1 }).skip(skip).limit(limit).lean(),
    CommerceStore.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const adminGetStore = asyncHandler(async (req, res) => {
  const store = await CommerceStore.findOne({ _id: assertObjectId(req.params.id), ...storeFilter(req, null, '_id') }).populate('franchise_id', 'name code').lean();
  if (!store) throw new ApiError(404, 'Store not found');
  return ok(res, store);
});

export const adminCreateStore = asyncHandler(async (req, res) => {
  const data = await storePayload(req.body);
  const store = await CommerceStore.create(data).catch((e) => rethrowDuplicate(e, 'Store'));
  logActivity(req, 'store.create', { store_id: store._id, entity: 'store', entity_id: store._id });
  return ok(res, store, 201);
});

export const adminUpdateStore = asyncHandler(async (req, res) => {
  const data = await storePayload(req.body, { partial: true });
  const store = await CommerceStore.findByIdAndUpdate(assertObjectId(req.params.id), { $set: data }, { returnDocument: 'after', runValidators: true })
    .catch((e) => rethrowDuplicate(e, 'Store'));
  if (!store) throw new ApiError(404, 'Store not found');
  logActivity(req, 'store.update', { store_id: store._id, entity: 'store', entity_id: store._id, meta: { fields: Object.keys(data) } });
  return ok(res, store);
});

/// Franchise allocation: { franchise_id } or { franchise_id: null } to take the store back.
/// Only future orders roll up to the new franchise (franchise_id is copied onto each order).
export const adminAllocateStore = asyncHandler(async (req, res) => {
  const franchiseId = await resolveFranchise(req.body?.franchise_id ?? null);
  const store = await CommerceStore.findByIdAndUpdate(assertObjectId(req.params.id), { $set: { franchise_id: franchiseId } }, { returnDocument: 'after' });
  if (!store) throw new ApiError(404, 'Store not found');
  logActivity(req, 'store.allocate', { store_id: store._id, entity: 'store', entity_id: store._id, meta: { franchise_id: franchiseId } });
  return ok(res, store);
});

export const adminDeactivateStore = asyncHandler(async (req, res) => {
  const store = await CommerceStore.findByIdAndUpdate(assertObjectId(req.params.id), { $set: { active: false } }, { returnDocument: 'after' });
  if (!store) throw new ApiError(404, 'Store not found');
  logActivity(req, 'store.deactivate', { store_id: store._id, entity: 'store', entity_id: store._id });
  return ok(res, store);
});

// ---------- admin: categories ----------

export const adminListCategories = asyncHandler(async (_req, res) =>
  ok(res, await CommerceCategory.find({}).sort({ sort: 1, name: 1 }).lean()));

export const adminSaveCategory = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const id = req.params.id ? assertObjectId(req.params.id) : null;
  if (!id) required(body, ['name']);
  const data = pick(body, ['name', 'image', 'sort']);
  if (body.slug !== undefined || (!id && body.name)) data.slug = slugify(body.slug || body.name);
  if (body.parent_id !== undefined) data.parent_id = body.parent_id ? assertObjectId(body.parent_id, 'parent_id') : null;
  if (body.active !== undefined) data.active = toBool(body.active);
  if (id && data.parent_id && String(data.parent_id) === String(id)) throw new ApiError(400, 'A category cannot be its own parent');
  const category = id
    ? await CommerceCategory.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after', runValidators: true }).catch((e) => rethrowDuplicate(e, 'Category'))
    : await CommerceCategory.create(data).catch((e) => rethrowDuplicate(e, 'Category'));
  if (!category) throw new ApiError(404, 'Category not found');
  logActivity(req, id ? 'category.update' : 'category.create', { entity: 'category', entity_id: category._id });
  return ok(res, category, id ? 200 : 201);
});

export const adminDeleteCategory = asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id);
  if (await CommerceProduct.exists({ category_id: id, active: true })) throw new ApiError(409, 'Category still has active products');
  const category = await CommerceCategory.findByIdAndUpdate(id, { $set: { active: false } }, { returnDocument: 'after' });
  if (!category) throw new ApiError(404, 'Category not found');
  logActivity(req, 'category.deactivate', { entity: 'category', entity_id: id });
  return ok(res, category);
});

// ---------- admin: products ----------

export const adminGetProduct = asyncHandler(async (req, res) => {
  const product = await CommerceProduct.findById(assertObjectId(req.params.id)).populate('category_id', 'name').lean();
  if (!product) throw new ApiError(404, 'Product not found');
  product.stock = await CommerceInventory.find({ product_id: product._id }).populate('store_id', 'code name').lean();
  return ok(res, product);
});

export const adminCreateProduct = asyncHandler(async (req, res) => {
  const product = await CommerceProduct.create(productPayload(req.body)).catch((e) => rethrowDuplicate(e, 'Product'));
  logActivity(req, 'product.create', { entity: 'product', entity_id: product._id, meta: { sku: product.sku } });
  return ok(res, product, 201);
});

export const adminUpdateProduct = asyncHandler(async (req, res) => {
  const data = productPayload(req.body, { partial: true });
  const product = await CommerceProduct.findByIdAndUpdate(assertObjectId(req.params.id), { $set: data }, { returnDocument: 'after', runValidators: true })
    .catch((e) => rethrowDuplicate(e, 'Product'));
  if (!product) throw new ApiError(404, 'Product not found');
  logActivity(req, 'product.update', { entity: 'product', entity_id: product._id, meta: { fields: Object.keys(data) } });
  return ok(res, product);
});

export const adminDeactivateProduct = asyncHandler(async (req, res) => {
  const product = await CommerceProduct.findByIdAndUpdate(assertObjectId(req.params.id), { $set: { active: false } }, { returnDocument: 'after' });
  if (!product) throw new ApiError(404, 'Product not found');
  logActivity(req, 'product.deactivate', { entity: 'product', entity_id: product._id });
  return ok(res, product);
});

// ---------- inventory (admin / staff / franchise, store-scoped) ----------

export const listInventory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = storeFilter(req, req.query.store_id);
  if (req.query.product_id) filter.product_id = assertObjectId(req.query.product_id, 'product_id');
  if (toBool(req.query.low_only)) filter.$expr = { $lte: [{ $subtract: ['$qty_on_hand', '$reserved'] }, '$reorder_level'] };
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.product_id = { $in: await CommerceProduct.find({ $or: [{ name: rx }, { sku: rx }] }).distinct('_id') };
  }
  const [items, total] = await Promise.all([
    CommerceInventory.find(filter).populate('product_id', 'sku name unit price active').populate('store_id', 'code name')
      .sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceInventory.countDocuments(filter),
  ]);
  for (const row of items) row.available = Math.max(0, row.qty_on_hand - row.reserved);
  return paged(res, { items, total, page, limit });
});

const assertProduct = async (id) => {
  const productId = assertObjectId(id, 'product_id');
  if (!(await CommerceProduct.exists({ _id: productId }))) throw new ApiError(404, 'Product not found');
  return productId;
};

export const adjustInventory = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const storeId = assertStoreAccess(req, body.store_id);
  const productId = await assertProduct(body.product_id);
  const row = await adjustStock({ storeId, productId, delta: body.delta, reason: String(body.reason || '').slice(0, 200), actor: actorOf(req) });
  logActivity(req, 'stock.adjust', { store_id: storeId, entity: 'product', entity_id: productId, meta: { delta: Number(body.delta), reason: body.reason } });
  return ok(res, row);
});

export const transferInventory = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const fromStoreId = assertStoreAccess(req, body.from_store_id);
  const toStoreId = assertStoreAccess(req, body.to_store_id);
  const productId = await assertProduct(body.product_id);
  const result = await transferStock({ fromStoreId, toStoreId, productId, qty: body.qty, reason: String(body.reason || '').slice(0, 200), actor: actorOf(req) });
  logActivity(req, 'stock.transfer', { store_id: fromStoreId, entity: 'product', entity_id: productId, meta: { to_store_id: toStoreId, qty: Number(body.qty) } });
  return ok(res, result);
});

export const setReorderLevel = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const storeId = assertStoreAccess(req, body.store_id);
  const productId = await assertProduct(body.product_id);
  const level = Number(body.reorder_level);
  if (!Number.isInteger(level) || level < 0) throw new ApiError(400, 'reorder_level must be an integer >= 0');
  const row = await CommerceInventory.findOneAndUpdate(
    { store_id: storeId, product_id: productId },
    { $set: { reorder_level: level } },
    { upsert: true, returnDocument: 'after' },
  );
  logActivity(req, 'stock.reorder_level', { store_id: storeId, entity: 'product', entity_id: productId, meta: { reorder_level: level } });
  return ok(res, row);
});

export const listMovements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = storeFilter(req, req.query.store_id);
  if (req.query.product_id) filter.product_id = assertObjectId(req.query.product_id, 'product_id');
  if (req.query.type) filter.type = String(req.query.type);
  const [items, total] = await Promise.all([
    CommerceStockMovement.find(filter).populate('product_id', 'sku name').populate('store_id', 'code name')
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceStockMovement.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const myStores = asyncHandler(async (req, res) =>
  ok(res, await CommerceStore.find({ ...storeFilter(req, null, '_id') }).sort({ name: 1 }).lean()));
