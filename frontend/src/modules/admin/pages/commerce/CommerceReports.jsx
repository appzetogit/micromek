import React, { useState } from 'react';
import { BarChart3, IndianRupee, Receipt, ShoppingBag } from 'lucide-react';
import {
  BarList, Card, DataTable, Field, Input, Notice, PageShell, Select, StatCard, StatGrid, StatusBadge, Tabs, Toolbar,
  inr, isoDay, num, useApi,
} from '../platform/kit';
import { listFranchises, reportLowStock, reportSales, reportStaff, reportTopProducts } from '../../services/commerceApi';
import { MODULE, label, periodParams, useStores } from './common';

const GROUPS = ['day', 'store', 'franchise', 'channel', 'type'];

const CommerceReports = () => {
  const stores = useStores();
  const franchises = useApi(() => listFranchises({ limit: 100 }), []);
  const [tab, setTab] = useState('sales');
  const [filters, setFilters] = useState({ from: isoDay(29), to: isoDay(0), store_id: '', franchise_id: '' });
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const franchiseOptions = (franchises.data?.items || [])
    .filter((f) => f.business_type !== 'mobility')
    .map((f) => ({ value: f._id, label: `${f.name} (${f.code})` }));
  const badRange = filters.from && filters.to && filters.from > filters.to;
  const scope = { ...periodParams(filters.from, filters.to), store_id: filters.store_id, franchise_id: filters.franchise_id };

  return (
    <PageShell module={MODULE} page="Reports" title="Reports">
      <Card className="mb-6" bodyClassName="">
        <Toolbar>
          <Field label="From" className="w-full sm:w-40"><Input type="date" value={filters.from} onChange={set('from')} /></Field>
          <Field label="To" className="w-full sm:w-40"><Input type="date" value={filters.to} onChange={set('to')} /></Field>
          <Field label="Store" className="w-full sm:w-52"><Select placeholder="All stores" options={stores.options} value={filters.store_id} onChange={set('store_id')} /></Field>
          <Field label="Franchise" className="w-full sm:w-52"><Select placeholder="All franchises" options={franchiseOptions} value={filters.franchise_id} onChange={set('franchise_id')} /></Field>
        </Toolbar>
      </Card>
      {badRange ? <Notice tone="red">"From" must be on or before "To".</Notice> : null}
      <Tabs
        tabs={[
          { value: 'sales', label: 'Sales' },
          { value: 'top', label: 'Top products' },
          { value: 'low', label: 'Low stock' },
          { value: 'staff', label: 'Staff performance' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {badRange ? null : (
        <>
          {tab === 'sales' ? <Sales scope={scope} /> : null}
          {tab === 'top' ? <TopProducts scope={scope} /> : null}
          {tab === 'low' ? <LowStock storeId={filters.store_id} /> : null}
          {tab === 'staff' ? <StaffPerformance scope={scope} /> : null}
        </>
      )}
    </PageShell>
  );
};

const Sales = ({ scope }) => {
  const [group, setGroup] = useState('day');
  const params = { ...scope, group };
  const { data, loading, error } = useApi(() => reportSales(params), [JSON.stringify(params)]);
  const items = (data?.items || []).map((r) => ({ ...r, name: r.label || (r.key === null ? '—' : String(r.key)) }));
  const t = data?.totals;
  return (
    <>
      <StatGrid>
        <StatCard label="Revenue" value={inr(t?.revenue)} icon={IndianRupee} tone="green" hint="Excludes cancelled & returned" />
        <StatCard label="Orders" value={num(t?.orders)} icon={ShoppingBag} />
        <StatCard label="GST" value={inr(t?.tax)} icon={Receipt} tone="amber" />
        <StatCard label="Avg order value" value={t?.orders ? inr(t.revenue / t.orders) : '—'} icon={BarChart3} tone="blue" />
      </StatGrid>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card
          className="xl:col-span-2"
          title="Sales breakdown"
          bodyClassName=""
          right={<div className="w-40"><Select options={GROUPS.map((g) => ({ value: g, label: `By ${g}` }))} value={group} onChange={(e) => setGroup(e.target.value)} /></div>}
        >
          <DataTable
            columns={[
              { key: 'name', label: label(group), render: (r) => <span className="capitalize">{label(r.name)}</span> },
              { key: 'orders', label: 'Orders', align: 'right', render: (r) => num(r.orders) },
              { key: 'taxable', label: 'Taxable', align: 'right', render: (r) => inr(r.taxable) },
              { key: 'tax', label: 'GST', align: 'right', render: (r) => inr(r.tax) },
              { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="font-medium">{inr(r.revenue)}</span> },
              { key: 'collected', label: 'Collected', align: 'right', render: (r) => inr(r.collected) },
              { key: 'aov', label: 'AOV', align: 'right', render: (r) => inr(r.avg_order_value) },
            ]}
            rows={items}
            rowKey={(r) => r.name}
            loading={loading}
            error={error}
            empty="No sales in this period"
          />
        </Card>
        <Card title="Revenue" subtitle={`by ${group}`}>
          {loading && !data ? <p className="text-sm text-gray-400">Loading…</p> : <BarList items={items.map((r) => ({ label: r.name, value: r.revenue }))} format={inr} />}
        </Card>
      </div>
    </>
  );
};

const TopProducts = ({ scope }) => {
  const params = { ...scope, limit: 50 };
  const { data, loading, error } = useApi(() => reportTopProducts(params), [JSON.stringify(params)]);
  const rows = data || [];
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Card className="xl:col-span-2" title="Top products by revenue" bodyClassName="">
        <DataTable
          columns={[
            { key: 'name', label: 'Product', render: (r) => (<div><p className="text-gray-900">{r.name}</p><p className="text-xs text-gray-400 font-mono">{r.sku}</p></div>) },
            { key: 'qty', label: 'Units', align: 'right', render: (r) => num(r.qty) },
            { key: 'orders', label: 'Orders', align: 'right', render: (r) => num(r.orders) },
            { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="font-medium">{inr(r.revenue)}</span> },
          ]}
          rows={rows}
          rowKey={(r) => r.product_id}
          loading={loading}
          error={error}
          empty="No sales in this period"
        />
      </Card>
      <Card title="Top 10">
        <BarList items={rows.slice(0, 10).map((r) => ({ label: r.name, value: r.revenue }))} format={inr} />
      </Card>
    </div>
  );
};

const LowStock = ({ storeId }) => {
  const { data, loading, error } = useApi(() => reportLowStock({ store_id: storeId }), [storeId]);
  return (
    <Card title="At or below reorder level" subtitle="Current stock; the date range does not apply" bodyClassName="">
      <DataTable
        columns={[
          { key: 'product', label: 'Product', render: (r) => (<div><p className="text-gray-900">{r.product?.name || '—'}</p><p className="text-xs text-gray-400 font-mono">{r.product?.sku}</p></div>) },
          { key: 'store', label: 'Store', render: (r) => (r.store ? `${r.store.name} (${r.store.code})` : '—') },
          { key: 'qty_on_hand', label: 'On hand', align: 'right', render: (r) => num(r.qty_on_hand) },
          { key: 'reserved', label: 'Reserved', align: 'right', render: (r) => num(r.reserved) },
          { key: 'available', label: 'Available', align: 'right', render: (r) => <span className="font-medium text-red-600">{num(r.available)}</span> },
          { key: 'reorder_level', label: 'Reorder at', align: 'right', render: (r) => num(r.reorder_level) },
          { key: 'flag', label: '', render: (r) => (r.available <= 0 ? <StatusBadge tone="red" label="out of stock" /> : <StatusBadge tone="amber" label="low" />) },
        ]}
        rows={data || []}
        loading={loading}
        error={error}
        empty="Nothing is low on stock"
      />
    </Card>
  );
};

const StaffPerformance = ({ scope }) => {
  const params = { from: scope.from, to: scope.to, store_id: scope.store_id };
  const { data, loading, error } = useApi(() => reportStaff(params), [JSON.stringify(params)]);
  const rows = data || [];
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Card className="xl:col-span-2" title="Orders entered by staff" subtitle="Franchise filter does not apply" bodyClassName="">
        <DataTable
          columns={[
            { key: 'name', label: 'Staff', render: (r) => r.name || r.staff_id },
            { key: 'orders', label: 'Orders', align: 'right', render: (r) => num(r.orders) },
            { key: 'cancelled', label: 'Cancelled', align: 'right', render: (r) => num(r.cancelled) },
            { key: 'value', label: 'Value', align: 'right', render: (r) => <span className="font-medium">{inr(r.value)}</span> },
          ]}
          rows={rows}
          rowKey={(r) => r.staff_id}
          loading={loading}
          error={error}
          empty="No staff-entered orders in this period"
        />
      </Card>
      <Card title="Order value by staff">
        <BarList items={rows.map((r) => ({ label: r.name || r.staff_id, value: r.value }))} format={inr} />
      </Card>
    </div>
  );
};

export default CommerceReports;
