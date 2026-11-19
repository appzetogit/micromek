import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Search, Trash2 } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Notice, Pager, PageShell, Select, StatusBadge, Textarea, Toolbar,
  dateTime, inr, useApi, useDebounced,
} from '../platform/kit';
import { createOrder, listCustomers, listOrders } from '../../services/commerceApi';
import {
  AddressFields, MANUAL_CHANNELS, MODULE, ORDER_CHANNELS, ORDER_STATUSES, ORDER_TYPES, PAYMENT_STATUSES, ProductPicker, Toggle,
  emptyAddress, formatAddress, label, periodParams, storeName, useStores, useToastAction,
} from './common';

const EMPTY_FILTERS = { store_id: '', status: '', type: '', channel: '', payment_status: '', from: '', to: '', search: '' };

const CommerceOrders = () => {
  const navigate = useNavigate();
  const { options: storeOptions } = useStores();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const search = useDebounced(filters.search);

  const { from, to, search: _s, ...rest } = filters;
  const params = { ...rest, ...periodParams(from, to), search, page, limit: 20 };
  const { data, loading, error, reload } = useApi(() => listOrders(params), [JSON.stringify(params)]);

  const setFilter = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };

  const columns = [
    { key: 'number', label: 'Order', render: (o) => <span className="font-medium text-gray-900 whitespace-nowrap">{o.number}</span> },
    { key: 'createdAt', label: 'Date', render: (o) => <span className="whitespace-nowrap">{dateTime(o.createdAt)}</span> },
    {
      key: 'customer', label: 'Customer', render: (o) => (
        <div className="min-w-0">
          <p className="text-gray-900 truncate">{o.customer_snapshot?.business_name || o.customer_snapshot?.name || '—'}</p>
          <p className="text-xs text-gray-400">{o.customer_snapshot?.phone}</p>
        </div>
      ),
    },
    { key: 'store', label: 'Store', render: (o) => storeName(o.store_id) },
    { key: 'channel', label: 'Channel', render: (o) => <span className="capitalize">{o.channel}</span> },
    { key: 'type', label: 'Type', render: (o) => <span className="capitalize">{o.type}</span> },
    { key: 'items', label: 'Items', align: 'right', render: (o) => o.items?.length ?? 0 },
    { key: 'total', label: 'Total', align: 'right', render: (o) => <span className="font-medium whitespace-nowrap">{inr(o.totals?.grand_total)}</span> },
    { key: 'payment', label: 'Payment', render: (o) => <StatusBadge status={o.payment?.status} /> },
    { key: 'status', label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
  ];

  return (
    <PageShell
      module={MODULE}
      page="Orders"
      title="Orders"
      right={<Button icon={Plus} onClick={() => setCreating(true)}>New manual order</Button>}
    >
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Search" className="w-full sm:w-56">
            <Input placeholder="Number, name, phone" value={filters.search} onChange={setFilter('search')} />
          </Field>
          <Field label="Store" className="w-full sm:w-48">
            <Select placeholder="All stores" options={storeOptions} value={filters.store_id} onChange={setFilter('store_id')} />
          </Field>
          <Field label="Status" className="w-full sm:w-36">
            <Select placeholder="Any" options={ORDER_STATUSES} value={filters.status} onChange={setFilter('status')} />
          </Field>
          <Field label="Type" className="w-full sm:w-32">
            <Select placeholder="Any" options={ORDER_TYPES} value={filters.type} onChange={setFilter('type')} />
          </Field>
          <Field label="Channel" className="w-full sm:w-32">
            <Select placeholder="Any" options={ORDER_CHANNELS} value={filters.channel} onChange={setFilter('channel')} />
          </Field>
          <Field label="Payment" className="w-full sm:w-36">
            <Select placeholder="Any" options={PAYMENT_STATUSES} value={filters.payment_status} onChange={setFilter('payment_status')} />
          </Field>
          <Field label="From" className="w-full sm:w-40">
            <Input type="date" value={filters.from} onChange={setFilter('from')} />
          </Field>
          <Field label="To" className="w-full sm:w-40">
            <Input type="date" value={filters.to} onChange={setFilter('to')} />
          </Field>
          <Button variant="secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Reset</Button>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          error={error}
          empty="No orders match these filters"
          onRowClick={(o) => navigate(`/admin/commerce/orders/${o._id}`)}
        />
        <Pager data={data} onPage={setPage} />
      </Card>

      {creating ? (
        <ManualOrderModal
          storeOptions={storeOptions}
          onClose={() => setCreating(false)}
          onCreated={(order) => {
            setCreating(false);
            reload();
            navigate(`/admin/commerce/orders/${order._id}`);
          }}
        />
      ) : null}
    </PageShell>
  );
};

// ---------- manual order ----------

const CustomerPicker = ({ value, onChange }) => {
  const [term, setTerm] = useState('');
  const q = useDebounced(term);
  const { data, loading } = useApi(() => (q ? listCustomers({ search: q, limit: 8 }) : Promise.resolve({ data: { items: [] } })), [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
        <div className="min-w-0 text-sm">
          <p className="text-gray-900 truncate">{value.business_name || value.name} <span className="text-xs text-gray-400 capitalize">· {value.type}</span></p>
          <p className="text-xs text-gray-400">{value.phone}{value.gstin ? ` · ${value.gstin}` : ''}</p>
        </div>
        <Button variant="secondary" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  const items = data?.items || [];
  return (
    <div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input className="pl-8" placeholder="Search by name, phone, business, GSTIN" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {q ? (
        <div className="mt-1 rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-48 overflow-y-auto">
          {loading ? <p className="px-3 py-2 text-xs text-gray-400">Searching…</p> : null}
          {!loading && !items.length ? <p className="px-3 py-2 text-xs text-gray-400">No customers found — add one under Customers.</p> : null}
          {items.map((c) => (
            <button key={c._id} type="button" onClick={() => onChange(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
              {c.business_name || c.name} <span className="text-xs text-gray-400">{c.phone} · {c.type}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const ManualOrderModal = ({ storeOptions, onClose, onCreated }) => {
  const [form, setForm] = useState({
    store_id: '', channel: 'whatsapp', type: '', fulfilment: 'pickup', payment_method: 'cash',
    shipping: '', due_date: '', notes: '', address_id: '', new_address: false,
  });
  const [customer, setCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [shipTo, setShipTo] = useState(emptyAddress());
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickCustomer = (c) => {
    setCustomer(c);
    setForm((f) => ({
      ...f,
      type: c?.type || '',
      payment_method: c?.type === 'wholesale' ? 'credit' : 'cash',
      address_id: c?.addresses?.[0]?._id || '',
      new_address: !c?.addresses?.length,
    }));
  };

  const addLine = (p) => setLines((ls) => (ls.some((l) => l.product._id === p._id)
    ? ls.map((l) => (l.product._id === p._id ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l))
    : [...ls, { product: p, qty: '1', unit_price: '', discount: '' }]));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const [submit, busy] = useToastAction(() => {
    const body = {
      store_id: form.store_id,
      customer_id: customer?._id,
      type: form.type || undefined,
      channel: form.channel,
      fulfilment: form.fulfilment,
      payment_method: form.payment_method,
      notes: form.notes || undefined,
      shipping: form.shipping === '' ? undefined : Number(form.shipping),
      due_date: form.payment_method === 'credit' && form.due_date ? form.due_date : undefined,
      items: lines.map((l) => ({
        product_id: l.product._id,
        qty: Number(l.qty),
        unit_price: l.unit_price === '' ? undefined : Number(l.unit_price),
        discount: l.discount === '' ? undefined : Number(l.discount),
      })),
    };
    if (form.fulfilment === 'delivery') {
      if (form.new_address) body.ship_to = shipTo;
      else body.address_id = form.address_id;
    }
    return createOrder(body);
  }, (res) => {
    toast.success(`Order ${res?.data?.number || ''} created`);
    onCreated(res.data);
  });

  const canSubmit = form.store_id && customer && lines.length && lines.every((l) => Number(l.qty) >= 1);

  return (
    <Modal
      open
      wide
      title="New manual order"
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!canSubmit} onClick={() => submit()}>Create order</Button>
        </>
      )}
    >
      <Notice tone="blue">Staff-entered orders start as <b>confirmed</b> and reserve stock at the chosen store. Prices follow the product (wholesale tiers apply for wholesale); override per line if needed.</Notice>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Store *">
          <Select placeholder="Select store" options={storeOptions} value={form.store_id} onChange={set('store_id')} />
        </Field>
        <Field label="Channel">
          <Select options={MANUAL_CHANNELS} value={form.channel} onChange={set('channel')} />
        </Field>
        <Field label="Type" hint="Defaults to the customer's type">
          <Select placeholder="Customer's type" options={ORDER_TYPES} value={form.type} onChange={set('type')} />
        </Field>
      </div>

      <Field label="Customer *">
        <CustomerPicker value={customer} onChange={pickCustomer} />
      </Field>

      <div>
        <span className="block text-xs font-semibold text-gray-500 mb-1.5">Items *</span>
        {form.store_id ? <ProductPicker storeId={form.store_id} onPick={addLine} placeholder="Add product: search name or SKU" /> : <p className="text-xs text-gray-400">Pick a store first.</p>}
        {lines.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-2">Product</th>
                  <th className="py-2 px-2 w-20">Qty</th>
                  <th className="py-2 px-2 w-28">Unit price</th>
                  <th className="py-2 px-2 w-28">Discount ₹</th>
                  <th className="py-2 pl-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.product._id} className="border-b border-gray-50">
                    <td className="py-2 pr-2">
                      <p className="text-gray-900">{l.product.name}</p>
                      <p className="text-xs text-gray-400">{l.product.sku} · list {inr(l.product.price)}{l.product.available !== undefined ? ` · ${l.product.available} avail.` : ''}</p>
                    </td>
                    <td className="py-2 px-2"><Input type="number" min="1" step="1" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></td>
                    <td className="py-2 px-2"><Input type="number" min="0" step="0.01" placeholder="auto" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} /></td>
                    <td className="py-2 px-2"><Input type="number" min="0" step="0.01" placeholder="0" value={l.discount} onChange={(e) => setLine(i, 'discount', e.target.value)} /></td>
                    <td className="py-2 pl-2">
                      <button type="button" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Fulfilment">
          <Select options={['pickup', 'delivery']} value={form.fulfilment} onChange={set('fulfilment')} />
        </Field>
        <Field label="Payment method">
          <Select options={['cash', 'credit']} value={form.payment_method} onChange={set('payment_method')} />
        </Field>
        <Field label="Shipping charge ₹">
          <Input type="number" min="0" step="0.01" placeholder="0" value={form.shipping} onChange={set('shipping')} />
        </Field>
        {form.payment_method === 'credit' ? (
          <Field label="Credit due date">
            <Input type="date" value={form.due_date} onChange={set('due_date')} />
          </Field>
        ) : null}
      </div>

      {form.fulfilment === 'delivery' ? (
        <div className="space-y-3">
          <span className="block text-xs font-semibold text-gray-500">Ship to</span>
          {customer?.addresses?.length ? (
            <Toggle checked={form.new_address} onChange={(v) => setForm((f) => ({ ...f, new_address: v }))}>Enter a different address</Toggle>
          ) : null}
          {!form.new_address && customer?.addresses?.length ? (
            <Select
              options={customer.addresses.map((a) => ({ value: a._id, label: `${a.label ? `${label(a.label)}: ` : ''}${formatAddress(a)}` }))}
              value={form.address_id}
              onChange={set('address_id')}
            />
          ) : (
            <AddressFields value={shipTo} onChange={setShipTo} />
          )}
        </div>
      ) : null}

      <Field label="Notes">
        <Textarea value={form.notes} onChange={set('notes')} />
      </Field>
    </Modal>
  );
};

export default CommerceOrders;
