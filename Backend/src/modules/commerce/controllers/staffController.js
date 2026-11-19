import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok, paged } from '../../shared/guards.js';
import { comparePassword, hashPassword } from '../../taxi/services/passwordService.js';
import { signAccessToken } from '../../taxi/services/tokenService.js';
import { assertObjectId, parsePaging, parsePeriod, toObjectIds } from '../../franchise/services/franchiseService.js';
import { CommerceActivityLog } from '../models/ActivityLog.js';
import { CommerceCustomer } from '../models/Customer.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceStaff, STAFF_ROLES } from '../models/Staff.js';
import { CommerceStore } from '../models/Store.js';
import { STAFF_TOKEN_ROLE } from '../middlewares/commerceAuth.js';
import { STAFF_PERMISSIONS, STAFF_TRANSITION_TARGETS, assertStoreAccess, scopedStoreIds, storeFilter } from '../services/accessService.js';
import { logActivity, withActivityLabels } from '../services/activityService.js';
import { lowStock, salesReport, staffPerformance, topProducts } from '../services/reportService.js';
import { money, pick, required, rethrowDuplicate, searchRegex, toBool } from './helpers.js';

const GSTIN_RX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const assertPassword = (password) => {
  if (typeof password !== 'string' || password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
};

// =================== staff auth ===================

export const staffLogin = asyncHandler(async (req, res) => {
  const identifier = String(req.body?.mobile || req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!identifier || !password) throw new ApiError(400, 'mobile (or email) and password are required');
  const staff = await CommerceStaff.findOne({ $or: [{ mobile: identifier }, { email: identifier }] }).select('+password');
  if (!staff || !(await comparePassword(password, staff.password))) throw new ApiError(401, 'Invalid credentials');
  if (!staff.active) throw new ApiError(403, 'Staff account is inactive');
  await CommerceStaff.updateOne({ _id: staff._id }, { $set: { last_login_at: new Date() } });
  req.commerce = { actor: { type: 'staff', id: String(staff._id), name: staff.name, role: staff.role } };
  logActivity(req, 'staff.login', { entity: 'staff', entity_id: staff._id, label: staff.name });
  const token = signAccessToken({ sub: String(staff._id), role: STAFF_TOKEN_ROLE });
  return ok(res, { token, staff: staff.toJSON(), permissions: STAFF_PERMISSIONS[staff.role] });
});

export const staffMe = asyncHandler(async (req, res) => {
  const { staff } = req.commerce;
  const stores = await CommerceStore.find({ _id: { $in: staff.store_ids } }).select('code name address active').lean();
  const { password, ...safe } = staff;
  return ok(res, { ...safe, stores, permissions: STAFF_PERMISSIONS[staff.role], can_set_status: STAFF_TRANSITION_TARGETS[staff.role] });
});

export const staffChangePassword = asyncHandler(async (req, res) => {
  const staff = await CommerceStaff.findById(req.commerce.staff._id).select('+password');
  if (!(await comparePassword(String(req.body?.current_password || ''), staff.password))) throw new ApiError(400, 'Current password is wrong');
  assertPassword(req.body?.new_password);
  staff.password = await hashPassword(req.body.new_password);
  await staff.save();
  logActivity(req, 'staff.password_change', { entity: 'staff', entity_id: staff._id, label: staff.name });
  return ok(res, { changed: true });
});

// =================== admin: staff CRUD ===================

const staffPayload = async (body = {}, { partial = false } = {}) => {
  if (!partial) required(body, ['name', 'mobile', 'role', 'password']);
  const out = pick(body, ['name', 'mobile']);
  if (body.email !== undefined) out.email = String(body.email || '').trim().toLowerCase() || undefined;
  if (body.role !== undefined) {
    if (!STAFF_ROLES.includes(body.role)) throw new ApiError(400, `role must be one of ${STAFF_ROLES.join(', ')}`);
    out.role = body.role;
  }
  if (body.store_ids !== undefined) {
    out.store_ids = toObjectIds(body.store_ids);
    if ((await CommerceStore.countDocuments({ _id: { $in: out.store_ids } })) !== out.store_ids.length) throw new ApiError(400, 'One or more stores do not exist');
  }
  if (!partial && !out.store_ids?.length) throw new ApiError(400, 'store_ids must list at least one store');
  if (body.active !== undefined) out.active = toBool(body.active);
  if (body.password !== undefined) {
    assertPassword(body.password);
    out.password = await hashPassword(body.password);
  }
  return out;
};

export const adminListStaff = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = {};
  if (req.query.role) filter.role = String(req.query.role);
  if (req.query.store_id) filter.store_ids = assertObjectId(req.query.store_id, 'store_id');
  if (req.query.active !== undefined) filter.active = toBool(req.query.active);
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ name: rx }, { mobile: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    CommerceStaff.find(filter).populate('store_ids', 'code name').sort({ name: 1 }).skip(skip).limit(limit).lean(),
    CommerceStaff.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const adminCreateStaff = asyncHandler(async (req, res) => {
  const data = await staffPayload(req.body);
  const staff = await CommerceStaff.create({ ...data, created_by: req.commerce.actor.id }).catch((e) => rethrowDuplicate(e, 'Staff'));
  logActivity(req, 'staff.create', { entity: 'staff', entity_id: staff._id, label: staff.name, meta: { role: staff.role } });
  return ok(res, staff.toJSON(), 201);
});

export const adminUpdateStaff = asyncHandler(async (req, res) => {
  const data = await staffPayload(req.body, { partial: true });
  const update = { $set: data };
  if (data.email === undefined && req.body?.email !== undefined) {
    delete data.email;
    update.$unset = { email: 1 };
  }
  const staff = await CommerceStaff.findByIdAndUpdate(assertObjectId(req.params.id), update, { returnDocument: 'after', runValidators: true })
    .catch((e) => rethrowDuplicate(e, 'Staff'));
  if (!staff) throw new ApiError(404, 'Staff not found');
  logActivity(req, 'staff.update', { entity: 'staff', entity_id: staff._id, label: staff.name, meta: { fields: Object.keys(data).filter((k) => k !== 'password') } });
  return ok(res, staff.toJSON());
});

export const adminDeactivateStaff = asyncHandler(async (req, res) => {
  const staff = await CommerceStaff.findByIdAndUpdate(assertObjectId(req.params.id), { $set: { active: false } }, { returnDocument: 'after' });
  if (!staff) throw new ApiError(404, 'Staff not found');
  logActivity(req, 'staff.deactivate', { entity: 'staff', entity_id: staff._id, label: staff.name });
  return ok(res, staff.toJSON());
});

// =================== customers (staff / admin) ===================

const CUSTOMER_ORDER_FIELDS = 'number store_id status type channel payment.method payment.status payment.paid_amount payment.refunded_amount payment.due_date totals.grand_total createdAt';

/// Balance over the customer's orders within `scope`. Cancelled and returned orders are not billed.
///   billed       sum of grand_total
///   paid         paid_amount less refunds paid out, on billed orders
///   outstanding  unpaid balance of billed orders that are still pending / partially paid
///   credit_due   the part of outstanding on credit (wholesale) orders: what the credit limit checks
///   refund_due   money still owed back (paid less refunded) on cancelled / returned orders
const customerBalance = async (customerId, scope = {}) => {
  const billed = { $not: [{ $in: ['$status', ['cancelled', 'returned']] }] };
  const unpaid = { $and: [billed, { $in: ['$payment.status', ['pending', 'partial']] }] };
  const balance = { $max: [0, { $subtract: ['$totals.grand_total', '$payment.paid_amount'] }] };
  const refunded = { $ifNull: ['$payment.refunded_amount', 0] };
  const [row] = await CommerceOrder.aggregate([
    { $match: { customer_id: new mongoose.Types.ObjectId(String(customerId)), ...scope } },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        billed_orders: { $sum: { $cond: [billed, 1, 0] } },
        billed: { $sum: { $cond: [billed, '$totals.grand_total', 0] } },
        paid: { $sum: { $cond: [billed, { $subtract: ['$payment.paid_amount', refunded] }, 0] } },
        outstanding: { $sum: { $cond: [unpaid, balance, 0] } },
        credit_due: { $sum: { $cond: [{ $and: [unpaid, { $eq: ['$payment.method', 'credit'] }] }, balance, 0] } },
        refund_due: { $sum: { $cond: [billed, 0, { $max: [0, { $subtract: ['$payment.paid_amount', refunded] }] }] } },
        refunded: { $sum: refunded },
        last_order_at: { $max: '$createdAt' },
      },
    },
  ]);
  const r2 = (n) => Math.round((n || 0) * 100) / 100;
  return {
    orders: row?.orders || 0,
    billed_orders: row?.billed_orders || 0,
    billed: r2(row?.billed),
    paid: r2(row?.paid),
    outstanding: r2(row?.outstanding),
    credit_due: r2(row?.credit_due),
    refund_due: r2(row?.refund_due),
    refunded: r2(row?.refunded),
    last_order_at: row?.last_order_at || null,
  };
};

/// Staff see customers whose home store is one of theirs or who have no home store
/// (shared customer base: one vendor). Admin sees all.
const customerScope = (req) => {
  const ids = scopedStoreIds(req);
  if (!ids) return {};
  return { $or: [{ home_store_id: null }, { home_store_id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }] };
};

const customerPayload = (req, body = {}, { partial = false } = {}) => {
  if (!partial) required(body, ['name', 'phone']);
  const out = pick(body, ['name', 'phone', 'email', 'business_name', 'notes']);
  if (body.type !== undefined) {
    if (!['retail', 'wholesale'].includes(body.type)) throw new ApiError(400, 'type must be retail or wholesale');
    out.type = body.type;
  }
  if (body.gstin !== undefined) {
    const g = String(body.gstin || '').trim().toUpperCase();
    if (g && !GSTIN_RX.test(g)) throw new ApiError(400, 'Invalid GSTIN');
    out.gstin = g;
  }
  if (body.addresses !== undefined) {
    out.addresses = (Array.isArray(body.addresses) ? body.addresses : []).slice(0, 20)
      .map((a) => pick(a || {}, ['label', 'name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode', 'lat', 'lng']));
  }
  if (body.home_store_id !== undefined) out.home_store_id = body.home_store_id ? assertStoreAccess(req, body.home_store_id) : null;
  if (body.credit_limit !== undefined) {
    if (req.commerce.actor.type === 'staff' && req.commerce.actor.role !== 'store_manager') throw new ApiError(403, 'Only managers can set credit limits');
    out.credit_limit = money(body.credit_limit, 'credit_limit');
  }
  if (body.active !== undefined) out.active = toBool(body.active);
  return out;
};

export const listCustomers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { ...customerScope(req) };
  if (req.query.type) filter.type = String(req.query.type);
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$and = [{ $or: [{ name: rx }, { phone: rx }, { business_name: rx }, { gstin: rx }] }];
  }
  const [items, total] = await Promise.all([
    CommerceCustomer.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceCustomer.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

const scopedCustomer = async (req) => {
  const customer = await CommerceCustomer.findOne({ _id: assertObjectId(req.params.id), ...customerScope(req) }).lean();
  if (!customer) throw new ApiError(404, 'Customer not found');
  return customer;
};

/// Customer plus balance summary and latest orders, both limited to the caller's stores.
/// ?orders_limit (default 10, max 50, 0 = none); page through GET /customers/:id/orders.
export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await scopedCustomer(req);
  const scope = storeFilter(req);
  const ordersLimit = Math.min(50, Math.max(0, Number(req.query.orders_limit ?? 10) || 0));
  const [summary, orders] = await Promise.all([
    customerBalance(customer._id, scope),
    ordersLimit
      ? CommerceOrder.find({ customer_id: customer._id, ...scope }).select(CUSTOMER_ORDER_FIELDS)
        .populate('store_id', 'code name').sort({ createdAt: -1 }).limit(ordersLimit).lean()
      : [],
  ]);
  return ok(res, { ...customer, summary: { ...summary, credit_limit: customer.credit_limit || 0 }, recent_orders: orders });
});

/// GET /customers/:id/orders?page&limit&status&payment_status&store_id: the customer's orders in
/// the caller's stores, plus the same balance summary.
export const customerOrders = asyncHandler(async (req, res) => {
  const customer = await scopedCustomer(req);
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { customer_id: customer._id, ...storeFilter(req, req.query.store_id) };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.payment_status) filter['payment.status'] = String(req.query.payment_status);
  const [items, total, summary] = await Promise.all([
    CommerceOrder.find(filter).select(CUSTOMER_ORDER_FIELDS).populate('store_id', 'code name')
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceOrder.countDocuments(filter),
    customerBalance(customer._id, storeFilter(req)),
  ]);
  return ok(res, {
    items, total, page, limit, pages: Math.ceil(total / limit) || 0, summary: { ...summary, credit_limit: customer.credit_limit || 0 },
  });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const data = customerPayload(req, req.body);
  if (!data.home_store_id && req.commerce.storeIds?.length === 1) data.home_store_id = req.commerce.storeIds[0];
  const customer = await CommerceCustomer.create(data);
  logActivity(req, 'customer.create', { store_id: customer.home_store_id, entity: 'customer', entity_id: customer._id, label: customer.name });
  return ok(res, customer, 201);
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const data = customerPayload(req, req.body, { partial: true });
  const customer = await CommerceCustomer.findOneAndUpdate(
    { _id: assertObjectId(req.params.id), ...customerScope(req) },
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  );
  if (!customer) throw new ApiError(404, 'Customer not found');
  logActivity(req, 'customer.update', { store_id: customer.home_store_id, entity: 'customer', entity_id: customer._id, label: customer.name, meta: { fields: Object.keys(data) } });
  return ok(res, customer);
});

// =================== activity & reports ===================

export const listActivity = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = {};
  const ids = scopedStoreIds(req);
  if (req.query.store_id) filter.store_id = assertStoreAccess(req, req.query.store_id);
  else if (ids) filter.store_id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
  if (req.query.actor_id) filter['actor.id'] = String(req.query.actor_id);
  if (req.query.actor_type) filter['actor.type'] = String(req.query.actor_type);
  if (req.query.action) filter.action = searchRegex(req.query.action);
  if (req.query.entity) filter.entity = String(req.query.entity);
  if (req.query.entity_id) filter.entity_id = String(req.query.entity_id);
  if (req.query.from || req.query.to) {
    const { start, end } = parsePeriod(req.query);
    filter.createdAt = { $gte: start, $lt: end };
  }
  const [items, total] = await Promise.all([
    CommerceActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceActivityLog.countDocuments(filter),
  ]);
  return paged(res, { items: await withActivityLabels(items), total, page, limit });
});

const reportScope = (req) => {
  const scope = storeFilter(req, req.query.store_id);
  if (req.query.franchise_id && req.commerce.actor.type === 'admin') scope.franchise_id = assertObjectId(req.query.franchise_id, 'franchise_id');
  return scope;
};

export const reportSales = asyncHandler(async (req, res) => {
  const { start, end } = parsePeriod(req.query);
  return ok(res, await salesReport({ scope: reportScope(req), start, end, group: String(req.query.group || 'day') }));
});

export const reportTopProducts = asyncHandler(async (req, res) => {
  const { start, end } = parsePeriod(req.query);
  return ok(res, await topProducts({ scope: reportScope(req), start, end, limit: req.query.limit }));
});

export const reportLowStock = asyncHandler(async (req, res) =>
  ok(res, await lowStock({ scope: storeFilter(req, req.query.store_id), limit: req.query.limit })));

export const reportStaff = asyncHandler(async (req, res) => {
  const { start, end } = parsePeriod(req.query);
  // franchise_id (admin only) filters on the order's franchise_id, i.e. the store's franchise when the
  // order was placed - the same rule as the sales report, since this report aggregates orders.
  return ok(res, await staffPerformance({ scope: reportScope(req), start, end }));
});
