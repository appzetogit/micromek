import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { RefreshCw, XCircle } from 'lucide-react';
import {
  Card, DataTable, Field, Input, Pager, PageShell, Select, StatusBadge, Toolbar, dateTime, inr, useApi, useDebounced,
} from '../platform/kit';
import { cancelShipment, listShipments, refreshShipment } from '../../services/commerceApi';
import {
  CANCELLABLE_SHIPMENT, MODULE, SHIPMENT_STATUSES, SHIPPING_PROVIDERS, TERMINAL_SHIPMENT, label, storeName, useStores, useToastAction,
} from './common';

const CommerceShipments = () => {
  const stores = useStores();
  const [filters, setFilters] = useState({ provider: '', status: '', store_id: '', awb: '' });
  const [page, setPage] = useState(1);
  const awb = useDebounced(filters.awb.trim());
  const { data, loading, error, reload } = useApi(
    () => listShipments({ provider: filters.provider, status: filters.status, store_id: filters.store_id, awb, page, limit: 20 }),
    [filters.provider, filters.status, filters.store_id, awb, page],
  );
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const storeById = new Map(stores.stores.map((s) => [s._id, s]));

  const [refresh, refreshing] = useToastAction((s) => refreshShipment(s._id), () => { toast.success('Tracking refreshed'); reload(); });
  const [cancel, cancelling] = useToastAction((s) => cancelShipment(s._id), () => { toast.success('Shipment cancelled'); reload(); });

  const columns = [
    {
      key: 'order', label: 'Order', render: (s) => (s.order_id ? (
        <Link to={`/admin/commerce/orders/${s.order_id._id}`} className="font-medium text-indigo-600 hover:underline whitespace-nowrap">{s.order_id.number}</Link>
      ) : '—'),
    },
    { key: 'store', label: 'Store', render: (s) => storeName(storeById.get(s.store_id)) },
    { key: 'provider', label: 'Provider', render: (s) => SHIPPING_PROVIDERS.find((p) => p.value === s.provider)?.label || label(s.provider) },
    {
      key: 'awb', label: 'AWB', render: (s) => (s.tracking_url
        ? <a href={s.tracking_url} target="_blank" rel="noreferrer" className="font-mono text-xs text-indigo-600 hover:underline">{s.awb || 'track'}</a>
        : <span className="font-mono text-xs">{s.awb || '—'}</span>),
    },
    { key: 'courier', label: 'Courier', render: (s) => s.courier_name || '—' },
    { key: 'cod', label: 'COD', align: 'right', render: (s) => (s.cod_amount ? inr(s.cod_amount) : '—') },
    { key: 'status', label: 'Status', render: (s) => (<div><StatusBadge status={s.status} />{s.error ? <p className="text-[11px] text-red-600 mt-1 max-w-[16rem] truncate" title={s.error}>{s.error}</p> : null}</div>) },
    { key: 'updatedAt', label: 'Updated', render: (s) => <span className="whitespace-nowrap">{dateTime(s.updatedAt)}</span> },
    {
      key: 'actions', label: '', align: 'right', render: (s) => (TERMINAL_SHIPMENT.includes(s.status) ? null : (
        <div className="flex justify-end gap-1">
          {s.awb && s.provider !== 'local_porter' ? (
            <button type="button" title="Refresh tracking" disabled={refreshing} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40" onClick={() => refresh(s)}>
              <RefreshCw size={14} />
            </button>
          ) : null}
          {CANCELLABLE_SHIPMENT.includes(s.status) ? (
            <button
              type="button"
              title="Cancel shipment"
              disabled={cancelling}
              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
              onClick={() => window.confirm(`Cancel shipment for ${s.order_id?.number || 'this order'}?`) && cancel(s)}
            >
              <XCircle size={14} />
            </button>
          ) : null}
        </div>
      )),
    },
  ];

  return (
    <PageShell module={MODULE} page="Shipments" title="Shipments">
      <Card bodyClassName="">
        <Toolbar>
          <Field label="AWB" className="w-full sm:w-48"><Input placeholder="Exact AWB" value={filters.awb} onChange={set('awb')} /></Field>
          <Field label="Provider" className="w-full sm:w-52"><Select placeholder="All" options={SHIPPING_PROVIDERS} value={filters.provider} onChange={set('provider')} /></Field>
          <Field label="Status" className="w-full sm:w-44"><Select placeholder="All" options={SHIPMENT_STATUSES} value={filters.status} onChange={set('status')} /></Field>
          <Field label="Store" className="w-full sm:w-52"><Select placeholder="All stores" options={stores.options} value={filters.store_id} onChange={set('store_id')} /></Field>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No shipments" />
        <Pager data={data} onPage={setPage} />
      </Card>
    </PageShell>
  );
};

export default CommerceShipments;
