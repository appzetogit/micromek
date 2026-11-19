import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeftRight, Plus, SlidersHorizontal, Target } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Pager, PageShell, Select, StatusBadge, Tabs, Toolbar,
  dateTime, num, useApi, useDebounced,
} from '../platform/kit';
import { adjustStock, listInventory, listMovements, setReorderLevel, transferStock } from '../../services/commerceApi';
import { MODULE, MOVEMENT_TYPES, ProductPicker, Toggle, label, storeName, useStores, useToastAction } from './common';

const CommerceInventory = () => {
  const [tab, setTab] = useState('stock');
  const stores = useStores();
  return (
    <PageShell module={MODULE} page="Inventory" title="Inventory">
      <Tabs tabs={[{ value: 'stock', label: 'Stock' }, { value: 'movements', label: 'Movements' }]} value={tab} onChange={setTab} />
      {tab === 'stock' ? <Stock stores={stores} /> : <Movements stores={stores} />}
    </PageShell>
  );
};

const Stock = ({ stores }) => {
  const [storeId, setStoreId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // { kind: adjust|transfer|reorder, row? }
  const q = useDebounced(search);
  const { data, loading, error, reload } = useApi(
    () => listInventory({ store_id: storeId, low_only: lowOnly ? 1 : undefined, search: q, page, limit: 20 }),
    [storeId, lowOnly, q, page],
  );
  const done = (msg) => { toast.success(msg); setModal(null); reload(); };

  const columns = [
    { key: 'product', label: 'Product', render: (r) => (<div><p className="text-gray-900">{r.product_id?.name || '—'}</p><p className="text-xs text-gray-400 font-mono">{r.product_id?.sku}</p></div>) },
    { key: 'store', label: 'Store', render: (r) => storeName(r.store_id) },
    { key: 'qty_on_hand', label: 'On hand', align: 'right', render: (r) => num(r.qty_on_hand) },
    { key: 'reserved', label: 'Reserved', align: 'right', render: (r) => num(r.reserved) },
    {
      key: 'available', label: 'Available', align: 'right', render: (r) => (
        <span className="inline-flex items-center gap-2 font-medium">
          {num(r.available)}
          {r.available <= r.reorder_level ? <StatusBadge tone="red" label="low" /> : null}
        </span>
      ),
    },
    { key: 'reorder_level', label: 'Reorder at', align: 'right', render: (r) => num(r.reorder_level) },
    {
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="flex justify-end gap-1">
          <IconBtn title="Adjust" onClick={() => setModal({ kind: 'adjust', row: r })}><SlidersHorizontal size={14} /></IconBtn>
          <IconBtn title="Transfer" onClick={() => setModal({ kind: 'transfer', row: r })}><ArrowLeftRight size={14} /></IconBtn>
          <IconBtn title="Reorder level" onClick={() => setModal({ kind: 'reorder', row: r })}><Target size={14} /></IconBtn>
        </div>
      ),
    },
  ];

  return (
    <Card bodyClassName="">
      <Toolbar>
        <Field label="Store" className="w-full sm:w-56">
          <Select placeholder="All stores" options={stores.options} value={storeId} onChange={(e) => { setStoreId(e.target.value); setPage(1); }} />
        </Field>
        <Field label="Search" className="w-full sm:w-56">
          <Input placeholder="Product name or SKU" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </Field>
        <div className="pb-2"><Toggle checked={lowOnly} onChange={(v) => { setLowOnly(v); setPage(1); }}>Low stock only</Toggle></div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" icon={ArrowLeftRight} onClick={() => setModal({ kind: 'transfer' })}>Transfer</Button>
          <Button icon={Plus} onClick={() => setModal({ kind: 'adjust' })}>Adjust stock</Button>
        </div>
      </Toolbar>
      <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty={lowOnly ? 'Nothing at or below its reorder level' : 'No stock rows'} />
      <Pager data={data} onPage={setPage} />
      {modal ? (
        <StockModal
          key={`${modal.kind}-${modal.row?._id || 'new'}`}
          kind={modal.kind}
          row={modal.row}
          storeOptions={stores.options}
          onClose={() => setModal(null)}
          onDone={done}
        />
      ) : null}
    </Card>
  );
};

const IconBtn = ({ children, ...props }) => (
  <button type="button" {...props} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">{children}</button>
);

const TITLES = { adjust: 'Adjust stock', transfer: 'Transfer between stores', reorder: 'Set reorder level' };

const StockModal = ({ kind, row, storeOptions, onClose, onDone }) => {
  const [product, setProduct] = useState(row?.product_id || null);
  const [form, setForm] = useState({
    store_id: row?.store_id?._id || '',
    to_store_id: '',
    delta: '',
    qty: '',
    reason: '',
    reorder_level: row ? String(row.reorder_level) : '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [submit, busy] = useToastAction(() => {
    const base = { product_id: product._id };
    if (kind === 'adjust') return adjustStock({ ...base, store_id: form.store_id, delta: Number(form.delta), reason: form.reason });
    if (kind === 'transfer') return transferStock({ ...base, from_store_id: form.store_id, to_store_id: form.to_store_id, qty: Number(form.qty), reason: form.reason });
    return setReorderLevel({ ...base, store_id: form.store_id, reorder_level: Number(form.reorder_level) });
  }, () => onDone(kind === 'adjust' ? 'Stock adjusted' : kind === 'transfer' ? 'Stock transferred' : 'Reorder level saved'));

  const int = (v) => v !== '' && Number.isInteger(Number(v));
  const valid = product && form.store_id && (
    kind === 'adjust' ? int(form.delta) && Number(form.delta) !== 0 && form.reason.trim()
      : kind === 'transfer' ? form.to_store_id && form.to_store_id !== form.store_id && int(form.qty) && Number(form.qty) >= 1
        : int(form.reorder_level) && Number(form.reorder_level) >= 0);

  return (
    <Modal
      open
      title={TITLES[kind]}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!valid} onClick={() => submit()}>Save</Button>
        </>
      )}
    >
      <Field label="Product *">
        {product ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <span className="truncate">{product.name} <span className="text-xs text-gray-400 font-mono">{product.sku}</span></span>
            {!row ? <Button variant="secondary" onClick={() => setProduct(null)}>Change</Button> : null}
          </div>
        ) : <ProductPicker onPick={setProduct} />}
      </Field>
      <Field label={kind === 'transfer' ? 'From store *' : 'Store *'}>
        <Select placeholder="Select store" options={storeOptions} value={form.store_id} onChange={set('store_id')} disabled={Boolean(row)} />
      </Field>
      {row ? (
        <p className="text-xs text-gray-500">On hand {num(row.qty_on_hand)} · reserved {num(row.reserved)} · available {num(row.available)}</p>
      ) : null}
      {kind === 'adjust' ? (
        <>
          <Field label="Change (±) *" hint="Positive adds stock, negative removes it (cannot go below reserved)">
            <Input type="number" step="1" value={form.delta} onChange={set('delta')} />
          </Field>
          <Field label="Reason *"><Input placeholder="e.g. Purchase receipt, damage, stock count" value={form.reason} onChange={set('reason')} maxLength={200} /></Field>
        </>
      ) : null}
      {kind === 'transfer' ? (
        <>
          <Field label="To store *">
            <Select placeholder="Select store" options={storeOptions.filter((o) => o.value !== form.store_id)} value={form.to_store_id} onChange={set('to_store_id')} />
          </Field>
          <Field label="Quantity *"><Input type="number" min="1" step="1" value={form.qty} onChange={set('qty')} /></Field>
          <Field label="Reason"><Input value={form.reason} onChange={set('reason')} maxLength={200} /></Field>
        </>
      ) : null}
      {kind === 'reorder' ? (
        <Field label="Reorder level *" hint="Flagged as low stock when available ≤ this">
          <Input type="number" min="0" step="1" value={form.reorder_level} onChange={set('reorder_level')} />
        </Field>
      ) : null}
    </Modal>
  );
};

const Movements = ({ stores }) => {
  const [storeId, setStoreId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi(() => listMovements({ store_id: storeId, type, page, limit: 30 }), [storeId, type, page]);
  const byId = new Map(stores.stores.map((s) => [s._id, s]));
  const columns = [
    { key: 'createdAt', label: 'When', render: (m) => <span className="whitespace-nowrap">{dateTime(m.createdAt)}</span> },
    { key: 'product', label: 'Product', render: (m) => (<div><p className="text-gray-900">{m.product_id?.name || '—'}</p><p className="text-xs text-gray-400 font-mono">{m.product_id?.sku}</p></div>) },
    { key: 'store', label: 'Store', render: (m) => storeName(m.store_id) },
    { key: 'type', label: 'Type', render: (m) => <span className="capitalize">{label(m.type)}</span> },
    { key: 'qty', label: 'Qty', align: 'right', render: (m) => <span className={`font-medium ${m.qty < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{m.qty > 0 ? '+' : ''}{num(m.qty)}</span> },
    { key: 'ref', label: 'Other store', render: (m) => (m.ref_store_id ? storeName(byId.get(m.ref_store_id)) : '—') },
    { key: 'reason', label: 'Reason', render: (m) => m.reason || '—' },
    { key: 'actor', label: 'By', render: (m) => m.actor?.name || m.actor?.type || '—' },
  ];
  return (
    <Card bodyClassName="">
      <Toolbar>
        <Field label="Store" className="w-full sm:w-56">
          <Select placeholder="All stores" options={stores.options} value={storeId} onChange={(e) => { setStoreId(e.target.value); setPage(1); }} />
        </Field>
        <Field label="Type" className="w-full sm:w-44">
          <Select placeholder="All types" options={MOVEMENT_TYPES} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} />
        </Field>
      </Toolbar>
      <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No stock movements" />
      <Pager data={data} onPage={setPage} />
    </Card>
  );
};

export default CommerceInventory;
