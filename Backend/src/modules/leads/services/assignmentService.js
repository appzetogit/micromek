import { ApiError } from '../../../utils/ApiError.js';
import { Admin } from '../../taxi/admin/models/Admin.js';
import { hasAdminPermission } from '../../taxi/admin/services/adminAccessService.js';
import { assertObjectId } from '../../franchise/services/franchiseService.js';
import { leadsConfig } from '../config.js';
import { Lead } from '../models/Lead.js';
import { OPEN_LEAD_STATUSES } from '../models/constants.js';

export const LEADS_PERMISSION = 'leads.view';

const isActive = (admin) => admin && admin.active !== false && String(admin.status || 'active').toLowerCase() !== 'inactive';

/// Active, writable admins that can work leads: super admins plus sub admins
/// holding leads.view (or "*").
export const eligibleAdmins = async () => {
  const admins = await Admin.find({ active: { $ne: false }, status: { $ne: 'inactive' }, read_only: { $ne: true } })
    .select('_id name email admin_type role permissions active status read_only')
    .lean();
  return admins.filter((a) => isActive(a) && hasAdminPermission(a, LEADS_PERMISSION));
};

export const assertAssignableAdmin = async (id) => {
  const admin = await Admin.findById(assertObjectId(id, 'admin id'))
    .select('_id name email admin_type role permissions active status read_only')
    .lean();
  if (!admin || !isActive(admin)) throw new ApiError(400, 'Assignee is not an active admin');
  if (admin.read_only) throw new ApiError(400, 'Assignee is a view-only admin');
  if (!hasAdminPermission(admin, LEADS_PERMISSION)) throw new ApiError(400, 'Assignee does not have access to leads');
  return admin;
};

/// Round robin without stored state: the eligible admin whose last automatic
/// assignment is oldest (never-assigned first). Least loaded: fewest open leads.
export const pickAssignee = async (mode = leadsConfig().autoAssign) => {
  if (mode === 'none') return null;
  const admins = await eligibleAdmins();
  if (!admins.length) return null;
  const ids = admins.map((a) => a._id);

  if (mode === 'least_loaded') {
    const loads = await Lead.aggregate([
      { $match: { assigned_to: { $in: ids }, status: { $in: OPEN_LEAD_STATUSES }, deletedAt: null } },
      { $group: { _id: '$assigned_to', n: { $sum: 1 } } },
    ]);
    const byId = new Map(loads.map((l) => [String(l._id), l.n]));
    return [...admins].sort((a, b) => (byId.get(String(a._id)) || 0) - (byId.get(String(b._id)) || 0)
      || String(a._id).localeCompare(String(b._id)))[0];
  }

  const last = await Lead.aggregate([
    { $match: { assigned_to: { $in: ids }, auto_assigned: true } },
    { $group: { _id: '$assigned_to', at: { $max: '$assigned_at' } } },
  ]);
  const byId = new Map(last.map((l) => [String(l._id), new Date(l.at || 0).getTime()]));
  return [...admins].sort((a, b) => (byId.get(String(a._id)) ?? -1) - (byId.get(String(b._id)) ?? -1)
    || String(a._id).localeCompare(String(b._id)))[0];
};
