import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CreditCard, Download, FileText, History, Loader2, MapPin, Package, RefreshCw, Truck, Undo2, User, XCircle } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, KeyValue, Modal, Notice, PageShell, Select, StatusBadge, Textarea,
  dateOnly, dateTime, downloadFile, errorMessage, inr, num, useApi,
} from '../platform/kit';
import {
  addPayment, bookShipment, cancelShipment, getOrder, invoicePdfUrl, issueInvoice, refreshShipment, setOrderStatus,
  setShipmentStatus, shippingRates,
} from '../../services/commerceApi';
import {
  CANCELLABLE_SHIPMENT, MODULE, ORDER_TRANSITIONS, SHIPMENT_STATUSES, SHIPPING_PROVIDERS, TERMINAL_SHIPMENT,
  formatAddress, label, storeName, useToastAction,
} from './common';
import { NewRefundModal, RefundTable } from './refunds';

const BACK = '/admin/commerce/orders';

const CommerceOrderDetail = () => {
  const { id } = useParams();
  const { data: order, loading, error, reload } = useApi(() => getOrder(id), [id]);

  if (loading && !order) {
    return (
      <PageShell module={MODULE} page="Order" title="Order" backTo={BACK}>
        <div className="py-20 text-center text-gray-400"><Loader2 className="inline animate-spin mr-2" size={16} />Loading order…</div>
      </PageShell>
    );
  }
  if (error && !order) {
    return (
      <PageShell module={MODULE} page="Order" title="Order" backTo={BACK}>
        <Notice tone="red">{error}</Notice>
        <Button variant="secondary" icon={RefreshCw} onClick={reload}>Retry</Button>
      </PageShell>
    );
  }

  return (
    <PageShell module={MODULE} page={order.number} title={`Order ${order.number}`} backTo={BACK}>
      <StatusBar order={order} onChanged={reload} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <LineItems order={order} />
          <Shipments order={order} onChanged={reload} />
          <Payments order={order} onChanged={reload} />
          <Refunds order={order} onChanged={reload} />
        </div>
        <div className="space-y-6">
          <InvoiceCard order={order} onChanged={reload} />
          <CustomerCard order={order} />
          <Timeline order={order} />
        </div>
      </div>
    </PageShell>
  );
};

// ---------- status ----------

const DANGER = ['cancelled', 'returned'];

const StatusBar = ({ order, onChanged }) => {
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');
  const next = ORDER_TRANSITIONS[order.status] || [];
  const [run, busy] = useToastAction(() => setOrderStatus(order._id, target, note || undefined), () => {
    toast.success(`Order moved to ${label(target)}`);
    setTarget(null);
    setNote('');
    onChanged();
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2"><span className="text-gray-400">Status</span><StatusBadge status={order.status} /></div>
        <div className="flex items-center gap-2"><span className="text-gray-400">Payment</span><StatusBadge status={order.payment?.status} /></div>
        <div><span className="text-gray-400">Placed</span> <span className="text-gray-800">{dateTime(order.createdAt)}</span></div>
        <div><span className="text-gray-400">Store</span> <span className="text-gray-800">{storeName(order.store_id)}</span></div>
        <div className="capitalize"><span className="text-gray-400 normal-case">Channel</span> <span className="text-gray-800">{order.channel} · {order.type} · {order.fulfilment}</span></div>
      </div>
      {next.length ? (
        <div className="flex flex-wrap gap-2">
          {next.map((s) => (
            <Button key={s} variant={DANGER.includes(s) ? 'danger' : 'primary'} onClick={() => setTarget(s)} className="capitalize">
              {s === 'delivered' && order.status === 'packed' ? 'Hand over (delivered)' : `Mark ${label(s)}`}
            </Button>
          ))}
        </div>
      ) : <span className="text-xs text-gray-400">No further status changes</span>}

      <Modal
        open={Boolean(target)}
        title={`Move order to ${label(target)}`}
        onClose={() => setTarget(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>Back</Button>
            <Button variant={DANGER.includes(target) ? 'danger' : 'primary'} busy={busy} onClick={() => run()}>Confirm</Button>
          </>
        )}
      >
        {target === 'cancelled' ? <Notice tone="red">Cancelling releases reserved stock and cancels any active shipment. A paid order becomes refund due (refunds are manual).</Notice> : null}
        {target === 'returned' ? <Notice tone="red">Returning puts the units back on the shelf. A paid order becomes refund due.</Notice> : null}
        {order.payment?.method === 'online' && order.payment?.status !== 'paid' && target === 'confirmed' ? (
          <Notice>Online orders cannot be confirmed until paid.</Notice>
        ) : null}
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </div>
  );
};

// ---------- items & totals ----------

const LineItems = ({ order }) => {
  const t = order.totals || {};
  const inter = t.supply_type === 'inter';
  const columns = [
    { key: 'name', label: 'Item', render: (i) => (<div><p className="text-gray-900">{i.name}</p><p className="text-xs text-gray-400">{i.sku}{i.hsn ? ` · HSN ${i.hsn}` : ''}</p></div>) },
    { key: 'qty', label: 'Qty', align: 'right', render: (i) => `${num(i.qty)} ${i.unit || ''}` },
    { key: 'unit_price', label: 'Unit price', align: 'right', render: (i) => (<span className="whitespace-nowrap">{inr(i.unit_price)}{i.tax_inclusive ? <span className="text-[10px] text-gray-400"> incl.</span> : null}</span>) },
    { key: 'discount', label: 'Discount', align: 'right', render: (i) => (i.discount ? inr(i.discount) : '—') },
    { key: 'taxable_value', label: 'Taxable', align: 'right', render: (i) => inr(i.taxable_value) },
    { key: 'gst', label: `GST ${inter ? '(IGST)' : '(CGST+SGST)'}`, align: 'right', render: (i) => (
      <span className="whitespace-nowrap">
        {inter ? inr(i.igst) : `${inr(i.cgst)} + ${inr(i.sgst)}`}
        <span className="block text-[10px] text-gray-400">{i.gst_rate}%</span>
      </span>
    ) },
    { key: 'total', label: 'Total', align: 'right', render: (i) => <span className="font-medium">{inr(i.total)}</span> },
  ];
  const rows = [
    ['Taxable value', t.subtotal],
    t.discount ? ['Discounts (incl. above)', t.discount] : null,
    ...(inter ? [['IGST', t.igst]] : [['CGST', t.cgst], ['SGST', t.sgst]]),
    t.shipping ? ['Shipping', t.shipping] : null,
    ['Round off', t.round_off],
  ].filter(Boolean);
  return (
    <Card title="Items" subtitle={`${order.items?.length || 0} lines · ${inter ? 'inter-state supply' : 'intra-state supply'}`} icon={Package} bodyClassName="">
      <DataTable columns={columns} rows={order.items || []} rowKey={(i) => i.product_id} />
      <div className="border-t border-gray-100 px-5 py-4 flex justify-end">
        <dl className="w-full sm:w-72 text-sm space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between"><dt className="text-gray-500">{k}</dt><dd className="text-gray-800">{inr(v)}</dd></div>
          ))}
          <div className="flex justify-between pt-2 border-t border-gray-100 font-semibold">
            <dt className="text-gray-900">Grand total</dt><dd className="text-gray-900">{inr(t.grand_total)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
};

// ---------- customer ----------

const CustomerCard = ({ order }) => {
  const c = order.customer_snapshot || {};
  return (
    <Card title="Customer" icon={User}>
      <KeyValue items={[
        ['Name', c.name],
        c.business_name ? ['Business', c.business_name] : null,
        ['Phone', c.phone || '—'],
        c.email ? ['Email', c.email] : null,
        c.gstin ? ['GSTIN', c.gstin] : null,
        ['Created by', order.created_by ? `${order.created_by.name || order.created_by.type} (${order.created_by.type})` : '—'],
      ]}
      />
      <div className="mt-4 pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400 flex items-center gap-1 mb-1"><MapPin size={12} /> {order.fulfilment === 'pickup' ? 'Store pickup' : 'Ship to'}</p>
        <p className="text-sm text-gray-800">{order.fulfilment === 'pickup' ? storeName(order.store_id) : formatAddress(order.ship_to)}</p>
        {order.ship_to?.phone ? <p className="text-xs text-gray-500 mt-0.5">{order.ship_to.phone}</p> : null}
      </div>
      {order.notes ? <p className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600 whitespace-pre-wrap">{order.notes}</p> : null}
    </Card>
  );
};

// ---------- timeline ----------

const Timeline = ({ order }) => (
  <Card title="Timeline" icon={History}>
    {order.timeline?.length ? (
      <ol className="space-y-4">
        {[...order.timeline].reverse().map((e, i) => (
          <li key={`${e.status}-${e.at}-${i}`} className="flex gap-3">
            <span className="mt-1.5 w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2"><StatusBadge status={e.status} /><span className="text-xs text-gray-400">{dateTime(e.at)}</span></div>
              {e.note ? <p className="text-sm text-gray-600 mt-1">{e.note}</p> : null}
              {e.by?.name || e.by?.type ? <p className="text-xs text-gray-400 mt-0.5">by {e.by.name || e.by.type}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    ) : <p className="text-sm text-gray-400">No events yet</p>}
  </Card>
);

// ---------- payments ----------

const Payments = ({ order, onChanged }) => {
  const p = order.payment || {};
  const due = Math.max(0, (order.totals?.grand_total || 0) - (p.paid_amount || 0));
  const canRecord = order.status !== 'cancelled' && ['pending', 'partial'].includes(p.status);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', method: 'cash', reference: '' });
  const [run, busy] = useToastAction(
    () => addPayment(order._id, { amount: Number(form.amount), method: form.method, reference: form.reference }),
    () => { toast.success('Payment recorded'); setOpen(false); onChanged(); },
  );
  const openModal = () => { setForm({ amount: String(Math.round(due * 100) / 100), method: 'cash', reference: '' }); setOpen(true); };

  return (
    <Card
      title="Payments"
      subtitle={`${label(p.method)} · paid ${inr(p.paid_amount)} of ${inr(order.totals?.grand_total)}${p.due_date ? ` · due ${dateOnly(p.due_date)}` : ''}`}
      icon={CreditCard}
      right={canRecord ? <Button onClick={openModal}>Record payment</Button> : null}
      bodyClassName=""
    >
      {p.razorpay_payment_id ? <p className="px-5 pt-3 text-xs text-gray-500">Razorpay payment {p.razorpay_payment_id}</p> : null}
      <DataTable
        columns={[
          { key: 'at', label: 'When', render: (e) => dateTime(e.at) },
          { key: 'amount', label: 'Amount', align: 'right', render: (e) => <span className="font-medium">{inr(e.amount)}</span> },
          { key: 'method', label: 'Method', render: (e) => <span className="capitalize">{label(e.method)}</span> },
          { key: 'reference', label: 'Reference', render: (e) => e.reference || '—' },
          { key: 'by', label: 'By', render: (e) => e.by?.name || e.by?.type || '—' },
        ]}
        rows={p.entries || []}
        rowKey={(e) => `${e.at}-${e.amount}`}
        empty="No payments recorded"
      />
      <Modal
        open={open}
        title="Record payment"
        onClose={() => setOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button busy={busy} disabled={!(Number(form.amount) > 0)} onClick={() => run()}>Record</Button>
          </>
        )}
      >
        <p className="text-sm text-gray-500">Balance due: <b className="text-gray-900">{inr(due)}</b></p>
        <Field label="Amount ₹ *"><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
        <Field label="Method">
          <Select options={['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other']} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} />
        </Field>
        <Field label="Reference"><Input placeholder="UTR / cheque no. / note" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></Field>
      </Modal>
    </Card>
  );
};

// ---------- refunds ----------

const Refunds = ({ order, onChanged }) => {
  const [creating, setCreating] = useState(false);
  const p = order.payment || {};
  const refundable = Math.max(0, (p.paid_amount || 0) - (p.refund_committed || 0));
  const refunds = order.refunds || [];
  if (!refunds.length && !(p.paid_amount > 0)) return null;
  return (
    <Card
      title="Refunds"
      subtitle={`refunded ${inr(p.refunded_amount || 0)} of ${inr(p.paid_amount)} paid · refundable ${inr(refundable)} · gateway refunds are done by hand`}
      icon={Undo2}
      right={refundable > 0.004 ? <Button variant="secondary" onClick={() => setCreating(true)}>New refund</Button> : null}
      bodyClassName=""
    >
      <RefundTable rows={refunds} onChanged={onChanged} empty="No refunds on this order" />
      {creating ? <NewRefundModal order={order} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); onChanged(); }} /> : null}
    </Card>
  );
};

// ---------- invoice ----------

const InvoiceCard = ({ order, onChanged }) => {
  const inv = order.invoice;
  const [downloading, setDownloading] = useState(false);
  const [issue, busy] = useToastAction(() => issueInvoice(order._id), (res) => {
    toast.success(`Invoice ${res?.data?.number || ''} issued`);
    onChanged();
  });
  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(invoicePdfUrl(inv._id), `${inv.number.replace(/\//g, '-')}.pdf`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not download the invoice'));
    } finally {
      setDownloading(false);
    }
  };
  const blocked = ['cancelled', 'returned'].includes(order.status);
  return (
    <Card title="Tax invoice" icon={FileText}>
      {inv ? (
        <div className="space-y-3">
          <KeyValue items={[['Number', inv.number], ['Issued', dateTime(inv.issued_at)]]} />
          <Button variant="secondary" icon={Download} busy={downloading} onClick={download}>Download PDF</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{blocked ? `No invoice; a ${order.status} order cannot be invoiced.` : 'Not issued yet. Invoices are immutable once issued.'}</p>
          {!blocked ? <Button busy={busy} onClick={() => issue()}>Issue invoice</Button> : null}
        </div>
      )}
    </Card>
  );
};

// ---------- shipments ----------

const isDisabledProvider = (err) => err?.status === 503 || err?.details?.code === 'SHIPPING_PROVIDER_DISABLED' || err?.code === 'SHIPPING_PROVIDER_DISABLED';
/** Forward-only progress, as in Backend shipping/status.js. */
const SHIPMENT_RANK = {
  created: 0, pending_assignment: 1, booked: 2, picked_up: 3, in_transit: 4, out_for_delivery: 5,
  rto: 6, delivered: 7, returned: 8, cancelled: 9, failed: 9,
};
const providerName = (v) => SHIPPING_PROVIDERS.find((p) => p.value === v)?.label || label(v);

const Shipments = ({ order, onChanged }) => {
  const [booking, setBooking] = useState(false);
  const shipments = order.shipments || [];
  const hasActive = shipments.some((s) => s.active);
  const shippable = order.fulfilment === 'delivery' && order.ship_to && ['confirmed', 'packed'].includes(order.status);
  return (
    <Card
      title="Shipments"
      icon={Truck}
      right={shippable && !hasActive ? <Button onClick={() => setBooking(true)}>Rates & book</Button> : null}
    >
      {order.fulfilment !== 'delivery' ? <p className="text-sm text-gray-400">Pickup order — no shipment needed.</p> : null}
      {order.fulfilment === 'delivery' && !shipments.length ? (
        <p className="text-sm text-gray-400">{shippable ? 'No shipment booked yet.' : 'Shipments can be booked once the order is confirmed or packed.'}</p>
      ) : null}
      <div className="space-y-4">
        {shipments.map((s) => <ShipmentRow key={s._id} shipment={s} onChanged={onChanged} />)}
      </div>
      {booking ? <BookShipmentModal order={order} onClose={() => setBooking(false)} onBooked={() => { setBooking(false); onChanged(); }} /> : null}
    </Card>
  );
};

const ShipmentRow = ({ shipment: s, onChanged }) => {
  const [status, setStatus] = useState('');
  const [refresh, refreshing] = useToastAction(() => refreshShipment(s._id), () => { toast.success('Tracking refreshed'); onChanged(); });
  const [cancel, cancelling] = useToastAction(() => cancelShipment(s._id), () => { toast.success('Shipment cancelled'); onChanged(); });
  const [update, updating] = useToastAction(() => setShipmentStatus(s._id, { status }), () => { toast.success('Shipment updated'); setStatus(''); onChanged(); });
  const terminal = TERMINAL_SHIPMENT.includes(s.status);
  const localNext = SHIPMENT_STATUSES.filter((x) => x !== s.status && (['cancelled', 'failed'].includes(x) || (SHIPMENT_RANK[x] ?? -1) > (SHIPMENT_RANK[s.status] ?? -1)));

  return (
    <div className={`rounded-lg border p-4 ${s.active ? 'border-gray-200' : 'border-gray-100 bg-gray-50/60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{providerName(s.provider)}</span>
            <StatusBadge status={s.status} />
            {!s.active ? <span className="text-[11px] text-gray-400">inactive</span> : null}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            AWB {s.awb || '—'}{s.courier_name ? ` · ${s.courier_name}` : ''}{s.charge ? ` · ${inr(s.charge)}` : ''}{s.cod_amount ? ` · COD ${inr(s.cod_amount)}` : ''}
          </p>
          {s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">Track shipment</a> : null}
          {s.error ? <p className="text-xs text-red-600 mt-1">{s.error}</p> : null}
          <p className="text-[11px] text-gray-400 mt-1">Updated {dateTime(s.updatedAt)}</p>
        </div>
        {!terminal ? (
          <div className="flex flex-wrap gap-2">
            {s.awb && s.provider !== 'local_porter' ? <Button variant="secondary" icon={RefreshCw} busy={refreshing} onClick={() => refresh()}>Refresh</Button> : null}
            {CANCELLABLE_SHIPMENT.includes(s.status) ? (
              <Button variant="danger" icon={XCircle} busy={cancelling} onClick={() => window.confirm('Cancel this shipment with the provider?') && cancel()}>Cancel</Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {s.provider === 'local_porter' && !terminal ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Update city-delivery status" className="w-full sm:w-56">
            <Select placeholder="Select status" options={localNext} value={status} onChange={(e) => setStatus(e.target.value)} />
          </Field>
          <Button busy={updating} disabled={!status} onClick={() => update()}>Update</Button>
        </div>
      ) : null}
      {s.events?.length ? (
        <ul className="mt-3 border-t border-gray-100 pt-3 space-y-1">
          {[...s.events].reverse().slice(0, 6).map((e, i) => (
            <li key={`${e.at}-${i}`} className="text-xs text-gray-500">
              <span className="text-gray-400">{dateTime(e.at)}</span> · <span className="capitalize">{label(e.status)}</span>{e.location ? ` · ${e.location}` : ''}{e.note ? ` · ${e.note}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const BookShipmentModal = ({ order, onClose, onBooked }) => {
  const [provider, setProvider] = useState('');
  const [pkg, setPkg] = useState({ weight_kg: '', length_cm: '', breadth_cm: '', height_cm: '' });
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [bookingKey, setBookingKey] = useState(null);

  const pkgBody = () => {
    const out = Object.fromEntries(Object.entries(pkg).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    return Object.keys(out).length ? out : undefined;
  };

  const getRates = async () => {
    setQuoting(true);
    setQuoteError(null);
    try {
      const res = await shippingRates(order._id, { provider: provider || undefined, package: pkgBody() });
      setQuote(res.data);
    } catch (err) {
      setQuote(null);
      setQuoteError(isDisabledProvider(err) ? `${providerName(provider)} is not configured on the server (missing credentials).` : errorMessage(err));
    } finally {
      setQuoting(false);
    }
  };

  const book = async (prov, courierId) => {
    setBookingKey(`${prov}:${courierId || ''}`);
    try {
      const res = await bookShipment(order._id, { provider: prov, courier_id: courierId || undefined, package: pkgBody() });
      toast.success(`Shipment booked${res?.data?.awb ? ` · AWB ${res.data.awb}` : ''}`);
      onBooked();
    } catch (err) {
      toast.error(isDisabledProvider(err) ? `${providerName(prov)} is not configured on the server.` : errorMessage(err));
    } finally {
      setBookingKey(null);
    }
  };

  const setP = (k) => (e) => setPkg((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Modal open wide title="Shipping rates & booking" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
        <Field label="Provider" className="col-span-2 sm:col-span-1">
          <Select placeholder="All enabled" options={SHIPPING_PROVIDERS} value={provider} onChange={(e) => setProvider(e.target.value)} />
        </Field>
        <Field label="Weight kg"><Input type="number" min="0" step="0.1" placeholder="auto" value={pkg.weight_kg} onChange={setP('weight_kg')} /></Field>
        <Field label="L cm"><Input type="number" min="0" placeholder="10" value={pkg.length_cm} onChange={setP('length_cm')} /></Field>
        <Field label="B cm"><Input type="number" min="0" placeholder="10" value={pkg.breadth_cm} onChange={setP('breadth_cm')} /></Field>
        <Field label="H cm"><Input type="number" min="0" placeholder="10" value={pkg.height_cm} onChange={setP('height_cm')} /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button busy={quoting} onClick={getRates}>Get rates</Button>
        {provider ? (
          <Button variant="secondary" busy={bookingKey === `${provider}:`} onClick={() => book(provider)}>Book with {providerName(provider)} (auto courier)</Button>
        ) : null}
      </div>
      {quoteError ? <Notice tone="red">{quoteError}</Notice> : null}
      {quote ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Package {quote.package?.weight_kg} kg · {quote.package?.length_cm}×{quote.package?.breadth_cm}×{quote.package?.height_cm} cm
            {quote.cod_amount ? ` · COD ${inr(quote.cod_amount)}` : ' · prepaid'}
          </p>
          {!quote.providers?.length ? <Notice>No shipping provider is configured on the server.</Notice> : null}
          {quote.providers?.map((p) => (
            <div key={p.provider}>
              <p className="text-sm font-medium text-gray-900 mb-2">{providerName(p.provider)}</p>
              {p.error ? <p className="text-xs text-red-600">{p.error}</p> : null}
              {!p.error && !p.rates?.length ? <p className="text-xs text-gray-400">No couriers serve this route.</p> : null}
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {p.rates?.map((r) => (
                  <div key={`${p.provider}-${r.courier_id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-gray-800 truncate">{r.courier_name || r.courier_id}</p>
                      <p className="text-xs text-gray-400">
                        {r.estimated_days !== null && r.estimated_days !== undefined ? `${r.estimated_days === 0 ? 'Same day' : `${r.estimated_days} days`}` : 'ETA n/a'}
                        {r.distance_km ? ` · ${num(r.distance_km, 1)} km` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-900">{inr(r.rate)}</span>
                      <Button busy={bookingKey === `${p.provider}:${r.courier_id}`} disabled={Boolean(bookingKey)} onClick={() => book(p.provider, r.courier_id)}>Book</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
};

export default CommerceOrderDetail;
