import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ImageOff, Pencil, Plus, Power } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Pager, PageShell, Select, StatusBadge, Tabs, Toolbar,
  inr, useApi, useDebounced,
} from '../platform/kit';
import { createCategory, deactivateCategory, listCategories, listProducts, updateCategory } from '../../services/commerceApi';
import { MODULE, Toggle, useToastAction } from './common';

const CommerceCatalog = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState('products');
  const categories = useApi(() => listCategories(), []);
  return (
    <PageShell
      module={MODULE}
      page="Catalog"
      title="Catalog"
      right={tab === 'products' ? <Button icon={Plus} onClick={() => navigate('/admin/commerce/products/new')}>New product</Button> : null}
    >
      <Tabs tabs={[{ value: 'products', label: 'Products' }, { value: 'categories', label: 'Categories' }]} value={tab} onChange={setTab} />
      {tab === 'products' ? <Products categories={categories.data || []} /> : <Categories {...categories} />}
    </PageShell>
  );
};

const Thumb = ({ src }) => (
  <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center text-gray-300 shrink-0">
    {src ? <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" /> : <ImageOff size={16} />}
  </div>
);

const Products = ({ categories }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, loading, error } = useApi(
    () => listProducts({ search: q, category_id: categoryId, active, page, limit: 20 }),
    [q, categoryId, active, page],
  );
  const columns = [
    { key: 'img', label: '', render: (p) => <Thumb src={p.images?.[0]} /> },
    { key: 'sku', label: 'SKU', render: (p) => <span className="font-mono text-xs text-gray-700">{p.sku}</span> },
    { key: 'name', label: 'Name', render: (p) => (<div><p className="text-gray-900">{p.name}{p.variant_label ? ` (${p.variant_label})` : ''}</p><p className="text-xs text-gray-400">{p.brand}</p></div>) },
    { key: 'category', label: 'Category', render: (p) => p.category_id?.name || '—' },
    { key: 'price', label: 'Price', align: 'right', render: (p) => <span className="font-medium">{inr(p.price)}</span> },
    { key: 'mrp', label: 'MRP', align: 'right', render: (p) => (p.mrp ? inr(p.mrp) : '—') },
    { key: 'gst', label: 'GST', align: 'right', render: (p) => `${p.gst_rate}%` },
    { key: 'active', label: 'Status', render: (p) => <StatusBadge status={p.active ? 'active' : 'inactive'} /> },
  ];
  return (
    <Card bodyClassName="">
      <Toolbar>
        <Field label="Search" className="w-full sm:w-64">
          <Input placeholder="Name, SKU, brand" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </Field>
        <Field label="Category" className="w-full sm:w-48">
          <Select placeholder="All categories" options={categories.map((c) => ({ value: c._id, label: c.name }))} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} />
        </Field>
        <Field label="Status" className="w-full sm:w-36">
          <Select placeholder="All" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }} />
        </Field>
      </Toolbar>
      <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No products found" onRowClick={(p) => navigate(`/admin/commerce/products/${p._id}`)} />
      <Pager data={data} onPage={setPage} />
    </Card>
  );
};

const Categories = ({ data, loading, error, reload }) => {
  const [editing, setEditing] = useState(null);
  const rows = data || [];
  const byId = new Map(rows.map((c) => [c._id, c]));
  const [deactivate] = useToastAction((c) => deactivateCategory(c._id), () => { toast.success('Category deactivated'); reload(); });
  const columns = [
    { key: 'name', label: 'Name', render: (c) => <span className="text-gray-900">{c.name}</span> },
    { key: 'slug', label: 'Slug', render: (c) => <span className="font-mono text-xs">{c.slug}</span> },
    { key: 'parent', label: 'Parent', render: (c) => byId.get(c.parent_id)?.name || '—' },
    { key: 'sort', label: 'Sort', align: 'right' },
    { key: 'active', label: 'Status', render: (c) => <StatusBadge status={c.active ? 'active' : 'inactive'} /> },
    {
      key: 'actions', label: '', align: 'right', render: (c) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" title="Edit" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" onClick={() => setEditing(c)}><Pencil size={14} /></button>
          {c.active ? (
            <button
              type="button"
              title="Deactivate"
              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
              onClick={() => window.confirm(`Deactivate category "${c.name}"? Not allowed while it has active products.`) && deactivate(c)}
            >
              <Power size={14} />
            </button>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <Card title="Categories" right={<Button icon={Plus} onClick={() => setEditing({})}>New category</Button>} bodyClassName="">
      <DataTable columns={columns} rows={rows} loading={loading} error={error} empty="No categories yet" onRowClick={setEditing} />
      {editing ? (
        <CategoryModal key={editing._id || 'new'} category={editing} categories={rows} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      ) : null}
    </Card>
  );
};

const CategoryModal = ({ category, categories, onClose, onSaved }) => {
  const isNew = !category._id;
  const [form, setForm] = useState({
    name: category.name || '',
    parent_id: category.parent_id || '',
    image: category.image || '',
    sort: String(category.sort ?? 0),
    active: category.active ?? true,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [save, busy] = useToastAction(() => {
    const body = { ...form, parent_id: form.parent_id || null, sort: Number(form.sort) || 0 };
    return isNew ? createCategory(body) : updateCategory(category._id, body);
  }, () => { toast.success(isNew ? 'Category created' : 'Category updated'); onSaved(); });
  return (
    <Modal
      open
      title={isNew ? 'New category' : `Edit ${category.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!form.name.trim()} onClick={() => save()}>{isNew ? 'Create' : 'Save'}</Button>
        </>
      )}
    >
      <Field label="Name *"><Input value={form.name} onChange={set('name')} /></Field>
      <Field label="Parent">
        <Select placeholder="None (top level)" options={categories.filter((c) => c._id !== category._id).map((c) => ({ value: c._id, label: c.name }))} value={form.parent_id} onChange={set('parent_id')} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Image URL" className="sm:col-span-2"><Input value={form.image} onChange={set('image')} /></Field>
        <Field label="Sort"><Input type="number" value={form.sort} onChange={set('sort')} /></Field>
      </div>
      <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))}>Active</Toggle>
    </Modal>
  );
};

export default CommerceCatalog;
