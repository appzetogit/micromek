import { ApiError } from '../../../utils/ApiError.js';
import { normalizeAdminType } from '../../taxi/admin/services/adminAccessService.js';
import { assertObjectId, parsePaging, toObjectIds } from '../../franchise/services/franchiseService.js';
import { REVIEW_PERMISSION } from '../constants.js';

export { assertObjectId, parsePaging, toObjectIds };

// ---------- access (mirrors leads/services/access.js) ----------

export const isSuperadmin = (auth) => normalizeAdminType(auth?.admin?.admin_type || auth?.admin?.role) === 'superadmin';

/// Reviewers approve / reject AI output: super admins, or sub admins granted marketing.approve.
export const canReview = (auth) => {
  if (isSuperadmin(auth)) return true;
  const perms = Array.isArray(auth?.admin?.permissions) ? auth.admin.permissions : [];
  return perms.includes('*') || perms.includes(REVIEW_PERMISSION);
};

export const assertReviewer = (auth, action = 'review marketing content') => {
  if (!canReview(auth)) {
    throw new ApiError(403, `Only a super admin or a marketing reviewer can ${action}`, { code: 'REVIEWER_REQUIRED' });
  }
};

export const adminObjectId = (auth) => (auth?.sub ? assertObjectId(auth.sub, 'admin id') : null);

export const actorOf = (req) => ({ kind: 'admin', id: req.auth?.sub || '', name: req.auth?.admin?.name || '' });

// ---------- input helpers ----------

export const pick = (src = {}, keys = []) =>
  Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

export const str = (value, { label = 'value', max = 5000, required = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(400, `${label} is required`);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new ApiError(400, `${label} must be text`);
  const s = String(value).trim();
  if (required && !s) throw new ApiError(400, `${label} is required`);
  if (s.length > max) throw new ApiError(400, `${label} is too long (max ${max} characters)`);
  return s;
};

export const oneOf = (value, allowed, label, fallback) => {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, `${label} is required`);
  }
  if (!allowed.includes(value)) throw new ApiError(400, `${label} must be one of: ${allowed.join(', ')}`);
  return value;
};

export const strList = (value, { label = 'list', max = 50, itemMax = 500 } = {}) => {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  if (list.length > max) throw new ApiError(400, `${label} has too many entries (max ${max})`);
  return [...new Set(list.map((v) => String(v ?? '').trim()).filter(Boolean))].map((v) => {
    if (v.length > itemMax) throw new ApiError(400, `${label} entry is too long`);
    return v;
  });
};

export const dateOrNull = (value, label = 'date') => {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `Invalid ${label}`);
  return d;
};

export const intIn = (value, { min, max, fallback, label = 'value' }) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, `${label} must be between ${min} and ${max}`);
  return n;
};

export const nonNegNumber = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${label} must be a non-negative number`);
  return n;
};

export const envInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const envFloat = (name, fallback) => {
  const n = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(n) ? n : fallback;
};

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const historyEntry = (action, from, to, auth, note = '') => ({
  action, from, to, by: adminObjectId(auth), note, at: new Date(),
});

/// Model registered by another module, or null (read-only cross-module access).
export const modelIfRegistered = (mongoose, name) => (mongoose.modelNames().includes(name) ? mongoose.model(name) : null);
