import { dateOnly } from '../platform/kit';

export const MODULE = 'Franchise';

export const FRANCHISE_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];
export const BUSINESS_TYPES = ['mobility', 'commerce', 'both'];
export const SETTLEMENT_STATUSES = ['draft', 'approved', 'paid', 'cancelled'];
export const SETTLEMENT_CYCLES = ['weekly', 'fortnightly', 'monthly'];
export const TRANSPORT_TYPES = ['taxi', 'delivery', 'intercity'];
export const SHARE_TYPES = [
  { value: 'percent_of_commission', label: '% of platform commission' },
  { value: 'percent_of_fare', label: '% of fare' },
];

/** Status actions per current status, mirroring the backend STATUS_ACTIONS. */
export const STATUS_ACTIONS = {
  pending: ['approve', 'reject'],
  rejected: ['approve'],
  approved: ['suspend'],
  suspended: ['reactivate'],
};

export const ruleLabel = (rule) =>
  rule ? `${rule.value ?? 0}% of ${rule.type === 'percent_of_fare' ? 'fare' : 'commission'}` : '—';

/**
 * Turn two <input type="date"> values (inclusive days) into the backend's
 * [from, to) ISO range. `to` is clamped to now, since settlements and
 * performance windows cannot end in the future.
 */
export const toIsoRange = (fromDay, toDay) => {
  const from = new Date(`${fromDay}T00:00:00`);
  const end = new Date(`${toDay}T00:00:00`);
  end.setDate(end.getDate() + 1);
  const now = new Date();
  return { from: from.toISOString(), to: (end > now ? now : end).toISOString() };
};

/** Franchise names from a 409 TERRITORY_TAKEN error, or null. */
export const territoryConflict = (err) =>
  err?.details?.code === 'TERRITORY_TAKEN' ? err.details.franchises || [] : null;

/** The populated ref's name, or the raw id. */
export const refName = (ref) => (ref && typeof ref === 'object' ? ref.name : ref) || '—';
export const refId = (ref) => (ref && typeof ref === 'object' ? ref._id : ref);

/** period_end is exclusive; show the last included day. */
export const periodText = (s) =>
  `${dateOnly(s.period_start)} – ${dateOnly(new Date(new Date(s.period_end).getTime() - 1))}`;
