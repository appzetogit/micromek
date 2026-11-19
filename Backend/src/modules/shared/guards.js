import { ApiError } from '../../utils/ApiError.js';
import { authenticate } from '../taxi/middlewares/authMiddleware.js';
import { enforceAdminReadOnly } from '../taxi/middlewares/adminReadOnlyMiddleware.js';
import { hasAdminPermission } from '../taxi/admin/services/adminAccessService.js';

/// Admin login + view-only enforcement + one panel permission, for the
/// modules mounted outside the taxi admin router.
export const adminGuard = (permission) => [
  authenticate(['admin']),
  enforceAdminReadOnly(),
  (req, _res, next) => {
    if (permission && !hasAdminPermission(req.auth.admin, permission)) {
      return next(new ApiError(403, `You do not have permission to access ${permission.split('.')[0]}`));
    }
    return next();
  },
];

export const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

export const paged = (res, { items, total, page, limit }) =>
  res.json({ success: true, data: { items, total, page, limit, pages: Math.ceil(total / limit) || 0 } });
