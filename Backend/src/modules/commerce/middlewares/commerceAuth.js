import { ApiError } from '../../../utils/ApiError.js';
import { verifyAccessToken } from '../../taxi/services/tokenService.js';
import { CommerceCustomer } from '../models/Customer.js';
import { CommerceStaff } from '../models/Staff.js';
import { CommerceStore } from '../models/Store.js';

/// Every commerce request carries req.commerce = { actor, storeIds, customer? }:
///   actor    { type: staff|admin|franchise|customer, id, name, role }
///   storeIds null = all stores, else the string ids this caller may touch.

export const STAFF_TOKEN_ROLE = 'commerce_staff';

/// Store-staff JWT (role 'commerce_staff', issued by POST /commerce/staff/auth/login).
export const staffAuth = async (req, _res, next) => {
  try {
    const [scheme, token] = String(req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'Authorization token is required');
    const payload = verifyAccessToken(token);
    if (payload.role !== STAFF_TOKEN_ROLE) throw new ApiError(403, 'Store staff token required');
    const staff = await CommerceStaff.findById(payload.sub).lean();
    if (!staff || !staff.active) throw new ApiError(401, 'Staff account is not active');
    req.commerce = {
      actor: { type: 'staff', id: String(staff._id), name: staff.name, role: staff.role },
      staff,
      storeIds: (staff.store_ids || []).map(String),
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

/// After adminGuard('commerce.view'): admins see every store.
export const adminScope = (req, _res, next) => {
  const admin = req.auth?.admin || {};
  req.commerce = { actor: { type: 'admin', id: admin.id, name: admin.name || admin.email, role: admin.admin_type }, storeIds: null };
  next();
};

/// After authenticate(['franchise']): read-only over the stores allocated to it.
export const franchiseScope = async (req, _res, next) => {
  try {
    const franchise = req.auth.entity;
    if (franchise.business_type === 'mobility') throw new ApiError(403, 'This franchise is not enabled for commerce');
    const ids = await CommerceStore.find({ franchise_id: franchise._id }).distinct('_id');
    req.commerce = {
      actor: { type: 'franchise', id: String(franchise._id), name: franchise.name, role: 'franchise' },
      franchise,
      storeIds: ids.map(String),
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

/// After authenticate(['user']): finds or creates the commerce customer for this app user.
export const customerScope = async (req, _res, next) => {
  try {
    const user = req.auth.entity;
    const find = () => CommerceCustomer.findOneAndUpdate(
      { user_id: user._id },
      { $setOnInsert: { type: 'retail', name: user.name || 'Customer', phone: user.phone || '', email: user.email || '' } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    let customer;
    try {
      customer = await find();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      customer = await find(); // concurrent first request created it
    }
    req.commerce = { actor: { type: 'customer', id: String(customer._id), name: customer.name, role: 'customer' }, customer, storeIds: null };
    return next();
  } catch (error) {
    return next(error);
  }
};
