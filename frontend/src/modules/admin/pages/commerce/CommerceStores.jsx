import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, Pencil, Plus, Power, Unlink } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Notice, Pager, PageShell, Select, StatusBadge, Toolbar,
  useApi, useDebounced,
} from '../platform/kit';
import { allocateStore, createStore, deactivateStore, listFranchises, listStores, updateStore } from '../../services/commerceApi';
import { AddressFields, MODULE, Toggle, useToastAction } from './common';

const CommerceStores = () => {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // {} = new
  const [allocating, setAllocating] = useState(null);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useApi(() => listStores({ search: q, active, page, limit: 20 }), [q, active, page]);

  const [unallocate] = useToastAction((s) => allocateStore(s._id, null), () => { toast.success('Store taken back from franchise'); reload(); });
  const [deactivate] = useToastAction((s) => deactivateStore(s._id), () => { toast.success('Store deactivated'); reload(); });

  const columns = [
    { key: 'code', label: 'Code', render: (s) => <span className="font-medium text-gray-900">{s.code}</span> },
    { key: 'name', label: 'Name', render: (s) => (<div><p className="text-gray-900">{s.name}</p><p className="text-xs text-gray-400">{s.phone}</p></div>) },
    { key: 'city', label: 'Location', render: (s) => [s.address?.city, s.address?.state, s.address?.pincode].filter(Boolean).join(', ') || '—' },
    { key: 'gstin', label: 'GSTIN', render: (s) => s.gstin || '—' },
    { key: 'franchise', label: 'Franchise', render: (s) => (s.franchise_id ? `${s.franchise_id.name} (${s.franchise_id.code})` : <span className="text-gray-400">Company-owned</span>) },
    { key: 'active', label: 'Status', render: (s) => <StatusBadge status={s.active ? 'active' : 'inactive'} /> },
    {
      key: 'actions', label: '', align: 'right', render: (s) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Edit" onClick={() => setEditing(s)}><Pencil size={14} /></IconBtn>
          {s.franchise_id ? (
            <IconBtn title="Unallocate franchise" onClick={() => window.confirm(`Take ${s.name} back from ${s.franchise_id.name}? Only future orders are affected.`) && unallocate(s)}><Unlink size={14} /></IconBtn>
          ) : (
            <IconBtn title="Allocate to franchise" onClick={() => setAllocating(s)}><Building2 size={14} /></IconBtn>
          )}
          {s.active ? (
            <IconBtn danger title="Deactivate" onClick={() => window.confirm(`Deactivate store ${s.name}? It will stop taking orders.`) && deactivate(s)}><Power size={14} /></IconBtn>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <PageShell module={MODULE} page="Stores" title="Stores" right={<Button icon={Plus} onClick={() => setEditing({})}>New store</Button>}>
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Search" className="w-full sm:w-64">
            <Input placeholder="Name, code, city" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </Field>
          <Field label="Status" className="w-full sm:w-40">
            <Select
              placeholder="All"
              options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
              value={active}
              onChange={(e) => { setActive(e.target.value); setPage(1); }}
            />
          </Field>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No stores yet" onRowClick={setEditing} />
        <Pager data={data} onPage={setPage} />
      </Card>
      {editing ? <StoreModal key={editing._id || 'new'} store={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
      {allocating ? <AllocateModal store={allocating} onClose={() => setAllocating(null)} onSaved={() => { setAllocating(null); reload(); }} /> : null}
    </PageShell>
  );
};

const IconBtn = ({ danger, children, ...props }) => (
  <button type="button" {...props} className={`p-1.5 rounded-lg ${danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-500 hover:bg-gray-100'}`}>{children}</button>
);

const toForm = (s) => {
  const [lng, lat] = s.location?.coordinates || [0, 0];
  const hasPoint = lat !== 0 || lng !== 0;
  return {
    code: s.code || '',
    name: s.name || '',
    phone: s.phone || '',
    email: s.email || '',
    gstin: s.gstin || '',
    shiprocket_pickup: s.shiprocket_pickup || '',
    active: s.active ?? true,
    address: { line1: '', line2: '', city: '', state: '', pincode: '', ...(s.address || {}) },
    lat: hasPoint ? String(lat) : '',
    lng: hasPoint ? String(lng) : '',
  };
};

const StoreModal = ({ store, onClose, onSaved }) => {
  const isNew = !store._id;
  const [form, setForm] = useState(() => toForm(store));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [save, busy] = useToastAction(() => {
    const { lat, lng, address, ...rest } = form;
    const body = {
      ...rest,
      address: { line1: address.line1, line2: address.line2, city: address.city, state: address.state, pincode: address.pincode },
    };
    if (lat !== '' && lng !== '') { body.lat = Number(lat); body.lng = Number(lng); }
    return isNew ? createStore(body) : updateStore(store._id, body);
  }, () => { toast.success(isNew ? 'Store created' : 'Store updated'); onSaved(); });
  const partialGeo = (form.lat === '') !== (form.lng === '');

  return (
    <Modal
      open
      wide
      title={isNew ? 'New store' : `Edit ${store.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!form.code || !form.name || partialGeo} onClick={() => save()}>{isNew ? 'Create' : 'Save'}</Button>
        </>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Code *" hint="Short unique code, used in order numbers"><Input value={form.code} onChange={set('code')} className="uppercase" /></Field>
        <Field label="Name *"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="GSTIN" hint="State code drives CGST/SGST vs IGST"><Input value={form.gstin} onChange={set('gstin')} className="uppercase" /></Field>
        <Field label="Shiprocket pickup nickname"><Input value={form.shiprocket_pickup} onChange={set('shiprocket_pickup')} /></Field>
      </div>
      <div>
        <span className="block text-xs font-semibold text-gray-500 mb-1.5">Address</span>
        <AddressFields value={form.address} onChange={(address) => setForm((f) => ({ ...f, address }))} fields={['line1', 'line2', 'city', 'state', 'pincode']} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude" hint="Optional, for city delivery"><Input type="number" step="any" value={form.lat} onChange={set('lat')} /></Field>
        <Field label="Longitude"><Input type="number" step="any" value={form.lng} onChange={set('lng')} /></Field>
      </div>
      {partialGeo ? <p className="text-xs text-red-600">Enter both latitude and longitude, or neither.</p> : null}
      <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))}>Active</Toggle>
    </Modal>
  );
};

const AllocateModal = ({ store, onClose, onSaved }) => {
  const [franchiseId, setFranchiseId] = useState('');
  const { data, loading, error } = useApi(() => listFranchises({ limit: 100, status: 'approved' }), []);
  const options = (data?.items || [])
    .filter((f) => f.business_type !== 'mobility')
    .map((f) => ({ value: f._id, label: `${f.name} (${f.code})` }));
  const [save, busy] = useToastAction(() => allocateStore(store._id, franchiseId), () => { toast.success('Store allocated'); onSaved(); });
  return (
    <Modal
      open
      title={`Allocate ${store.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!franchiseId} onClick={() => save()}>Allocate</Button>
        </>
      )}
    >
      <p className="text-sm text-gray-500">Orders placed from now on roll up to the franchise. Only approved franchises with business type commerce or both are listed.</p>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <Field label="Franchise">
        <Select placeholder={loading ? 'Loading…' : options.length ? 'Select franchise' : 'No eligible franchises'} options={options} value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)} />
      </Field>
    </Modal>
  );
};

export default CommerceStores;
