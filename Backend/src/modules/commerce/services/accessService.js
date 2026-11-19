import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { assertObjectId } from '../../franchise/services/franchiseService.js';

/// Role -> permission matrix for store staff. Admins (super, or sub-admins with
/// 'commerce.view') pass every check and see all stores; franchises are read-only
/// over their own stores; staff are limited to their store_ids.
export const STAFF_PERMISSIONS = Object.freeze({
  store_manager: [
    'catalog.view', 'stock.view', 'stock.adjust', 'stock.transfer',
    'customers.view', 'customers.manage',
    'orders.view', 'orders.create', 'orders.transition',
    'invoices.view', 'invoices.manage', 'payments.record',
    'shipments.view', 'shipments.manage', 'activity.view',
  ],
  sales_staff: [
    'catalog.view', 'stock.view', 'customers.view', 'customers.manage',
    'orders.view', 'orders.create', 'orders.transition',
  ],
  billing_staff: [
    'catalog.view', 'customers.view', 'orders.view', 'invoices.view', 'invoices.manage',
    'payments.record', 'shipments.view',
  ],
});

// Which order statuses each staff role may move an order to (on top of 'orders.transition').
export const STAFF_TRANSITION_TARGETS = Object.freeze({
  store_manager: ['confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
  sales_staff: ['confirmed'],
  billing_staff: [],
});

export const hasStaffPermission = (role, permission) => Boolean(STAFF_PERMISSIONS[role]?.includes(permission));

export const actorOf = (req) => req.commerce?.actor || { type: 'system', id: '', name: 'system' };

/// Route guard. Admin: always. Staff: matrix. Franchise: only *.view. Customer: never.
export const requirePerm = (permission) => (req, _res, next) => {
  const actor = actorOf(req);
  if (actor.type === 'admin') return next();
  if (actor.type === 'staff' && hasStaffPermission(actor.role, permission)) return next();
  if (actor.type === 'franchise' && permission.endsWith('.view')) return next();
  return next(new ApiError(403, `Your role cannot perform ${permission}`));
};

export const canSetOrderStatus = (req, to) => {
  const actor = actorOf(req);
  if (actor.type === 'admin' || actor.type === 'system') return true;
  if (actor.type === 'staff') return STAFF_TRANSITION_TARGETS[actor.role]?.includes(to) || false;
  return false;
};

/// null = all stores; otherwise the ids this caller may touch.
export const scopedStoreIds = (req) => req.commerce?.storeIds ?? null;

/// Mongo filter fragment limiting a query to the caller's stores. An optional
/// requested store_id is validated against the scope.
export const storeFilter = (req, requested, field = 'store_id') => {
  const allowed = scopedStoreIds(req);
  if (requested) return { [field]: assertStoreAccess(req, requested) };
  if (!allowed) return {};
  return { [field]: { $in: allowed.map((id) => new mongoose.Types.ObjectId(id)) } };
};

export const assertStoreAccess = (req, storeId) => {
  const id = assertObjectId(storeId, 'store_id');
  const allowed = scopedStoreIds(req);
  if (allowed && !allowed.includes(String(id))) throw new ApiError(403, 'You do not have access to this store');
  return id;
};
