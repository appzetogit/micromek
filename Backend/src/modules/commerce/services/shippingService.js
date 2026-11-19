import { ApiError } from '../../../utils/ApiError.js';
import { emit } from '../../shared/events.js';
import { round2 } from './pricing.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceShipment } from '../models/Shipment.js';
import { CommerceStore } from '../models/Store.js';
import { adapters, getAdapter } from '../shipping/index.js';
import { isForward, orderStatusFor, TERMINAL_SHIPMENT } from '../shipping/status.js';
import { actorOf } from './accessService.js';
import { transitionOrder } from './orderService.js';
import { canTransition } from './pricing.js';

const FORWARD_CHAIN = ['placed', 'confirmed', 'packed', 'shipped', 'delivered'];
const validDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date());

const pickupOf = (store) => ({
  name: store.name,
  phone: store.phone,
  ...store.address,
  lng: store.location?.coordinates?.[0] ?? null,
  lat: store.location?.coordinates?.[1] ?? null,
  shiprocket_pickup: store.shiprocket_pickup || '',
});

const draftFor = (order, store, pkg = {}) => {
  const weight = Number(pkg.weight_kg) || round2(order.items.reduce((a, i) => a + (i.weight_kg || 0), 0)) || 0.5;
  const due = round2(order.totals.grand_total - (order.payment.paid_amount || 0));
  return {
    pickup: pickupOf(store),
    drop: order.ship_to,
    package: {
      weight_kg: weight,
      length_cm: Number(pkg.length_cm) || 10,
      breadth_cm: Number(pkg.breadth_cm) || 10,
      height_cm: Number(pkg.height_cm) || 10,
    },
    // Cash-on-delivery only for unpaid cash orders.
    cod_amount: order.payment.method === 'cash' && due > 0 ? due : 0,
    invoice_value: order.totals.grand_total,
  };
};

const assertShippable = (order) => {
  if (order.fulfilment !== 'delivery' || !order.ship_to) throw new ApiError(409, 'Order is not for delivery');
  if (!['confirmed', 'packed'].includes(order.status)) throw new ApiError(409, `Cannot ship a ${order.status} order`);
  if (order.payment.method === 'online' && order.payment.status !== 'paid') throw new ApiError(409, 'Online payment not received yet');
};

/// Rates from one provider, or every enabled one (errors per provider are returned, not thrown).
export const quoteForOrder = async (order, { provider, package: pkg } = {}) => {
  const store = await CommerceStore.findById(order.store_id).lean();
  const draft = draftFor(order, store, pkg);
  const names = provider ? [getAdapter(provider).name] : Object.keys(adapters).filter((k) => adapters[k].isEnabled());
  const results = await Promise.all(names.map(async (name) => {
    try {
      return { provider: name, rates: await adapters[name].quoteRates(draft) };
    } catch (error) {
      if (provider) throw error;
      return { provider: name, rates: [], error: error.message };
    }
  }));
  return { package: draft.package, cod_amount: draft.cod_amount, providers: results };
};

/// Walks the order forward to the status a shipment implies (packed -> shipped -> delivered, or -> returned).
const syncOrder = async (orderId, shipmentStatus) => {
  const target = orderStatusFor(shipmentStatus);
  if (!target) return CommerceOrder.findById(orderId).lean();
  let order = await CommerceOrder.findById(orderId).lean();
  for (let guard = 0; order && order.status !== target && guard < 5; guard += 1) {
    let next = null;
    if (target === 'returned') next = canTransition(order.status, 'returned') ? 'returned' : null;
    else {
      const at = FORWARD_CHAIN.indexOf(order.status);
      const want = FORWARD_CHAIN.indexOf(target);
      if (at < 0 || want <= at) break;
      next = canTransition(order.status, target) ? target : FORWARD_CHAIN[at + 1];
    }
    if (!next) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      order = (await transitionOrder(null, orderId, next, { system: true, note: `Shipment ${shipmentStatus}` })).toObject();
    } catch (error) {
      console.warn(`[commerce] order ${orderId} not moved to ${next}: ${error.message}`);
      break;
    }
  }
  return order;
};

/// Applies a provider status to a shipment (forward-only), records the event, and syncs the order.
export const applyShipmentUpdate = async (shipment, update, { fromWebhook = false } = {}) => {
  const event = {
    status: update.status || shipment.status,
    raw_status: String(update.raw_status || '').slice(0, 120),
    location: String(update.location || '').slice(0, 120),
    note: String(update.note || '').slice(0, 300),
    at: validDate(update.at),
  };
  const meta = fromWebhook ? { webhook_seen_at: new Date() } : { last_polled_at: new Date() };
  const moving = update.status && isForward(shipment.status, update.status);
  const set = { ...meta, ...(update.tracking_url ? { tracking_url: update.tracking_url } : {}) };
  if (moving) {
    set.status = update.status;
    if (['cancelled', 'failed'].includes(update.status)) set.active = false;
  }
  const lastRaw = shipment.events?.[shipment.events.length - 1]?.raw_status;
  const push = moving || (event.raw_status && event.raw_status !== lastRaw) ? { $push: { events: { $each: [event], $slice: -200 } } } : {};
  const updated = await CommerceShipment.findOneAndUpdate(
    { _id: shipment._id, status: shipment.status },
    { $set: set, ...push },
    { returnDocument: 'after' },
  );
  if (!updated) return CommerceShipment.findById(shipment._id).lean(); // raced with another update; it wins
  if (moving) {
    const order = await syncOrder(updated.order_id, updated.status);
    emit('commerce.shipment.updated', { shipment: updated.toObject(), order });
  }
  return updated.toObject();
};

/// Books a shipment with a provider. Unique (order_id, active) index stops double booking.
export const bookShipment = async (req, order, { provider, courier_id: courierId, package: pkg } = {}) => {
  assertShippable(order);
  const adapter = getAdapter(provider);
  if (!adapter.isEnabled()) {
    throw new ApiError(503, `${adapter.name} shipping is not configured; see commerce README for its env vars`, { code: 'SHIPPING_PROVIDER_DISABLED' });
  }
  const store = await CommerceStore.findById(order.store_id).lean();
  const draft = draftFor(order, store, pkg);

  let shipment;
  try {
    shipment = await CommerceShipment.create({
      order_id: order._id,
      store_id: order.store_id,
      franchise_id: order.franchise_id,
      provider: adapter.name,
      status: 'created',
      active: true,
      courier_id: courierId ? String(courierId) : '',
      package: draft.package,
      pickup: draft.pickup,
      drop: draft.drop,
      cod_amount: draft.cod_amount,
      created_by: actorOf(req),
    });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, 'Order already has an active shipment', { code: 'SHIPMENT_EXISTS' });
    throw error;
  }

  if (order.status === 'confirmed') {
    try {
      await transitionOrder(req, order._id, 'packed', { system: true, note: 'Packed for shipping' });
    } catch (error) {
      await CommerceShipment.updateOne({ _id: shipment._id }, { $set: { status: 'failed', active: false, error: error.message } });
      throw error;
    }
  }

  let result;
  try {
    result = await adapter.createShipment(order, { ...draft, courier_id: courierId ? String(courierId) : '' });
  } catch (error) {
    await CommerceShipment.updateOne({ _id: shipment._id }, { $set: { status: 'failed', active: false, error: error.message } });
    throw error;
  }
  const set = {
    status: result.status,
    awb: result.awb || null,
    courier_id: result.courier_id || shipment.courier_id,
    courier_name: result.courier_name || '',
    provider_order_id: result.provider_order_id || '',
    provider_shipment_id: result.provider_shipment_id || '',
    tracking_url: result.tracking_url || '',
    platform_delivery_id: result.platform_delivery_id || null,
    charge: round2(result.charge || 0),
    error: result.error || '',
  };
  const saved = await CommerceShipment.findByIdAndUpdate(
    shipment._id,
    { $set: set, $push: { events: { status: result.status, raw_status: result.raw_status || '', at: new Date() } } },
    { returnDocument: 'after' },
  ).lean();
  const updatedOrder = await CommerceOrder.findByIdAndUpdate(order._id, { $set: { shipment_id: saved._id } }, { returnDocument: 'after' }).lean();
  emit('commerce.shipment.updated', { shipment: saved, order: updatedOrder });
  return saved;
};

export const refreshTracking = async (shipment) => {
  if (!shipment.awb || TERMINAL_SHIPMENT.includes(shipment.status)) return shipment;
  const tracked = await getAdapter(shipment.provider).track(shipment.awb);
  if (!tracked) {
    await CommerceShipment.updateOne({ _id: shipment._id }, { $set: { last_polled_at: new Date() } });
    return shipment;
  }
  return applyShipmentUpdate(shipment, tracked);
};

export const cancelShipment = async (shipment) => {
  if (TERMINAL_SHIPMENT.includes(shipment.status)) throw new ApiError(409, `Shipment is already ${shipment.status}`);
  if (['picked_up', 'in_transit', 'out_for_delivery', 'rto'].includes(shipment.status)) {
    throw new ApiError(409, 'Shipment is already with the courier; raise an RTO with the provider instead');
  }
  if (shipment.awb || shipment.provider_order_id) await getAdapter(shipment.provider).cancel(shipment);
  return applyShipmentUpdate(shipment, { status: 'cancelled', raw_status: 'CANCELLED', note: 'Cancelled by staff' });
};
