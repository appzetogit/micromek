import { ApiError } from '../../../utils/ApiError.js';
import { disabled, requestJson } from './http.js';
import { normalizeCourierStatus } from './status.js';

/// BigShip (pan-India aggregator) - SKELETON.
///
/// BigShip's API reference is shared with merchants on onboarding rather than
/// published, so every path and field below marked TODO(bigship) is a best guess
/// and MUST be confirmed against the docs before enabling in production. The
/// contract (quoteRates / createShipment / track / cancel / parseWebhook) matches
/// the other adapters, so only this file changes once confirmed.
///
/// Env: BIGSHIP_BASE_URL, BIGSHIP_USERNAME, BIGSHIP_PASSWORD, BIGSHIP_ACCESS_KEY,
/// optional BIGSHIP_WAREHOUSE_ID (pickup warehouse registered with BigShip).
const BASE = () => String(process.env.BIGSHIP_BASE_URL || '').replace(/\/$/, '');
const REQUIRED = ['BIGSHIP_BASE_URL', 'BIGSHIP_USERNAME', 'BIGSHIP_PASSWORD', 'BIGSHIP_ACCESS_KEY'];
const TOKEN_TTL_MS = 11 * 3600 * 1000; // TODO(bigship): confirm token lifetime
let tokenCache = { token: null, expiresAt: 0 };

const isEnabled = () => REQUIRED.every((k) => process.env[k]);
const assertEnabled = () => {
  if (!isEnabled()) throw disabled('BigShip', REQUIRED);
};

const login = async () => {
  if (tokenCache.token && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  // TODO(bigship): confirm login path and field names.
  const res = await requestJson('BigShip', `${BASE()}/login/user`, {
    method: 'POST',
    body: {
      user_name: process.env.BIGSHIP_USERNAME,
      password: process.env.BIGSHIP_PASSWORD,
      access_key: process.env.BIGSHIP_ACCESS_KEY,
    },
  });
  const token = res?.data?.token || res?.token; // TODO(bigship)
  if (!token) throw new ApiError(502, 'BigShip login returned no token');
  tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
};

const api = async (path, options = {}) => {
  assertEnabled();
  const token = await login();
  return requestJson('BigShip', `${BASE()}${path}`, { ...options, headers: { Authorization: `Bearer ${token}` } });
};

export const bigship = {
  name: 'bigship',
  isEnabled,

  async quoteRates(shipment) {
    // TODO(bigship): confirm rate-calculator endpoint and payload.
    const res = await api('/calculator', {
      method: 'POST',
      body: {
        shipment_category: 'b2c',
        payment_type: shipment.cod_amount > 0 ? 'COD' : 'Prepaid',
        pickup_pincode: shipment.pickup?.pincode,
        destination_pincode: shipment.drop?.pincode,
        shipment_invoice_amount: shipment.invoice_value || shipment.cod_amount || 0,
        box_details: [{
          each_box_dead_weight: shipment.package?.weight_kg || 0.5,
          each_box_length: shipment.package?.length_cm || 10,
          each_box_width: shipment.package?.breadth_cm || 10,
          each_box_height: shipment.package?.height_cm || 10,
          box_count: 1,
        }],
      },
    });
    const list = res?.data || [];
    return (Array.isArray(list) ? list : []).map((c) => ({
      provider: 'bigship',
      courier_id: String(c.courier_id ?? c.id ?? ''), // TODO(bigship)
      courier_name: c.courier_name || c.name || '', // TODO(bigship)
      rate: Number(c.total_shipping_charges ?? c.rate ?? 0), // TODO(bigship)
      estimated_days: Number(c.tat) || null, // TODO(bigship)
    }));
  },

  async createShipment(order, shipment) {
    const to = order.ship_to || {};
    // TODO(bigship): confirm order-create endpoint + field names; then manifest/AWB call.
    const created = await api('/order/add/single', {
      method: 'POST',
      body: {
        shipment_category: 'b2c',
        warehouse_detail: { pickup_location_id: shipment.pickup?.bigship_warehouse_id || process.env.BIGSHIP_WAREHOUSE_ID },
        consignee_detail: {
          first_name: to.name || order.customer_snapshot?.name,
          contact_number_primary: String(to.phone || order.customer_snapshot?.phone || '').replace(/\D/g, '').slice(-10),
          email_id: order.customer_snapshot?.email || '',
          consignee_address: { address_line1: to.line1, address_line2: to.line2, pincode: to.pincode },
        },
        order_detail: {
          invoice_id: order.number,
          payment_type: shipment.cod_amount > 0 ? 'COD' : 'Prepaid',
          collectable_amount: shipment.cod_amount || 0,
          shipment_invoice_amount: order.totals.grand_total,
          box_details: [{
            each_box_dead_weight: shipment.package?.weight_kg || 0.5,
            each_box_length: shipment.package?.length_cm || 10,
            each_box_width: shipment.package?.breadth_cm || 10,
            each_box_height: shipment.package?.height_cm || 10,
            box_count: 1,
            product_details: order.items.map((i) => ({ product_name: i.name, product_quantity: i.qty, each_product_invoice_amount: i.unit_price })),
          }],
        },
      },
    });
    const providerOrderId = String(created?.data?.system_order_id || created?.data || ''); // TODO(bigship)
    if (!providerOrderId) throw new ApiError(502, 'BigShip did not return an order id');

    // TODO(bigship): confirm manifest endpoint; it should return the AWB for the chosen courier.
    const manifest = await api('/order/manifest/single', {
      method: 'POST',
      body: { system_order_id: providerOrderId, courier_id: shipment.courier_id || undefined },
    });
    const awb = manifest?.data?.master_awb || manifest?.data?.awb || null; // TODO(bigship)
    return {
      status: awb ? 'booked' : 'created',
      raw_status: awb ? 'MANIFESTED' : 'CREATED',
      provider_order_id: providerOrderId,
      awb,
      courier_id: shipment.courier_id || '',
      courier_name: manifest?.data?.courier_name || '', // TODO(bigship)
      ...(awb ? {} : { error: manifest?.message || 'AWB not generated' }),
    };
  },

  async track(awb) {
    // TODO(bigship): confirm tracking endpoint and response shape.
    const res = await api(`/tracking?tracking_type=awb&tracking_id=${encodeURIComponent(awb)}`);
    const data = res?.data || {};
    const raw = data.order_detail?.current_tracking_status || data.current_status || '';
    const events = (data.scan_histories || []).map((s) => ({
      raw_status: s.scan_status || s.status,
      status: normalizeCourierStatus(s.scan_status || s.status),
      location: s.scan_location || '',
      at: s.scan_datetime ? new Date(s.scan_datetime) : new Date(),
    }));
    return { status: normalizeCourierStatus(raw), raw_status: raw, events };
  },

  async cancel(shipmentOrAwb) {
    const awb = typeof shipmentOrAwb === 'object' ? shipmentOrAwb.awb : shipmentOrAwb;
    // TODO(bigship): confirm cancel endpoint/body.
    return api('/order/cancel', { method: 'PUT', body: [awb] });
  },

  parseWebhook(req) {
    const b = req.body || {};
    // TODO(bigship): confirm webhook payload field names.
    const raw = b.current_status || b.status || b.tracking_status || '';
    return {
      awb: String(b.awb || b.awb_number || b.master_awb || '') || null,
      order_number: b.invoice_id ? String(b.invoice_id) : null,
      raw_status: raw,
      status: normalizeCourierStatus(raw),
      location: b.location || '',
      at: b.timestamp ? new Date(b.timestamp) : new Date(),
    };
  },
};
