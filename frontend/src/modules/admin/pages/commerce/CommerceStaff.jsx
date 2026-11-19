import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Power } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Pager, PageShell, Select, StatusBadge, Tabs, Toolbar,
  dateTime, timeAgo, useApi, useDebounced,
} from '../platform/kit';
import { createStaff, deactivateStaff, listActivity, listStaff, updateStaff } from '../../services/commerceApi';
import { MODULE, STAFF_ROLES, Toggle, label, periodParams, useStores, useToastAction } from './common';

const CommerceStaff = () => {
  const [tab, setTab] = useState('staff');
  const stores = useStores();
  return (
    <PageShell module={MODULE} page="Store staff" title="Store staff">
      <Tabs tabs={[{ value: 'staff', label: 'Staff' }, { value: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} />
      {tab === 'staff' ? <StaffList stores={stores} /> : <Activity stores={stores} />}
    </PageShell>
  );
};

const StaffList = ({ stores }) => {
  const [filters, setFilters] = useState({ search: '', role: '', store_id: '', active: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const search = useDebounced(filters.search);
  const { data, loading, error, reload } = useApi(
    () => listStaff({ search, role: filters.role, store_id: filters.store_id, active: filters.active, page, limit: 20 }),
    [search, filters.role, filters.store_id, filters.active, page],
  );
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const [deactivate] = useToastAction((s) => deactivateStaff(s._id), () => { toast.success('Staff deactivated'); reload(); });

  const columns = [
    { key: 'name', label: 'Name', render: (s) => (<div><p className="text-gray-900">{s.name}</p><p className="text-xs text-gray-400">{s.mobile}{s.email ? ` · ${s.email}` : ''}</p></div>) },
    { key: 'role', label: 'Role', render: (s) => <span className="capitalize">{label(s.role)}</span> },
    { key: 'stores', label: 'Stores', render: (s) => (s.store_ids || []).map((x) => x.code || x).join(', ') || '—' },
    { key: 'last_login_at', label: 'Last login', render: (s) => (s.last_login_at ? timeAgo(s.last_login_at) : 'Never') },
    { key: 'active', label: 'Status', render: (s) => <StatusBadge status={s.active ? 'active' : 'inactive'} /> },
    {
      key: 'actions', label: '', align: 'right', render: (s) => (s.active ? (
        <button
          type="button"
          title="Deactivate"
          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
          onClick={(e) => { e.stopPropagation(); if (window.confirm(`Deactivate ${s.name}? They will no longer be able to sign in.`)) deactivate(s); }}
        >
          <Power size={14} />
        </button>
      ) : null),
    },
  ];

  return (
    <Card bodyClassName="" title="Staff" right={<Button icon={Plus} onClick={() => setEditing({})}>New staff</Button>}>
      <Toolbar>
        <Field label="Search" className="w-full sm:w-56"><Input placeholder="Name, mobile, email" value={filters.search} onChange={set('search')} /></Field>
        <Field label="Role" className="w-full sm:w-44"><Select placeholder="All roles" options={STAFF_ROLES} value={filters.role} onChange={set('role')} /></Field>
        <Field label="Store" className="w-full sm:w-52"><Select placeholder="All stores" options={stores.options} value={filters.store_id} onChange={set('store_id')} /></Field>
        <Field label="Status" className="w-full sm:w-36">
          <Select placeholder="All" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} value={filters.active} onChange={set('active')} />
        </Field>
      </Toolbar>
      <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No staff yet" onRowClick={setEditing} />
      <Pager data={data} onPage={setPage} />
      {editing ? (
        <StaffModal key={editing._id || 'new'} staff={editing} stores={stores} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      ) : null}
    </Card>
  );
};

const StaffModal = ({ staff, stores, onClose, onSaved }) => {
  const isNew = !staff._id;
  const [form, setForm] = useState({
    name: staff.name || '',
    mobile: staff.mobile || '',
    email: staff.email || '',
    password: '',
    role: staff.role || 'sales_staff',
    store_ids: (staff.store_ids || []).map((s) => s._id || s),
    active: staff.active ?? true,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleStore = (id) => setForm((f) => ({ ...f, store_ids: f.store_ids.includes(id) ? f.store_ids.filter((x) => x !== id) : [...f.store_ids, id] }));

  const [save, busy] = useToastAction(() => {
    const { password, ...rest } = form;
    const body = password ? { ...rest, password } : rest;
    return isNew ? createStaff(body) : updateStaff(staff._id, body);
  }, () => { toast.success(isNew ? 'Staff created' : 'Staff updated'); onSaved(); });

  const pwOk = isNew ? form.password.length >= 8 : !form.password || form.password.length >= 8;
  const valid = form.name.trim() && form.mobile.trim() && form.store_ids.length && pwOk;

  return (
    <Modal
      open
      title={isNew ? 'New staff member' : `Edit ${staff.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!valid} onClick={() => save()}>{isNew ? 'Create' : 'Save'}</Button>
        </>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name *"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Mobile *" hint="Used to sign in"><Input value={form.mobile} onChange={set('mobile')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Role *"><Select options={STAFF_ROLES} value={form.role} onChange={set('role')} /></Field>
        <Field label={isNew ? 'Password *' : 'Reset password'} hint={isNew ? 'At least 8 characters' : 'Leave blank to keep the current one'} className="sm:col-span-2">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
      </div>
      {form.password && !pwOk ? <p className="text-xs text-red-600">Password must be at least 8 characters.</p> : null}
      <div>
        <span className="block text-xs font-semibold text-gray-500 mb-1.5">Stores * <span className="font-normal text-gray-400">(staff only see these stores)</span></span>
        <div className="rounded-lg border border-gray-200 max-h-48 overflow-y-auto divide-y divide-gray-100">
          {stores.loading ? <p className="px-3 py-2 text-xs text-gray-400">Loading stores…</p> : null}
          {!stores.loading && !stores.stores.length ? <p className="px-3 py-2 text-xs text-gray-400">Create a store first.</p> : null}
          {stores.stores.map((s) => (
            <label key={s._id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
              <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={form.store_ids.includes(s._id)} onChange={() => toggleStore(s._id)} />
              {s.name} <span className="text-xs text-gray-400">{s.code}{s.active ? '' : ' · inactive'}</span>
            </label>
          ))}
        </div>
      </div>
      <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))}>Active</Toggle>
    </Modal>
  );
};

/** Where an activity row's entity opens in the admin; others show the label only. */
const ENTITY_LINKS = {
  order: (id) => `/admin/commerce/orders/${id}`,
  product: (id) => `/admin/commerce/products/${id}`,
};

/** Entity type + its human label (stored on the row, or resolved by the API for old rows). */
const EntityCell = ({ a }) => {
  if (!a.entity) return '—';
  const text = a.label || a.meta?.number || (a.entity_id ? `…${String(a.entity_id).slice(-6)}` : '');
  const href = a.entity_id && ENTITY_LINKS[a.entity]?.(a.entity_id);
  return (
    <div className="min-w-0">
      {href ? (
        <Link to={href} className="text-indigo-600 hover:underline truncate block">{text}</Link>
      ) : (
        <p className="text-gray-900 truncate">{text || '—'}</p>
      )}
      <p className="text-xs text-gray-400 capitalize">{a.entity}</p>
    </div>
  );
};

const Activity = ({ stores }) => {
  const [filters, setFilters] = useState({ actor_id: '', store_id: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const action = useDebounced(filters.action);
  const staff = useApi(() => listStaff({ limit: 100 }), []);
  const params = { actor_id: filters.actor_id, store_id: filters.store_id, action, ...periodParams(filters.from, filters.to), page, limit: 30 };
  const { data, loading, error } = useApi(() => listActivity(params), [JSON.stringify(params)]);
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const storeById = new Map(stores.stores.map((s) => [s._id, s]));

  const columns = [
    { key: 'createdAt', label: 'When', render: (a) => <span className="whitespace-nowrap" title={dateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span> },
    { key: 'actor', label: 'Actor', render: (a) => (<div><p className="text-gray-900">{a.actor?.name || '—'}</p><p className="text-xs text-gray-400 capitalize">{label(a.actor?.role || a.actor?.type)}</p></div>) },
    { key: 'action', label: 'Action', render: (a) => <span className="font-mono text-xs">{a.action}</span> },
    { key: 'entity', label: 'Entity', render: (a) => <EntityCell a={a} /> },
    { key: 'store', label: 'Store', render: (a) => storeById.get(a.store_id)?.code || '—' },
    { key: 'ip', label: 'IP', render: (a) => <span className="text-xs text-gray-400">{a.ip || '—'}</span> },
  ];

  return (
    <Card bodyClassName="">
      <Toolbar>
        <Field label="Staff" className="w-full sm:w-52">
          <Select placeholder="Everyone" options={(staff.data?.items || []).map((s) => ({ value: s._id, label: s.name }))} value={filters.actor_id} onChange={set('actor_id')} />
        </Field>
        <Field label="Store" className="w-full sm:w-52"><Select placeholder="All stores" options={stores.options} value={filters.store_id} onChange={set('store_id')} /></Field>
        <Field label="Action" className="w-full sm:w-44"><Input placeholder="e.g. order., stock.adjust" value={filters.action} onChange={set('action')} /></Field>
        <Field label="From" className="w-full sm:w-40"><Input type="date" value={filters.from} onChange={set('from')} /></Field>
        <Field label="To" className="w-full sm:w-40"><Input type="date" value={filters.to} onChange={set('to')} /></Field>
      </Toolbar>
      <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No activity" />
      <Pager data={data} onPage={setPage} />
    </Card>
  );
};

export default CommerceStaff;
