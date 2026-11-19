import { ApiError } from '../../../utils/ApiError.js';
import { RIDE_STATUS } from '../../taxi/constants/index.js';
import { Ride } from '../../taxi/user/models/Ride.js';
import { FranchiseSettlement, SETTLEMENT_STATUS } from '../models/FranchiseSettlement.js';
import {
  buildRideTerritoryFilter,
  computeShare,
  getFranchiseOr404,
  round2,
  ruleFor,
} from './franchiseService.js';

export const completedRidesFilter = async (franchise, start, end) => ({
  ...(await buildRideTerritoryFilter(franchise)),
  status: RIDE_STATUS.COMPLETED,
  completedAt: { $gte: start, $lt: end },
  adminDeletedAt: null,
});

/// Totals per transport type for a franchise's completed rides in [start, end).
export const aggregateFranchiseRides = async (franchise, start, end) => {
  const match = await completedRidesFilter(franchise, start, end);
  const rows = await Ride.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ['$transport_type', 'taxi'] },
        rides: { $sum: 1 },
        gross_fare: { $sum: { $ifNull: ['$fare', 0] } },
        platform_commission: { $sum: { $ifNull: ['$commissionAmount', 0] } },
      },
    },
  ]);

  const breakdown = rows.map((row) => {
    const rule = ruleFor(franchise, row._id);
    return {
      transport_type: row._id,
      rides: row.rides,
      gross_fare: round2(row.gross_fare),
      platform_commission: round2(row.platform_commission),
      franchise_share: computeShare(rule, { fare: row.gross_fare, commission: row.platform_commission }),
      rule_type: rule.type,
      rule_value: rule.value,
    };
  });

  const sum = (key) => round2(breakdown.reduce((acc, row) => acc + row[key], 0));
  return {
    breakdown,
    rides: breakdown.reduce((acc, row) => acc + row.rides, 0),
    gross_fare: sum('gross_fare'),
    platform_commission: sum('platform_commission'),
    franchise_share: sum('franchise_share'),
  };
};

const recomputePayable = (settlement) => {
  const adjustments = settlement.adjustments.reduce((acc, a) => acc + Number(a.amount || 0), 0);
  settlement.payable = round2(settlement.franchise_share + adjustments);
};

export const generateSettlement = async ({ franchiseId, start, end, notes = '' }) => {
  const franchise = await getFranchiseOr404(franchiseId);
  if (end > new Date()) throw new ApiError(400, 'A settlement period cannot end in the future');

  const overlap = await FranchiseSettlement.findOne({
    franchise_id: franchise._id,
    source: 'mobility',
    is_live: true,
    period_start: { $lt: end },
    period_end: { $gt: start },
  }).lean();
  if (overlap) {
    throw new ApiError(409, 'This period overlaps an existing settlement', {
      code: 'SETTLEMENT_OVERLAP',
      settlement_id: overlap._id,
    });
  }

  const totals = await aggregateFranchiseRides(franchise, start, end);
  const settlement = new FranchiseSettlement({
    franchise_id: franchise._id,
    period_start: start,
    period_end: end,
    source: 'mobility',
    ...totals,
    notes,
  });
  recomputePayable(settlement);
  await settlement.save();
  return settlement;
};

const getSettlementOr404 = async (id) => {
  const settlement = await FranchiseSettlement.findById(id);
  if (!settlement) throw new ApiError(404, 'Settlement not found');
  return settlement;
};

/// Re-run the totals of a draft (rides completed late, rule changed).
export const refreshSettlement = async (id) => {
  const settlement = await getSettlementOr404(id);
  if (settlement.status !== SETTLEMENT_STATUS.DRAFT) throw new ApiError(400, 'Only draft settlements can be refreshed');
  const franchise = await getFranchiseOr404(settlement.franchise_id);
  Object.assign(settlement, await aggregateFranchiseRides(franchise, settlement.period_start, settlement.period_end));
  recomputePayable(settlement);
  await settlement.save();
  return settlement;
};

export const addAdjustment = async (id, { amount, reason }, adminId) => {
  const settlement = await getSettlementOr404(id);
  if (settlement.status !== SETTLEMENT_STATUS.DRAFT) throw new ApiError(400, 'Adjustments are only allowed on drafts');
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) throw new ApiError(400, 'amount must be a non-zero number');
  if (!String(reason || '').trim()) throw new ApiError(400, 'reason is required');
  settlement.adjustments.push({ amount: round2(value), reason: String(reason).trim(), by: adminId });
  recomputePayable(settlement);
  await settlement.save();
  return settlement;
};

const TRANSITIONS = {
  approve: { from: [SETTLEMENT_STATUS.DRAFT], to: SETTLEMENT_STATUS.APPROVED },
  pay: { from: [SETTLEMENT_STATUS.APPROVED], to: SETTLEMENT_STATUS.PAID },
  cancel: { from: [SETTLEMENT_STATUS.DRAFT, SETTLEMENT_STATUS.APPROVED], to: SETTLEMENT_STATUS.CANCELLED },
};

export const transitionSettlement = async (id, action, { adminId, payment_reference, payment_mode, notes } = {}) => {
  const rule = TRANSITIONS[action];
  if (!rule) throw new ApiError(400, 'Unknown settlement action');
  const settlement = await getSettlementOr404(id);
  if (!rule.from.includes(settlement.status)) {
    throw new ApiError(400, `Cannot ${action} a settlement that is ${settlement.status}`);
  }
  settlement.status = rule.to;
  if (action === 'approve') {
    settlement.approved_by = adminId;
    settlement.approved_at = new Date();
  }
  if (action === 'pay') {
    if (!String(payment_reference || '').trim()) throw new ApiError(400, 'payment_reference is required');
    settlement.paid_at = new Date();
    settlement.payment_reference = String(payment_reference).trim();
    settlement.payment_mode = String(payment_mode || 'bank_transfer').trim();
  }
  if (action === 'cancel') settlement.is_live = false;
  if (notes) settlement.notes = String(notes).trim();
  await settlement.save();
  return settlement;
};
