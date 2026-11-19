import { on } from '../../shared/events.js';
import { activity, findOpenLeadByPhone, phoneOf, pushActivity } from './leadService.js';
import { notifyCustomer } from './whatsappService.js';

/// Commerce -> WhatsApp notifications. Payloads may be plain objects or
/// mongoose documents; only the fields below are read (see README).

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject({ depopulate: false }) : doc) || {};
const norm = (status) => String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export const STATUS_GROUPS = Object.freeze({
  confirmed: ['confirmed', 'placed', 'paid', 'processing', 'accepted'],
  payment_pending: ['pending_payment', 'payment_pending', 'awaiting_payment', 'unpaid'],
  shipped: ['shipped', 'dispatched', 'in_transit', 'picked_up', 'out_for_delivery'],
  delivered: ['delivered', 'completed'],
});
const groupOf = (status) => Object.keys(STATUS_GROUPS).find((g) => STATUS_GROUPS[g].includes(norm(status))) || null;

const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const prefix = process.env.WA_CURRENCY_PREFIX ?? '₹';
  return `${prefix}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/// Everything a template parameter may refer to (config.js `params`).
export const buildContext = (orderDoc, shipmentDoc) => {
  const order = plain(orderDoc);
  const shipment = plain(shipmentDoc || order.shipment);
  const id = String(order._id || order.id || '');
  const customer = order.customer && typeof order.customer === 'object' ? order.customer : {};
  const address = order.shipping_address || {};
  return {
    order_id: id,
    number: String(order.number || order.order_number || id),
    status: norm(order.status),
    total: money(order.grand_total ?? order.total ?? order.totals?.grand_total),
    name: String(customer.name || address.name || order.customer_name || 'Customer'),
    phone: customer.phone || address.phone || order.customer_phone || '',
    awb: String(shipment.awb || shipment.awb_code || ''),
    tracking_url: String(shipment.tracking_url || ''),
    courier: String(shipment.courier || shipment.courier_name || ''),
  };
};

const notifyForGroup = async (group, ctx) => {
  if (!ctx.order_id || !ctx.phone) return null;
  const kind = {
    confirmed: 'order_confirmed',
    payment_pending: 'payment_reminder',
    shipped: 'order_shipped',
    delivered: 'order_delivered',
  }[group];
  if (!kind) return null;
  return notifyCustomer(kind, { phone: ctx.phone, name: ctx.name, ctx, dedupeKey: `order:${ctx.order_id}:${kind}` });
};

const linkOrderToLead = async (ctx) => {
  const lead = await findOpenLeadByPhone(phoneOf(ctx.phone));
  if (!lead) return;
  if (!lead.order_id && /^[a-f0-9]{24}$/i.test(ctx.order_id)) lead.order_id = ctx.order_id;
  if (!lead.order_number) lead.order_number = ctx.number;
  if (lead.type === 'enquiry') lead.type = 'order';
  pushActivity(lead, activity('order', { note: `Order ${ctx.number} placed${ctx.total ? ` (${ctx.total})` : ''}`, meta: { order_id: ctx.order_id } }));
  await lead.save();
};

export const onOrderCreated = async ({ order } = {}) => {
  const ctx = buildContext(order);
  await linkOrderToLead(ctx).catch((e) => console.warn('[leads] link order failed', e.message));
  await notifyForGroup(groupOf(ctx.status) === 'payment_pending' ? 'payment_pending' : 'confirmed', ctx);
};

export const onOrderStatusChanged = async ({ order, to } = {}) => {
  const ctx = buildContext(order);
  await notifyForGroup(groupOf(to || ctx.status), ctx);
};

export const onShipmentUpdated = async ({ shipment, order } = {}) => {
  const s = plain(shipment);
  const group = groupOf(s.status);
  if (group !== 'shipped' && group !== 'delivered') return;
  await notifyForGroup(group, buildContext(order || s.order, shipment));
};

export const onCartAbandoned = async ({ cart, customer } = {}) => {
  const c = plain(cart);
  const cust = plain(customer || c.customer);
  const phone = cust.phone || c.phone || c.customer_phone || '';
  const id = String(c._id || c.id || '');
  if (!phone || !id) return;
  const day = new Date().toISOString().slice(0, 10);
  await notifyCustomer('cart_reminder', {
    phone,
    name: cust.name || '',
    ctx: { name: cust.name || 'Customer', total: money(c.total ?? c.subtotal), cart_id: id },
    dedupeKey: `cart:${id}:${day}`,
  });
};

let registered = false;

export const registerLeadEventListeners = () => {
  if (registered) return;
  registered = true;
  on('commerce.order.created', onOrderCreated);
  on('commerce.order.status_changed', onOrderStatusChanged);
  on('commerce.shipment.updated', onShipmentUpdated);
  on('commerce.cart.abandoned', onCartAbandoned);
};
