import { emit } from '../../shared/events.js';
import { CommerceCart } from '../models/Cart.js';
import { CommerceCustomer } from '../models/Customer.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceShipment } from '../models/Shipment.js';
import { adapters } from '../shipping/index.js';
import { refreshTracking } from './shippingService.js';
import { transitionOrder } from './orderService.js';

/// Background work. Every step claims its rows with a conditional update, so
/// running in several processes at once is safe (each row is handled once).
const minutes = (key, fallback) => Math.max(1, Number(process.env[key]) || fallback) * 60_000;

/// Unpaid online orders past COMMERCE_PAYMENT_TIMEOUT_MINUTES (30): cancel, which releases stock.
export const expireUnpaidOrders = async () => {
  const cutoff = new Date(Date.now() - minutes('COMMERCE_PAYMENT_TIMEOUT_MINUTES', 30));
  const stale = await CommerceOrder.find({
    status: 'placed', 'payment.method': 'online', 'payment.status': 'pending', createdAt: { $lt: cutoff },
  }).select('_id').limit(200).lean();
  let expired = 0;
  for (const { _id: id } of stale) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await transitionOrder(null, id, 'cancelled', { system: true, note: 'Payment not completed in time', filter: { 'payment.status': 'pending' } });
      expired += 1;
    } catch {
      // paid or moved meanwhile
    }
  }
  return expired;
};

/// Carts idle > COMMERCE_ABANDONED_CART_MINUTES (60) with items: emit once per idle spell.
export const detectAbandonedCarts = async () => {
  const cutoff = new Date(Date.now() - minutes('COMMERCE_ABANDONED_CART_MINUTES', 60));
  let count = 0;
  for (let i = 0; i < 100; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const cart = await CommerceCart.findOneAndUpdate(
      { abandoned_notified_at: null, item_count: { $gt: 0 }, last_activity_at: { $lt: cutoff } },
      { $set: { abandoned_notified_at: new Date() } },
      { returnDocument: 'after' },
    ).populate('items.product_id', 'name sku price images').lean();
    if (!cart) break;
    // eslint-disable-next-line no-await-in-loop
    const customer = await CommerceCustomer.findById(cart.customer_id).lean();
    emit('commerce.cart.abandoned', { cart, customer });
    count += 1;
  }
  return count;
};

/// Courier shipments without recent webhooks: poll at most every COMMERCE_TRACKING_POLL_MINUTES (30).
export const pollTracking = async () => {
  const pollEvery = minutes('COMMERCE_TRACKING_POLL_MINUTES', 30);
  const now = Date.now();
  const providers = ['shiprocket', 'bigship'].filter((p) => adapters[p].isEnabled());
  if (!providers.length) return 0;
  let polled = 0;
  for (let i = 0; i < 20; i += 1) {
    // Claim by bumping last_polled_at so other processes skip it.
    // eslint-disable-next-line no-await-in-loop
    const shipment = await CommerceShipment.findOneAndUpdate(
      {
        provider: { $in: providers },
        awb: { $ne: null },
        status: { $in: ['booked', 'picked_up', 'in_transit', 'out_for_delivery', 'rto'] },
        $and: [
          { $or: [{ last_polled_at: null }, { last_polled_at: { $lt: new Date(now - pollEvery) } }] },
          { $or: [{ webhook_seen_at: null }, { webhook_seen_at: { $lt: new Date(now - 6 * pollEvery) } }] },
        ],
      },
      { $set: { last_polled_at: new Date() } },
      { sort: { last_polled_at: 1 }, returnDocument: 'after' },
    ).lean();
    if (!shipment) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      await refreshTracking(shipment);
      polled += 1;
    } catch (error) {
      console.warn(`[commerce] tracking ${shipment.provider}/${shipment.awb} failed: ${error.message}`);
    }
  }
  return polled;
};

let timer = null;
let running = false;

/// Starts the commerce background loop (default every 60s). Idempotent; returns a stop function.
export const startCommerceJobs = ({ intervalMs = Number(process.env.COMMERCE_JOBS_INTERVAL_MS) || 60_000 } = {}) => {
  if (timer) return () => {};
  const tick = async () => {
    if (running) return; // never overlap
    running = true;
    try {
      const summary = {
        expired: await expireUnpaidOrders().catch((e) => console.error('[commerce] expire failed', e.message)),
        abandoned: await detectAbandonedCarts().catch((e) => console.error('[commerce] carts failed', e.message)),
        polled: await pollTracking().catch((e) => console.error('[commerce] tracking failed', e.message)),
      };
      if (summary.expired || summary.abandoned || summary.polled) console.log('[commerce-jobs]', JSON.stringify(summary));
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 15_000 + Math.floor(Math.random() * 15_000)).unref?.();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    timer = null;
  };
};
