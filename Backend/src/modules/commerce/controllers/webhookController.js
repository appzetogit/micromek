import crypto from 'node:crypto';
import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok } from '../../shared/guards.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceShipment } from '../models/Shipment.js';
import { applyShipmentUpdate } from '../services/shippingService.js';
import { getAdapter } from '../shipping/index.js';

/// POST /webhooks/shipping/:provider
/// Shared secret in `x-webhook-secret` (or `x-api-key`, which is the header
/// Shiprocket's webhook "token" setting sends). Rejected when SHIPPING_WEBHOOK_SECRET is unset.
const secretMatches = (given) => {
  const expected = process.env.SHIPPING_WEBHOOK_SECRET || '';
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b); // hashing equalises lengths
};

export const shippingWebhook = asyncHandler(async (req, res) => {
  if (!process.env.SHIPPING_WEBHOOK_SECRET) throw new ApiError(503, 'Shipping webhooks are not configured');
  if (!secretMatches(req.get('x-webhook-secret') || req.get('x-api-key'))) throw new ApiError(401, 'Invalid webhook secret');

  const adapter = getAdapter(req.params.provider);
  const update = adapter.parseWebhook(req);
  let shipment = null;
  if (update.awb) shipment = await CommerceShipment.findOne({ provider: adapter.name, awb: update.awb }).lean();
  if (!shipment && update.order_number) {
    const order = await CommerceOrder.findOne({ number: update.order_number }).select('_id').lean();
    if (order) shipment = await CommerceShipment.findOne({ provider: adapter.name, order_id: order._id, active: true }).lean();
  }
  // Ack unknown shipments with 200 so the provider does not retry forever.
  if (!shipment) return ok(res, { matched: false });
  const updated = await applyShipmentUpdate(shipment, update, { fromWebhook: true });
  return ok(res, { matched: true, status: updated.status });
});
