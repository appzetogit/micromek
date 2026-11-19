import mongoose from 'mongoose';
import { CommerceActivityLog } from '../models/ActivityLog.js';
import { CommerceCategory } from '../models/Category.js';
import { CommerceCustomer } from '../models/Customer.js';
import { CommerceInvoice } from '../models/Invoice.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceProduct } from '../models/Product.js';
import { CommerceRefund } from '../models/Refund.js';
import { CommerceShipment } from '../models/Shipment.js';
import { CommerceStaff } from '../models/Staff.js';
import { CommerceStore } from '../models/Store.js';

/// How each entity type is named in the activity feed: model, fields to load, label builder.
const LABELERS = {
  order: { model: CommerceOrder, select: 'number', label: (d) => d.number },
  product: { model: CommerceProduct, select: 'sku name', label: (d) => [d.sku, d.name].filter(Boolean).join(' · ') },
  store: { model: CommerceStore, select: 'code name', label: (d) => d.code || d.name },
  staff: { model: CommerceStaff, select: 'name', label: (d) => d.name },
  customer: { model: CommerceCustomer, select: 'name business_name', label: (d) => d.business_name ? `${d.name} (${d.business_name})` : d.name },
  category: { model: CommerceCategory, select: 'name', label: (d) => d.name },
  invoice: { model: CommerceInvoice, select: 'number', label: (d) => d.number },
  shipment: { model: CommerceShipment, select: 'provider awb', label: (d) => [d.provider, d.awb].filter(Boolean).join(' ') },
  refund: { model: CommerceRefund, select: 'order_number amount', label: (d) => `${d.order_number} · ₹${d.amount}` },
};

/// Labels for many (entity, entity_id) pairs with one query per entity type.
/// Returns Map("entity:id" -> label).
export const resolveLabels = async (pairs) => {
  const byEntity = new Map();
  for (const { entity, entity_id: id } of pairs) {
    if (!LABELERS[entity] || !mongoose.isValidObjectId(id)) continue;
    if (!byEntity.has(entity)) byEntity.set(entity, new Set());
    byEntity.get(entity).add(String(id));
  }
  const out = new Map();
  await Promise.all([...byEntity].map(async ([entity, ids]) => {
    const { model, select, label } = LABELERS[entity];
    const docs = await model.find({ _id: { $in: [...ids] } }).select(select).lean();
    for (const d of docs) out.set(`${entity}:${d._id}`, String(label(d) || ''));
  }));
  return out;
};

/// Fills `label` on activity rows written before labels existed (or whose lookup failed).
export const withActivityLabels = async (items) => {
  const missing = items.filter((i) => !i.label && i.entity && i.entity_id);
  if (!missing.length) return items;
  const labels = await resolveLabels(missing);
  for (const i of missing) i.label = labels.get(`${i.entity}:${i.entity_id}`) || '';
  return items;
};

/// Records who did what. Never throws and never blocks the request. Pass `label` when the
/// caller already has the entity's name; otherwise it is looked up here, off the request path.
export const logActivity = (req, action, { store_id = null, entity = '', entity_id = '', label = '', meta = {} } = {}) => {
  const actor = req?.commerce?.actor || { type: 'system', id: '', name: 'system' };
  const id = String(entity_id || '');
  const write = async () => {
    let name = label;
    if (!name && entity && id) name = (await resolveLabels([{ entity, entity_id: id }])).get(`${entity}:${id}`) || '';
    await CommerceActivityLog.create({
      actor: { type: actor.type, id: String(actor.id || ''), name: actor.name || '', role: actor.role || '' },
      store_id: store_id || null,
      action,
      entity,
      entity_id: id,
      label: String(name || '').slice(0, 200),
      meta,
      ip: req?.ip || '',
    });
  };
  write().catch((error) => console.error('[commerce] activity log failed', error.message));
};
