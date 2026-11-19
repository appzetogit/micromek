import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Pager, PageShell, Select, StatusBadge, Textarea, Toolbar,
  inr, timeAgo, useApi, useDebounced,
} from '../platform/kit';
import { createCustomer, listCustomers, updateCustomer } from '../../services/commerceApi';
import { ADDRESS_FIELDS, AddressFields, MODULE, ORDER_TYPES, Toggle, emptyAddress, useStores, useToastAction } from './common';

const CommerceCustomers = () => {
  const stores = useStores();
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useApi(() => listCustomers({ type, search: q, page, limit: 20 }), [type, q, page]);
  const storeById = new Map(stores.stores.map((s) => [s._id, s]));

  const columns = [
    { key: 'name', label: 'Customer', render: (c) => (<div><p className="text-gray-900">{c.business_name || c.name}</p>{c.business_name ? <p className="text-xs text-gray-400">{c.name}</p> : null}</div>) },
    { key: 'phone', label: 'Phone', render: (c) => c.phone || '—' },
    { key: 'type', label: 'Type', render: (c) => <StatusBadge tone={c.type === 'wholesale' ? 'indigo' : 'gray'} label={c.type} /> },
    { key: 'gstin', label: 'GSTIN', render: (c) => c.gstin || '—' },
    { key: 'credit_limit', label: 'Credit limit', align: 'right', render: (c) => (c.credit_limit ? inr(c.credit_limit) : '—') },
    { key: 'home', label: 'Home store', render: (c) => (storeById.get(c.home_store_id)?.name || '—') },
    { key: 'source', label: 'Source', render: (c) => (c.user_id ? 'App' : 'Staff') },
    { key: 'active', label: 'Status', render: (c) => <StatusBadge status={c.active ? 'active' : 'inactive'} /> },
    { key: 'updatedAt', label: 'Updated', render: (c) => timeAgo(c.updatedAt) },
  ];

  return (
    <PageShell module={MODULE} page="Customers" title="Customers" right={<Button icon={Plus} onClick={() => setEditing({})}>New customer</Button>}>
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Search" className="w-full sm:w-64">
            <Input placeholder="Name, phone, business, GSTIN" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </Field>
          <Field label="Type" className="w-full sm:w-40">
            <Select placeholder="All" options={ORDER_TYPES} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} />
          </Field>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No customers found" onRowClick={setEditing} />
        <Pager data={data} onPage={setPage} />
      </Card>
      {editing ? (
        <CustomerModal key={editing._id || 'new'} customer={editing} storeOptions={stores.options} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      ) : null}
    </PageShell>
  );
};

const cleanAddress = (a) => Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, a[k] || '']));

const CustomerModal = ({ customer, storeOptions, onClose, onSaved }) => {
  const isNew = !customer._id;
  const [form, setForm] = useState({
    name: customer.name || '',
    phone: customer.phone || '',
    email: customer.email || '',
    type: customer.type || 'retail',
    business_name: customer.business_name || '',
    gstin: customer.gstin || '',
    credit_limit: String(customer.credit_limit ?? 0),
    home_store_id: customer.home_store_id || '',
    notes: customer.notes || '',
    active: customer.active ?? true,
  });
  // Existing address keys carry lat/lng the API may have stored; keep them on edit.
  const [addresses, setAddresses] = useState(() => (customer.addresses || []).map((a) => ({ ...cleanAddress(a), lat: a.lat, lng: a.lng })));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [save, busy] = useToastAction(() => {
    const body = {
      ...form,
      credit_limit: Number(form.credit_limit) || 0,
      home_store_id: form.home_store_id || null,
      addresses: addresses.map((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== null))),
    };
    return isNew ? createCustomer(body) : updateCustomer(customer._id, body);
  }, () => { toast.success(isNew ? 'Customer created' : 'Customer updated'); onSaved(); });

  return (
    <Modal
      open
      wide
      title={isNew ? 'New customer' : `Edit ${customer.business_name || customer.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!form.name.trim() || !form.phone.trim()} onClick={() => save()}>{isNew ? 'Create' : 'Save'}</Button>
        </>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name *"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone *"><Input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Type"><Select options={ORDER_TYPES} value={form.type} onChange={set('type')} /></Field>
        <Field label="Business name"><Input value={form.business_name} onChange={set('business_name')} /></Field>
        <Field label="GSTIN" hint="Sets place of supply for wholesale invoices"><Input value={form.gstin} onChange={set('gstin')} className="uppercase" /></Field>
        <Field label="Credit limit ₹"><Input type="number" min="0" step="0.01" value={form.credit_limit} onChange={set('credit_limit')} /></Field>
        <Field label="Home store"><Select placeholder="None (shared)" options={storeOptions} value={form.home_store_id} onChange={set('home_store_id')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes} onChange={set('notes')} /></Field>
      </div>
      <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))}>Active</Toggle>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500">Addresses ({addresses.length}/20)</span>
          {addresses.length < 20 ? <Button variant="secondary" icon={Plus} onClick={() => setAddresses((as) => [...as, emptyAddress()])}>Add address</Button> : null}
        </div>
        {!addresses.length ? <p className="text-sm text-gray-400">No saved addresses</p> : null}
        {addresses.map((a, i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-gray-500">Address {i + 1}</span>
              <button type="button" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" onClick={() => setAddresses((as) => as.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
            <AddressFields value={a} onChange={(v) => setAddresses((as) => as.map((x, j) => (j === i ? v : x)))} />
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default CommerceCustomers;
