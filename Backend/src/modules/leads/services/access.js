import { ApiError } from '../../../utils/ApiError.js';
import { normalizeAdminType } from '../../taxi/admin/services/adminAccessService.js';
import { assertObjectId } from '../../franchise/services/franchiseService.js';

/// Sub admins only see leads/conversations assigned to them; super admins see all.
export const isSuperadmin = (auth) => normalizeAdminType(auth?.admin?.admin_type || auth?.admin?.role) === 'superadmin';

export const adminId = (auth) => assertObjectId(auth?.sub, 'admin id');

/// Mongo filter limiting a query on `field` to what this admin may see.
export const scopeFilter = (auth, field = 'assigned_to') => (isSuperadmin(auth) ? {} : { [field]: adminId(auth) });

export const assertSuperadmin = (auth, action = 'do this') => {
  if (!isSuperadmin(auth)) throw new ApiError(403, `Only a super admin can ${action}`);
};

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const csv = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);
