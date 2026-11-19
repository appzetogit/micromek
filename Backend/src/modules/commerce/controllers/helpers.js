import { ApiError } from '../../../utils/ApiError.js';
import { round2 } from '../services/pricing.js';

export const pick = (src = {}, keys = []) =>
  Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

export const searchRegex = (value) => new RegExp(String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

export const slugify = (value) =>
  String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export const required = (body, keys) => {
  for (const key of keys) {
    if (body?.[key] === undefined || body?.[key] === null || String(body[key]).trim() === '') {
      throw new ApiError(400, `${key} is required`);
    }
  }
};

export const toBool = (v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1' || v === 1);

export const money = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${label} must be a non-negative number`);
  return round2(n);
};

/// Duplicate-key errors as 409s with the offending field.
export const rethrowDuplicate = (error, what = 'Record') => {
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'field';
    throw new ApiError(409, `${what} with this ${field} already exists`);
  }
  throw error;
};

export const sendPdf = (res, buffer, filename) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(buffer);
};
