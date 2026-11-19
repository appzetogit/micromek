import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ok, paged } from '../../shared/guards.js';
import { assertObjectId, parsePaging, parsePeriod } from '../../franchise/services/franchiseService.js';
import { CommerceCart } from '../models/Cart.js';
import { CommerceCustomer } from '../models/Customer.js';
import { CommerceInvoice } from '../models/Invoice.js';
import { CommerceOrder, ORDER_CHANNELS, PAYMENT_METHODS } from '../models/Order.js';
import { CommerceProduct } from '../models/Product.js';
import { CommerceShipment } from '../models/Shipment.js';
import { actorOf, assertStoreAccess, storeFilter } from '../services/accessService.js';
import { logActivity } from '../services/activityService.js';
import { availabilityMap } from '../services/inventoryService.js';
import { issueInvoice, renderInvoicePdf } from '../services/invoiceService.js';
import { createOrder, getStoreOr404, recordPayment, transitionOrder } from '../services/orderService.js';
import { createRazorpayOrder, verifyRazorpayPayment } from '../services/paymentService.js';
import { ORDER_STATUSES } from '../services/pricing.js';
import { applyShipmentUpdate, bookShipment, cancelShipment, quoteForOrder, refreshTracking } from '../services/shippingService.js';
import { SHIPMENT_STATUSES } from '../shipping/status.js';
import { searchRegex, sendPdf } from './helpers.js';

const resolveShipTo = (customer, body) => {
  if (body.address_id) {
    const addr = (customer.addresses || []).find((a) => String(a._id) === String(body.address_id));
    if (!addr) throw new ApiError(404, 'Address not found');
    return addr;
  }
  return body.ship_to || null;
};

// =================== customer (app) ===================

const cartView = async (cart) => {
  if (!cart) return { items: [], store_id: null };
  const ids = cart.items.map((i) => i.product_id);
  const products = await CommerceProduct.find({ _id: { $in: ids } }).select('sku name slug price mrp images unit active gst_rate').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const avail = cart.store_id ? await availabilityMap(cart.store_id, ids) : new Map();
  return {
    ...cart,
    items: cart.items.map((i) => ({
      ...i,
      product: byId.get(String(i.product_id)) || null,
      available: cart.store_id ? avail.get(String(i.product_id)) || 0 : null,
    })),
  };
};

export const getCart = asyncHandler(async (req, res) =>
  ok(res, await cartView(await CommerceCart.findOne({ customer_id: req.commerce.customer._id }).lean())));

/// Replaces the cart: { store_id, items: [{ product_id, qty }] }.
export const updateCart = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const storeId = body.store_id ? (await getStoreOr404(body.store_id))._id : null;
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((i) => {
    const qty = Number(i?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw new ApiError(400, 'qty must be an integer 1-1000');
    return { product_id: assertObjectId(i.product_id, 'product_id'), qty };
  });
  const ids = [...new Set(items.map((i) => String(i.product_id)))];
  if (ids.length !== items.length) throw new ApiError(400, 'Duplicate products in cart');
  if (ids.length && (await CommerceProduct.countDocuments({ _id: { $in: ids }, active: true })) !== ids.length) {
    throw new ApiError(400, 'One or more products are unavailable');
  }
  const cart = await CommerceCart.findOneAndUpdate(
    { customer_id: req.commerce.customer._id },
    { $set: { store_id: storeId, items, item_count: items.length, last_activity_at: new Date(), abandoned_notified_at: null } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  return ok(res, await cartView(cart));
});

/// { store_id?, items? (defaults to cart), fulfilment, address_id | ship_to, payment_method: cash|online, notes }
export const checkout = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { customer } = req.commerce;
  const cart = await CommerceCart.findOne({ customer_id: customer._id }).lean();
  const fromCart = !Array.isArray(body.items);
  const items = fromCart ? cart?.items || [] : body.items;
  const storeId = body.store_id || cart?.store_id;
  if (!storeId) throw new ApiError(400, 'store_id is required');
  const paymentMethod = String(body.payment_method || 'cash');
  if (!['cash', 'online'].includes(paymentMethod)) throw new ApiError(400, 'payment_method must be cash or online');
  const fulfilment = body.fulfilment === 'pickup' ? 'pickup' : 'delivery';

  const store = await getStoreOr404(storeId);
  const order = await createOrder({
    store,
    customer,
    items,
    type: 'retail',
    channel: 'app',
    fulfilment,
    shipTo: fulfilment === 'delivery' ? resolveShipTo(customer, body) : null,
    paymentMethod,
    notes: body.notes,
    actor: actorOf(req),
  });

  let payment = null;
  if (paymentMethod === 'online') {
    try {
      payment = await createRazorpayOrder(order);
    } catch (error) {
      await transitionOrder(req, order._id, 'cancelled', { system: true, note: 'Payment could not be started' }).catch(() => {});
      throw error;
    }
  }
  if (fromCart && cart) {
    await CommerceCart.updateOne({ _id: cart._id }, { $set: { items: [], item_count: 0, last_activity_at: new Date() } });
  }
  return ok(res, { order, payment }, 201);
});

const myOrderOr404 = async (req) => {
  const order = await CommerceOrder.findOne({ _id: assertObjectId(req.params.id, 'order id'), customer_id: req.commerce.customer._id });
  if (!order) throw new ApiError(404, 'Order not found');
  return order;
};

export const payMyOrder = asyncHandler(async (req, res) => ok(res, await createRazorpayOrder(await myOrderOr404(req))));

export const verifyMyPayment = asyncHandler(async (req, res) => ok(res, await verifyRazorpayPayment(await myOrderOr404(req), req.body || {})));

export const myOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { customer_id: req.commerce.customer._id };
  if (req.query.status) filter.status = String(req.query.status);
  const [items, total] = await Promise.all([
    CommerceOrder.find(filter).select('-payment.entries -timeline.by').populate('store_id', 'code name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceOrder.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const myOrder = asyncHandler(async (req, res) => {
  const order = (await myOrderOr404(req)).toObject();
  order.shipment = order.shipment_id
    ? await CommerceShipment.findById(order.shipment_id).select('provider status awb courier_name tracking_url events').lean()
    : null;
  return ok(res, order);
});

export const cancelMyOrder = asyncHandler(async (req, res) => {
  const order = await myOrderOr404(req);
  if (order.status !== 'placed') throw new ApiError(409, 'Only orders that are not yet confirmed can be cancelled');
  const updated = await transitionOrder(req, order._id, 'cancelled', {
    system: true, note: 'Cancelled by customer', filter: { customer_id: order.customer_id, status: 'placed' },
  });
  return ok(res, updated);
});

/// Own orders only. Issued on first download once the order is paid or delivered.
export const myInvoicePdf = asyncHandler(async (req, res) => {
  const order = await myOrderOr404(req);
  let invoice = order.invoice_id ? await CommerceInvoice.findById(order.invoice_id).lean() : null;
  if (!invoice) {
    if (order.payment.status !== 'paid' && order.status !== 'delivered') throw new ApiError(404, 'Invoice is not issued yet');
    invoice = await issueInvoice(req, order);
  }
  return sendPdf(res, await renderInvoicePdf(invoice), `${invoice.number}.pdf`);
});

export const myProfile = asyncHandler(async (req, res) => ok(res, req.commerce.customer));

export const addMyAddress = asyncHandler(async (req, res) => {
  const a = req.body || {};
  const address = Object.fromEntries(['label', 'name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode', 'lat', 'lng']
    .filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
  const customer = await CommerceCustomer.findOneAndUpdate(
    { _id: req.commerce.customer._id, 'addresses.19': { $exists: false } },
    { $push: { addresses: address } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!customer) throw new ApiError(409, 'At most 20 addresses');
  return ok(res, customer.addresses, 201);
});

export const removeMyAddress = asyncHandler(async (req, res) => {
  const customer = await CommerceCustomer.findByIdAndUpdate(
    req.commerce.customer._id,
    { $pull: { addresses: { _id: assertObjectId(req.params.addressId, 'address id') } } },
    { returnDocument: 'after' },
  ).lean();
  return ok(res, customer.addresses);
});

// =================== staff / admin / franchise (store-scoped) ===================

const scopedOrder = async (req, id = req.params.id) => {
  const order = await CommerceOrder.findOne({ _id: assertObjectId(id, 'order id'), ...storeFilter(req) });
  if (!order) throw new ApiError(404, 'Order not found');
  return order;
};

export const listOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = storeFilter(req, req.query.store_id);
  for (const key of ['status', 'channel', 'type']) if (req.query[key]) filter[key] = String(req.query[key]);
  if (req.query.payment_status) filter['payment.status'] = String(req.query.payment_status);
  if (req.query.payment_method) filter['payment.method'] = String(req.query.payment_method);
  if (req.query.customer_id) filter.customer_id = assertObjectId(req.query.customer_id, 'customer_id');
  if (req.query.franchise_id && req.commerce.actor.type === 'admin') filter.franchise_id = assertObjectId(req.query.franchise_id, 'franchise_id');
  if (req.query.created_by) filter['created_by.id'] = String(req.query.created_by);
  if (req.query.from || req.query.to) {
    const { start, end } = parsePeriod(req.query);
    filter.createdAt = { $gte: start, $lt: end };
  }
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ number: rx }, { 'customer_snapshot.name': rx }, { 'customer_snapshot.phone': rx }, { 'customer_snapshot.business_name': rx }];
  }
  const [items, total] = await Promise.all([
    CommerceOrder.find(filter).select('-timeline -payment.entries').populate('store_id', 'code name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceOrder.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = (await scopedOrder(req)).toObject();
  const [shipments, invoice] = await Promise.all([
    CommerceShipment.find({ order_id: order._id }).sort({ createdAt: -1 }).lean(),
    order.invoice_id ? CommerceInvoice.findById(order.invoice_id).select('number issued_at').lean() : null,
  ]);
  return ok(res, { ...order, shipments, invoice });
});

/// Manual (WhatsApp / phone / POS / lead) order entry by staff or admin.
/// { store_id, customer_id, items:[{product_id, qty, unit_price?, discount?}], type, channel,
///   fulfilment, address_id | ship_to, payment_method, shipping, notes, due_date }
export const createManualOrder = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const storeId = assertStoreAccess(req, body.store_id);
  const store = await getStoreOr404(storeId);
  const customer = await CommerceCustomer.findOne({ _id: assertObjectId(body.customer_id, 'customer_id'), active: true }).lean();
  if (!customer) throw new ApiError(404, 'Customer not found');
  const channel = String(body.channel || 'phone');
  if (!ORDER_CHANNELS.includes(channel) || channel === 'app') throw new ApiError(400, `channel must be one of ${ORDER_CHANNELS.filter((c) => c !== 'app').join(', ')}`);
  const paymentMethod = String(body.payment_method || (customer.type === 'wholesale' ? 'credit' : 'cash'));
  if (!PAYMENT_METHODS.includes(paymentMethod) || paymentMethod === 'online') throw new ApiError(400, 'payment_method must be cash or credit for staff-entered orders');
  const fulfilment = body.fulfilment === 'delivery' ? 'delivery' : 'pickup';
  const type = body.type ? String(body.type) : customer.type;
  if (!['retail', 'wholesale'].includes(type)) throw new ApiError(400, 'type must be retail or wholesale');
  const dueDate = body.due_date ? new Date(body.due_date) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) throw new ApiError(400, 'Invalid due_date');

  const order = await createOrder({
    store,
    customer,
    items: body.items,
    type,
    channel,
    fulfilment,
    shipTo: fulfilment === 'delivery' ? resolveShipTo(customer, body) : null,
    paymentMethod,
    shipping: body.shipping,
    notes: body.notes,
    allowOverride: true,
    actor: actorOf(req),
    initialStatus: 'confirmed', // staff took the order themselves
    dueDate,
  });
  logActivity(req, 'order.create', { store_id: storeId, entity: 'order', entity_id: order._id, meta: { number: order.number, channel, total: order.totals.grand_total } });
  return ok(res, order, 201);
});

export const setOrderStatus = asyncHandler(async (req, res) => {
  const to = String(req.body?.status || '');
  if (!ORDER_STATUSES.includes(to)) throw new ApiError(400, `status must be one of ${ORDER_STATUSES.join(', ')}`);
  const order = await scopedOrder(req);
  if (to === 'cancelled' && order.shipment_id) {
    const shipment = await CommerceShipment.findOne({ _id: order.shipment_id, active: true }).lean();
    if (shipment) await cancelShipment(shipment);
  }
  const updated = await transitionOrder(req, order._id, to, { note: req.body?.note, filter: storeFilter(req) });
  logActivity(req, `order.${to}`, { store_id: order.store_id, entity: 'order', entity_id: order._id, meta: { number: order.number, from: order.status } });
  return ok(res, updated);
});

export const addPayment = asyncHandler(async (req, res) => {
  const order = await scopedOrder(req);
  const updated = await recordPayment(req, order._id, req.body || {}, storeFilter(req));
  logActivity(req, 'payment.record', { store_id: order.store_id, entity: 'order', entity_id: order._id, meta: { amount: Number(req.body?.amount), method: req.body?.method } });
  return ok(res, updated);
});

export const issueOrderInvoice = asyncHandler(async (req, res) => {
  const order = await scopedOrder(req);
  const invoice = await issueInvoice(req, order);
  logActivity(req, 'invoice.issue', { store_id: order.store_id, entity: 'invoice', entity_id: invoice._id, meta: { number: invoice.number } });
  return ok(res, invoice, 201);
});

export const listInvoices = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = storeFilter(req, req.query.store_id);
  if (req.query.customer_id) filter.customer_id = assertObjectId(req.query.customer_id, 'customer_id');
  if (req.query.type) filter.type = String(req.query.type);
  if (req.query.from || req.query.to) {
    const { start, end } = parsePeriod(req.query);
    filter.issued_at = { $gte: start, $lt: end };
  }
  if (req.query.search) filter.$or = [{ number: searchRegex(req.query.search) }, { order_number: searchRegex(req.query.search) }];
  const [items, total] = await Promise.all([
    CommerceInvoice.find(filter).select('number order_number store_id type issued_at buyer.name buyer.business_name totals.grand_total payment')
      .sort({ issued_at: -1 }).skip(skip).limit(limit).lean(),
    CommerceInvoice.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const invoicePdf = asyncHandler(async (req, res) => {
  const invoice = await CommerceInvoice.findOne({ _id: assertObjectId(req.params.id, 'invoice id'), ...storeFilter(req) }).lean();
  if (!invoice) throw new ApiError(404, 'Invoice not found');
  return sendPdf(res, await renderInvoicePdf(invoice), `${invoice.number}.pdf`);
});

// ---------- shipping ----------

export const shippingRates = asyncHandler(async (req, res) => {
  const order = await scopedOrder(req);
  if (order.fulfilment !== 'delivery' || !order.ship_to) throw new ApiError(409, 'Order is not for delivery');
  return ok(res, await quoteForOrder(order, { provider: req.body?.provider || req.query.provider, package: req.body?.package }));
});

/// { provider: local_porter|shiprocket|bigship, courier_id?, package? }
export const createShipment = asyncHandler(async (req, res) => {
  const order = await scopedOrder(req);
  const shipment = await bookShipment(req, order, req.body || {});
  logActivity(req, 'shipment.create', { store_id: order.store_id, entity: 'shipment', entity_id: shipment._id, meta: { provider: shipment.provider, awb: shipment.awb } });
  return ok(res, shipment, 201);
});

const scopedShipment = async (req) => {
  const shipment = await CommerceShipment.findOne({ _id: assertObjectId(req.params.id, 'shipment id'), ...storeFilter(req) }).lean();
  if (!shipment) throw new ApiError(404, 'Shipment not found');
  return shipment;
};

export const listShipments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = storeFilter(req, req.query.store_id);
  for (const key of ['provider', 'status']) if (req.query[key]) filter[key] = String(req.query[key]);
  if (req.query.awb) filter.awb = String(req.query.awb);
  const [items, total] = await Promise.all([
    CommerceShipment.find(filter).select('-events').populate('order_id', 'number status totals.grand_total').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CommerceShipment.countDocuments(filter),
  ]);
  return paged(res, { items, total, page, limit });
});

export const getShipment = asyncHandler(async (req, res) => ok(res, await scopedShipment(req)));

export const refreshShipment = asyncHandler(async (req, res) => ok(res, await refreshTracking(await scopedShipment(req))));

export const cancelShipmentCtl = asyncHandler(async (req, res) => {
  const shipment = await scopedShipment(req);
  const updated = await cancelShipment(shipment);
  logActivity(req, 'shipment.cancel', { store_id: shipment.store_id, entity: 'shipment', entity_id: shipment._id });
  return ok(res, updated);
});

/// Manual status for city (local_porter) deliveries until the platform hook drives them.
export const setLocalShipmentStatus = asyncHandler(async (req, res) => {
  const shipment = await scopedShipment(req);
  if (shipment.provider !== 'local_porter') throw new ApiError(409, 'Only city-delivery shipments are updated manually');
  const status = String(req.body?.status || '');
  if (!SHIPMENT_STATUSES.includes(status)) throw new ApiError(400, `status must be one of ${SHIPMENT_STATUSES.join(', ')}`);
  const updated = await applyShipmentUpdate(shipment, { status, raw_status: status.toUpperCase(), note: req.body?.note, location: req.body?.location });
  logActivity(req, 'shipment.status', { store_id: shipment.store_id, entity: 'shipment', entity_id: shipment._id, meta: { status } });
  return ok(res, updated);
});
