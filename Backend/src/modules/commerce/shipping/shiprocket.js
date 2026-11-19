import { ApiError } from '../../../utils/ApiError.js';
import { disabled, requestJson } from './http.js';
import { normalizeCourierStatus } from './status.js';

/// Shiprocket (pan-India couriers). Docs: https://apidocs.shiprocket.in
/// Env: SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD (an API user), optional SHIPROCKET_BASE_URL,
/// SHIPROCKET_PICKUP_LOCATION (default pickup nickname when a store has none).
const BASE = () => (process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external').replace(/\/$/, '');
const TOKEN_TTL_MS = 9 * 24 * 3600 * 1000; // tokens are valid for 10 days
let tokenCache = { token: null, expiresAt: 0, pending: null };

const isEnabled = () => Boolean(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
const assertEnabled = () => {
  if (!isEnabled()) throw disabled('Shiprocket', ['SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD']);
};

const login = async () => {
  if (tokenCache.token && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  if (!tokenCache.pending) {
    tokenCache.pending = requestJson('Shiprocket', `${BASE()}/auth/login`, {
      method: 'POST',
      body: { email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD },
    })
      .then((res) => {
        if (!res?.token) throw new ApiError(502, 'Shiprocket login returned no token');
        tokenCache = { token: res.token, expiresAt: Date.now() + TOKEN_TTL_MS, pending: null };
        return res.token;
      })
      .finally(() => {
        tokenCache.pending = null;
      });
  }
  return tokenCache.pending;
};

/// Authenticated call; re-logs in once if the cached token was revoked.
const api = async (path, options = {}, retried = false) => {
  assertEnabled();
  const token = await login();
  try {
    return await requestJson('Shiprocket', `${BASE()}${path}`, { ...options, headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    if (error.providerStatus === 401 && !retried) {
      tokenCache = { token: null, expiresAt: 0, pending: null };
      return api(path, options, true);
    }
    throw error;
  }
};

const splitName = (full = '') => {
  const parts = String(full || 'Customer').trim().split(/\s+/);
  return { first: parts[0] || 'Customer', last: parts.slice(1).join(' ') };
};
const digits10 = (phone = '') => String(phone).replace(/\D/g, '').slice(-10);
const pad = (n) => String(n).padStart(2, '0');
const srDate = (d = new Date()) => {
  const ist = new Date(new Date(d).getTime() + 330 * 60000);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
};

export const shiprocket = {
  name: 'shiprocket',
  isEnabled,

  /// shipment: { pickup: { pincode }, drop: { pincode }, package: { weight_kg }, cod_amount }
  async quoteRates(shipment) {
    const qs = new URLSearchParams({
      pickup_postcode: String(shipment.pickup?.pincode || ''),
      delivery_postcode: String(shipment.drop?.pincode || ''),
      weight: String(shipment.package?.weight_kg || 0.5),
      cod: shipment.cod_amount > 0 ? '1' : '0',
      ...(shipment.cod_amount > 0 ? { declared_value: String(shipment.cod_amount) } : {}),
    });
    const res = await api(`/courier/serviceability/?${qs}`);
    const list = res?.data?.available_courier_companies || [];
    return list.map((c) => ({
      provider: 'shiprocket',
      courier_id: String(c.courier_company_id),
      courier_name: c.courier_name,
      rate: Number(c.rate ?? c.freight_charge ?? 0),
      etd: c.etd || null,
      estimated_days: Number(c.estimated_delivery_days) || null,
      cod: c.cod === 1,
      recommended: String(c.courier_company_id) === String(res?.data?.recommended_courier_company_id),
    }));
  },

  /// Creates the Shiprocket order, then assigns an AWB (courier_id from quoteRates, or Shiprocket's pick).
  async createShipment(order, shipment) {
    const to = order.ship_to || {};
    const { first, last } = splitName(to.name || order.customer_snapshot?.name);
    const created = await api('/orders/create/adhoc', {
      method: 'POST',
      body: {
        order_id: order.number,
        order_date: srDate(order.createdAt),
        pickup_location: shipment.pickup?.shiprocket_pickup || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
        billing_customer_name: first,
        billing_last_name: last,
        billing_address: to.line1 || '',
        billing_address_2: to.line2 || '',
        billing_city: to.city || '',
        billing_pincode: to.pincode || '',
        billing_state: to.state || '',
        billing_country: to.country || 'India',
        billing_email: order.customer_snapshot?.email || '',
        billing_phone: digits10(to.phone || order.customer_snapshot?.phone),
        shipping_is_billing: true,
        order_items: order.items.map((i) => ({
          name: i.name,
          sku: i.sku,
          units: i.qty,
          selling_price: i.unit_price,
          discount: i.discount || 0,
          tax: i.gst_rate,
          hsn: i.hsn || '',
        })),
        payment_method: shipment.cod_amount > 0 ? 'COD' : 'Prepaid',
        sub_total: shipment.cod_amount > 0 ? shipment.cod_amount : order.totals.grand_total,
        length: shipment.package?.length_cm || 10,
        breadth: shipment.package?.breadth_cm || 10,
        height: shipment.package?.height_cm || 10,
        weight: shipment.package?.weight_kg || 0.5,
      },
    });
    if (!created?.shipment_id) throw new ApiError(502, `Shiprocket did not create the order: ${JSON.stringify(created).slice(0, 300)}`);

    const result = {
      status: 'created',
      raw_status: created.status || 'NEW',
      provider_order_id: String(created.order_id || ''),
      provider_shipment_id: String(created.shipment_id),
      awb: created.awb_code || null,
      courier_id: created.courier_company_id ? String(created.courier_company_id) : '',
      courier_name: created.courier_name || '',
    };
    if (!result.awb) {
      const assigned = await api('/courier/assign/awb', {
        method: 'POST',
        body: { shipment_id: created.shipment_id, ...(shipment.courier_id ? { courier_id: shipment.courier_id } : {}) },
      });
      const data = assigned?.response?.data || {};
      if (!data.awb_code) {
        // Order exists on Shiprocket but has no courier; staff can retry or assign in their panel.
        return { ...result, error: assigned?.message || 'AWB not assigned' };
      }
      result.awb = data.awb_code;
      result.courier_id = String(data.courier_company_id || result.courier_id);
      result.courier_name = data.courier_name || result.courier_name;
      result.charge = Number(data.freight_charges ?? data.applied_weight_amount ?? 0) || undefined;
    }
    result.status = 'booked';
    result.tracking_url = `https://shiprocket.co/tracking/${result.awb}`;
    return result;
  },

  async track(awb) {
    const res = await api(`/courier/track/awb/${encodeURIComponent(awb)}`);
    const data = res?.tracking_data || {};
    const current = data.shipment_track?.[0]?.current_status || '';
    const events = (data.shipment_track_activities || []).map((a) => ({
      raw_status: a['sr-status-label'] || a.activity || a.status,
      status: normalizeCourierStatus(a['sr-status-label'] || a.activity),
      location: a.location || '',
      at: a.date ? new Date(a.date) : new Date(),
    }));
    return { status: normalizeCourierStatus(current), raw_status: current, events, tracking_url: data.track_url || '' };
  },

  /// Shiprocket cancels by its order id, not by AWB.
  async cancel(shipmentOrAwb) {
    const providerOrderId = typeof shipmentOrAwb === 'object' ? shipmentOrAwb.provider_order_id : null;
    if (providerOrderId) return api('/orders/cancel', { method: 'POST', body: { ids: [Number(providerOrderId) || providerOrderId] } });
    const awb = typeof shipmentOrAwb === 'object' ? shipmentOrAwb.awb : shipmentOrAwb;
    return api('/orders/cancel/shipment/awbs', { method: 'POST', body: { awbs: [awb] } });
  },

  /// Shiprocket webhook body: { awb, current_status, shipment_status, current_timestamp, order_id, scans[] }.
  parseWebhook(req) {
    const b = req.body || {};
    const raw = b.current_status || b.shipment_status || '';
    return {
      awb: b.awb ? String(b.awb) : null,
      provider_order_id: b.sr_order_id ? String(b.sr_order_id) : null,
      order_number: b.order_id ? String(b.order_id) : null,
      raw_status: raw,
      status: normalizeCourierStatus(raw),
      location: b.scans?.[b.scans.length - 1]?.location || '',
      at: b.current_timestamp ? new Date(b.current_timestamp) : new Date(),
    };
  },
};
