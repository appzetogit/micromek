/* eslint-disable react-refresh/only-export-components */
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Search } from 'lucide-react';
import { Field, Input, errorMessage, inr, useAction, useApi, useDebounced } from '../platform/kit';
import { listProducts, listStores } from '../../services/commerceApi';

/** Enums mirrored from Backend/src/modules/commerce (models + services/pricing.js). */
export const MODULE = 'E-commerce';
export const ORDER_STATUSES = ['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];
export const ORDER_TRANSITIONS = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
export const ORDER_CHANNELS = ['app', 'whatsapp', 'phone', 'pos', 'lead'];
export const MANUAL_CHANNELS = ORDER_CHANNELS.filter((c) => c !== 'app');
export const PAYMENT_STATUSES = ['pending', 'partial', 'paid', 'refund_due', 'refunded'];
export const PAYMENT_METHODS = ['cash', 'online', 'credit'];
export const ORDER_TYPES = ['retail', 'wholesale'];
export const SHIPPING_PROVIDERS = [
  { value: 'local_porter', label: 'City delivery (local porter)' },
  { value: 'shiprocket', label: 'Shiprocket' },
  { value: 'bigship', label: 'BigShip' },
];
export const SHIPMENT_STATUSES = [
  'created', 'pending_assignment', 'booked', 'picked_up', 'in_transit', 'out_for_delivery',
  'delivered', 'rto', 'returned', 'cancelled', 'failed',
];
export const TERMINAL_SHIPMENT = ['delivered', 'returned', 'cancelled', 'failed'];
/** Statuses where the backend still allows a cancel. */
export const CANCELLABLE_SHIPMENT = ['created', 'pending_assignment', 'booked'];
export const STAFF_ROLES = ['store_manager', 'sales_staff', 'billing_staff'];
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
export const UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'box', 'pack', 'dozen', 'm'];
export const MOVEMENT_TYPES = ['adjust', 'transfer_out', 'transfer_in', 'sale', 'return'];

export const label = (s) => String(s || '').replace(/_/g, ' ');

/**
 * Query params for the backend's parsePeriod (from inclusive, to exclusive):
 * date inputs are whole days, so `to` moves to the next midnight.
 */
export const periodParams = (from, to) => {
  const out = {};
  if (from) out.from = new Date(`${from}T00:00:00`).toISOString();
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    out.to = end.toISOString();
  }
  return out;
};

/** useAction with toast errors instead of alert. */
export const useToastAction = (fn, onSuccess) =>
  useAction(fn, { onSuccess, onError: (err) => toast.error(errorMessage(err)) });

/** All stores (max 100) as select options plus the raw list. */
export const useStores = () => {
  const { data, loading } = useApi(() => listStores({ limit: 100 }), []);
  const stores = data?.items || [];
  return {
    stores,
    loading,
    options: stores.map((s) => ({ value: s._id, label: `${s.name} (${s.code})${s.active ? '' : ' · inactive'}` })),
  };
};

export const storeName = (s) => (s && typeof s === 'object' ? `${s.name} (${s.code})` : '—');

export const ADDRESS_FIELDS = ['label', 'name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode'];
export const emptyAddress = () => Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, '']));

export const formatAddress = (a) =>
  a ? [a.name, a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ') || '—' : '—';

/** Address inputs; `fields` limits which keys are shown. */
export const AddressFields = ({ value, onChange, fields = ADDRESS_FIELDS }) => {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const titles = { label: 'Label', name: 'Contact name', phone: 'Phone', line1: 'Address line 1', line2: 'Address line 2', city: 'City', state: 'State', pincode: 'Pincode' };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {fields.map((k) => (
        <Field key={k} label={titles[k]} className={k === 'line1' || k === 'line2' ? 'sm:col-span-2' : ''}>
          <Input value={value?.[k] || ''} onChange={set(k)} />
        </Field>
      ))}
    </div>
  );
};

export const Toggle = ({ checked, onChange, children }) => (
  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
    <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
    {children}
  </label>
);

/** Search-and-pick a product (name/SKU). `onPick(product)`; shows availability when storeId is set. */
export const ProductPicker = ({ storeId, onPick, placeholder = 'Search product by name or SKU' }) => {
  const [term, setTerm] = useState('');
  const q = useDebounced(term);
  const { data, loading } = useApi(
    () => (q ? listProducts({ search: q, store_id: storeId || undefined, limit: 8 }) : Promise.resolve({ data: { items: [] } })),
    [q, storeId],
  );
  const items = data?.items || [];
  return (
    <div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input className="pl-8" placeholder={placeholder} value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {q ? (
        <div className="mt-1 rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-48 overflow-y-auto">
          {loading ? <p className="px-3 py-2 text-xs text-gray-400">Searching…</p> : null}
          {!loading && !items.length ? <p className="px-3 py-2 text-xs text-gray-400">No products found</p> : null}
          {items.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => { onPick(p); setTerm(''); }}
              className="w-full flex justify-between gap-3 text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              <span className="truncate">{p.name} <span className="text-xs text-gray-400">{p.sku}{p.active ? '' : ' · inactive'}</span></span>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {inr(p.price)}{p.available !== undefined ? ` · ${p.available} avail.` : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
