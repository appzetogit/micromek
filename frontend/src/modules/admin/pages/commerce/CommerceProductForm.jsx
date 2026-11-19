import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Boxes, IndianRupee, Layers, Loader2, Package, Plus, Power, Save, Trash2 } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Notice, PageShell, Select, StatusBadge, Textarea, num, useApi,
} from '../platform/kit';
import { createProduct, deactivateProduct, getProduct, listCategories, updateProduct } from '../../services/commerceApi';
import { GST_RATES, MODULE, Toggle, UNITS, storeName, useToastAction } from './common';

const BACK = '/admin/commerce/catalog';

const CommerceProductForm = () => {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const { data, loading, error } = useApi(() => (isNew ? Promise.resolve({ data: null }) : getProduct(id)), [id, isNew]);
  const title = isNew ? 'New product' : data?.name || 'Product';

  return (
    <PageShell module={MODULE} page={title} title={title} backTo={BACK}>
      {!isNew && loading && !data ? (
        <div className="py-20 text-center text-gray-400"><Loader2 className="inline animate-spin mr-2" size={16} />Loading product…</div>
      ) : !isNew && error ? (
        <Notice tone="red">{error}</Notice>
      ) : (
        <ProductEditor key={data?._id || 'new'} product={data} />
      )}
    </PageShell>
  );
};

const toForm = (p) => ({
  sku: p?.sku || '',
  name: p?.name || '',
  slug: p?.slug || '',
  category_id: p?.category_id?._id || p?.category_id || '',
  brand: p?.brand || '',
  description: p?.description || '',
  images: p?.images?.length ? [...p.images] : [''],
  hsn: p?.hsn || '',
  gst_rate: String(p?.gst_rate ?? 18),
  unit: p?.unit || 'pcs',
  price: p?.price !== undefined ? String(p.price) : '',
  mrp: p?.mrp ? String(p.mrp) : '',
  tax_inclusive: p?.tax_inclusive ?? true,
  weight_kg: String(p?.weight_kg ?? 0.5),
  variant_group: p?.variant_group || '',
  variant_label: p?.variant_label || '',
  wholesale_tiers: (p?.wholesale_tiers || []).map((t) => ({ min_qty: String(t.min_qty), price: String(t.price) })),
  active: p?.active ?? true,
});

const ProductEditor = ({ product }) => {
  const navigate = useNavigate();
  const isNew = !product;
  const [form, setForm] = useState(() => toForm(product));
  const { data: categories } = useApi(() => listCategories(), []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setImage = (i, v) => setForm((f) => ({ ...f, images: f.images.map((x, j) => (j === i ? v : x)) }));
  const setTier = (i, k, v) => setForm((f) => ({ ...f, wholesale_tiers: f.wholesale_tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) }));

  const [save, saving] = useToastAction(() => {
    const body = {
      ...form,
      category_id: form.category_id || null,
      images: form.images.map((s) => s.trim()).filter(Boolean),
      gst_rate: Number(form.gst_rate),
      price: Number(form.price),
      mrp: form.mrp === '' ? 0 : Number(form.mrp),
      weight_kg: form.weight_kg === '' ? 0 : Number(form.weight_kg),
      wholesale_tiers: form.wholesale_tiers.filter((t) => t.min_qty !== '' && t.price !== '').map((t) => ({ min_qty: Number(t.min_qty), price: Number(t.price) })),
    };
    if (!body.slug.trim()) delete body.slug;
    return isNew ? createProduct(body) : updateProduct(product._id, body);
  }, (res) => {
    toast.success(isNew ? 'Product created' : 'Product saved');
    if (isNew) navigate(`/admin/commerce/products/${res.data._id}`, { replace: true });
  });

  const [deactivate, deactivating] = useToastAction(() => deactivateProduct(product._id), () => {
    toast.success('Product deactivated');
    navigate(BACK);
  });

  const priceOverMrp = form.mrp !== '' && Number(form.mrp) > 0 && Number(form.price) > Number(form.mrp);
  const canSave = form.sku.trim() && form.name.trim() && form.price !== '' && !priceOverMrp;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <Card title="Basics" icon={Package}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="SKU *"><Input value={form.sku} onChange={set('sku')} className="uppercase" /></Field>
            <Field label="Name *"><Input value={form.name} onChange={set('name')} /></Field>
            <Field label="Slug" hint={isNew ? 'Leave blank to generate from name + SKU' : 'URL key in the app'}><Input value={form.slug} onChange={set('slug')} /></Field>
            <Field label="Category">
              <Select placeholder="Uncategorised" options={(categories || []).map((c) => ({ value: c._id, label: `${c.name}${c.active ? '' : ' (inactive)'}` }))} value={form.category_id} onChange={set('category_id')} />
            </Field>
            <Field label="Brand"><Input value={form.brand} onChange={set('brand')} /></Field>
            <Field label="Unit"><Select options={UNITS} value={form.unit} onChange={set('unit')} /></Field>
            <Field label="Variant group" hint="Products sharing a group are shown as variants"><Input value={form.variant_group} onChange={set('variant_group')} /></Field>
            <Field label="Variant label" hint="e.g. 500 ml, Red"><Input value={form.variant_label} onChange={set('variant_label')} /></Field>
            <Field label="Description" className="md:col-span-2"><Textarea rows={4} value={form.description} onChange={set('description')} /></Field>
          </div>
        </Card>

        <Card title="Images" subtitle="Image URLs, first is the thumbnail (max 12)" icon={Layers}>
          <div className="space-y-2">
            {form.images.map((src, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden shrink-0">{src ? <img src={src} alt="" className="w-full h-full object-cover" /> : null}</div>
                <Input placeholder="https://…" value={src} onChange={(e) => setImage(i, e.target.value)} />
                <button type="button" className="p-2 rounded-lg text-red-500 hover:bg-red-50" onClick={() => setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
              </div>
            ))}
            {form.images.length < 12 ? <Button variant="secondary" icon={Plus} onClick={() => setForm((f) => ({ ...f, images: [...f.images, ''] }))}>Add image</Button> : null}
          </div>
        </Card>

        <Card title="Wholesale tiers" subtitle="For wholesale orders: the highest min qty ≤ line qty wins; otherwise the retail price" icon={Boxes}>
          <div className="space-y-2">
            {form.wholesale_tiers.length ? (
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-semibold text-gray-500"><span>Min qty</span><span>Unit price ₹</span><span className="w-8" /></div>
            ) : <p className="text-sm text-gray-400">No tiers — wholesale uses the retail price.</p>}
            {form.wholesale_tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <Input type="number" min="1" step="1" value={t.min_qty} onChange={(e) => setTier(i, 'min_qty', e.target.value)} />
                <Input type="number" min="0" step="0.01" value={t.price} onChange={(e) => setTier(i, 'price', e.target.value)} />
                <button type="button" className="p-2 rounded-lg text-red-500 hover:bg-red-50" onClick={() => setForm((f) => ({ ...f, wholesale_tiers: f.wholesale_tiers.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
              </div>
            ))}
            <Button variant="secondary" icon={Plus} onClick={() => setForm((f) => ({ ...f, wholesale_tiers: [...f.wholesale_tiers, { min_qty: '', price: '' }] }))}>Add tier</Button>
          </div>
        </Card>

        {!isNew ? <StockCard stock={product.stock || []} unit={product.unit} /> : null}
      </div>

      <div className="space-y-6">
        <Card title="Pricing & tax" icon={IndianRupee}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price ₹ *"><Input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} /></Field>
              <Field label="MRP ₹"><Input type="number" min="0" step="0.01" value={form.mrp} onChange={set('mrp')} /></Field>
            </div>
            {priceOverMrp ? <p className="text-xs text-red-600">Price cannot exceed MRP.</p> : null}
            <Toggle checked={form.tax_inclusive} onChange={(v) => setForm((f) => ({ ...f, tax_inclusive: v }))}>Price includes GST</Toggle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GST rate"><Select options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} value={form.gst_rate} onChange={set('gst_rate')} /></Field>
              <Field label="HSN code"><Input value={form.hsn} onChange={set('hsn')} /></Field>
            </div>
            <Field label="Weight per unit (kg)" hint="Used for shipping quotes"><Input type="number" min="0" step="0.01" value={form.weight_kg} onChange={set('weight_kg')} /></Field>
            <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))}>Active (visible in catalogue)</Toggle>
          </div>
        </Card>
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <Button className="w-full" icon={Save} busy={saving} disabled={!canSave} onClick={() => save()}>{isNew ? 'Create product' : 'Save changes'}</Button>
          {!isNew && product.active ? (
            <Button
              className="w-full"
              variant="danger"
              icon={Power}
              busy={deactivating}
              onClick={() => window.confirm(`Deactivate ${product.name}? It disappears from the catalogue; stock and past orders are kept.`) && deactivate()}
            >
              Deactivate product
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const StockCard = ({ stock, unit }) => (
  <Card title="Stock by store" subtitle="Read-only; adjust under Inventory" icon={Boxes} bodyClassName="">
    <DataTable
      columns={[
        { key: 'store', label: 'Store', render: (r) => storeName(r.store_id) },
        { key: 'qty_on_hand', label: 'On hand', align: 'right', render: (r) => `${num(r.qty_on_hand)} ${unit}` },
        { key: 'reserved', label: 'Reserved', align: 'right', render: (r) => num(r.reserved) },
        { key: 'available', label: 'Available', align: 'right', render: (r) => <span className="font-medium">{num(Math.max(0, r.qty_on_hand - r.reserved))}</span> },
        { key: 'reorder_level', label: 'Reorder at', align: 'right', render: (r) => num(r.reorder_level) },
        { key: 'state', label: '', render: (r) => (r.qty_on_hand - r.reserved <= r.reorder_level ? <StatusBadge tone="red" label="low" /> : null) },
      ]}
      rows={stock}
      empty="No stock at any store yet"
    />
  </Card>
);

export default CommerceProductForm;
