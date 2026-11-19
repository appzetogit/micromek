import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, Banknote, X } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Notice, Pager, Select, StatusBadge, Textarea, Toolbar,
  dateTime, inr, useApi, useDebounced,
} from '../platform/kit';
import { approveRefund, createRefund, listRefunds, payRefund, rejectRefund } from '../../services/commerceApi';
import { REFUND_METHODS, REFUND_STATUSES, label, periodParams, storeName, useToastAction } from './common';

/**
 * Refund records (Backend commerce services/refundService.js). Bookkeeping only: the money is
 * returned by hand (gateway refunds are not automated) and "Mark paid" records the reference.
 */

const REFUND_TONE = { requested: 'amber', approved: 'blue', paid: 'green', rejected: 'red' };

export const RefundBadge = ({ status }) => <StatusBadge status={status} tone={REFUND_TONE[status]} />;

const who = (actor, at) => (actor ? `${actor.name || actor.type}${at ? ` · ${dateTime(at)}` : ''}` : '—');

/** reject (reason) / pay (reference + method) modal. */
const RefundStepModal = ({ refund, mode, onClose, onDone }) => {
  const [form, setForm] = useState({ reason: '', reference: '', method: refund.method || 'original', notes: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [run, busy] = useToastAction(
    () => (mode === 'reject'
      ? rejectRefund(refund._id, form.reason)
      : payRefund(refund._id, { reference: form.reference, method: form.method, notes: form.notes || undefined })),
    () => { toast.success(mode === 'reject' ? 'Refund rejected' : 'Refund marked paid'); onDone(); },
  );
  const valid = mode === 'reject' ? form.reason.trim() : form.reference.trim();
  return (
    <Modal
      open
      title={`${mode === 'reject' ? 'Reject' : 'Mark paid'}: ${inr(refund.amount)} on ${refund.order_number}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'reject' ? 'danger' : 'success'} busy={busy} disabled={!valid} onClick={() => run()}>
            {mode === 'reject' ? 'Reject refund' : 'Mark paid'}
          </Button>
        </>
      )}
    >
      {mode === 'reject' ? (
        <Field label="Reason *"><Textarea value={form.reason} onChange={set('reason')} /></Field>
      ) : (
        <>
          <Notice tone="blue">No payment gateway is called. Send the money yourself, then record how it was paid.</Notice>
          <Field label="Reference *" hint="UTR, Razorpay refund id, cash receipt no."><Input value={form.reference} onChange={set('reference')} /></Field>
          <Field label="Method"><Select options={REFUND_METHODS} value={form.method} onChange={set('method')} /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={set('notes')} /></Field>
        </>
      )}
    </Modal>
  );
};

const IconAction = ({ title, tone, onClick, children }) => (
  <button
    type="button"
    title={title}
    className={`p-1.5 rounded-lg ${tone}`}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
  >
    {children}
  </button>
);

/** Table of refunds with approve / reject / mark-paid actions. */
export const RefundTable = ({ rows, loading, error, showOrder = false, onChanged, empty = 'No refunds' }) => {
  const [step, setStep] = useState(null);
  const [approve] = useToastAction((r) => approveRefund(r._id), () => { toast.success('Refund approved'); onChanged(); });
  const columns = [
    ...(showOrder ? [
      { key: 'order', label: 'Order', render: (r) => <Link className="text-indigo-600 hover:underline whitespace-nowrap" to={`/admin/commerce/orders/${r.order_id?._id || r.order_id}`}>{r.order_number}</Link> },
      { key: 'customer', label: 'Customer', render: (r) => r.customer_name || '—' },
      { key: 'store', label: 'Store', render: (r) => storeName(r.store_id) },
    ] : []),
    { key: 'createdAt', label: 'Requested', render: (r) => <span className="whitespace-nowrap" title={who(r.requested_by, r.requested_at)}>{dateTime(r.requested_at || r.createdAt)}</span> },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-medium">{inr(r.amount)}</span> },
    { key: 'reason', label: 'Reason', render: (r) => (<div><p>{r.reason || '—'}{r.auto ? <span className="text-xs text-gray-400"> · auto</span> : null}</p>{r.rejection_reason ? <p className="text-xs text-red-600">Rejected: {r.rejection_reason}</p> : null}</div>) },
    { key: 'method', label: 'Method', render: (r) => <span className="capitalize">{label(r.method)}</span> },
    { key: 'status', label: 'Status', render: (r) => <RefundBadge status={r.status} /> },
    {
      key: 'trail', label: 'Approved / paid', render: (r) => (
        <div className="text-xs text-gray-500">
          {r.approved_by ? <p>Approved: {who(r.approved_by, r.approved_at)}</p> : null}
          {r.paid_by ? <p>Paid: {who(r.paid_by, r.paid_at)} · <span className="font-mono">{r.payment_reference}</span></p> : null}
          {!r.approved_by && !r.paid_by ? '—' : null}
        </div>
      ),
    },
    {
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === 'requested' ? <IconAction title="Approve" tone="text-emerald-600 hover:bg-emerald-50" onClick={() => approve(r)}><Check size={14} /></IconAction> : null}
          {r.status === 'approved' ? <IconAction title="Mark paid" tone="text-emerald-600 hover:bg-emerald-50" onClick={() => setStep({ refund: r, mode: 'pay' })}><Banknote size={14} /></IconAction> : null}
          {['requested', 'approved'].includes(r.status) ? <IconAction title="Reject" tone="text-red-500 hover:bg-red-50" onClick={() => setStep({ refund: r, mode: 'reject' })}><X size={14} /></IconAction> : null}
        </div>
      ),
    },
  ];
  return (
    <>
      <DataTable columns={columns} rows={rows || []} loading={loading} error={error} empty={empty} />
      {step ? <RefundStepModal key={`${step.refund._id}-${step.mode}`} {...step} onClose={() => setStep(null)} onDone={() => { setStep(null); onChanged(); }} /> : null}
    </>
  );
};

/** Partial (or remaining) refund on an order. */
export const NewRefundModal = ({ order, onClose, onCreated }) => {
  const p = order.payment || {};
  const refundable = Math.max(0, Math.round(((p.paid_amount || 0) - (p.refund_committed || 0)) * 100) / 100);
  const [form, setForm] = useState({ amount: String(refundable), reason: '', method: 'original', notes: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [run, busy] = useToastAction(
    () => createRefund(order._id, { amount: Number(form.amount), reason: form.reason, method: form.method, notes: form.notes || undefined }),
    () => { toast.success('Refund requested'); onCreated(); },
  );
  const amt = Number(form.amount);
  return (
    <Modal
      open
      title={`Refund on ${order.number}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!(amt > 0) || amt > refundable + 0.001 || !form.reason.trim()} onClick={() => run()}>Request refund</Button>
        </>
      )}
    >
      <p className="text-sm text-gray-500">
        Paid {inr(p.paid_amount)} · already in refunds {inr(p.refund_committed || 0)} · refundable <b className="text-gray-900">{inr(refundable)}</b>
      </p>
      <Field label="Amount ₹ *"><Input type="number" min="0" max={refundable} step="0.01" value={form.amount} onChange={set('amount')} /></Field>
      <Field label="Reason *"><Input value={form.reason} onChange={set('reason')} placeholder="e.g. damaged item, price correction" /></Field>
      <Field label="Method"><Select options={REFUND_METHODS} value={form.method} onChange={set('method')} /></Field>
      <Field label="Notes"><Textarea value={form.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
};

const EMPTY = { status: '', store_id: '', from: '', to: '', search: '' };

/** Refunds tab of the Orders page. */
export const RefundsPanel = ({ storeOptions }) => {
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const search = useDebounced(filters.search);
  const { from, to, search: _s, ...rest } = filters;
  const params = { ...rest, ...periodParams(from, to), search, page, limit: 20 };
  const { data, loading, error, reload } = useApi(() => listRefunds(params), [JSON.stringify(params)]);
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const summary = data?.summary || {};
  return (
    <Card bodyClassName="">
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 pt-3 text-xs text-gray-500">
        {REFUND_STATUSES.map((s) => (
          <span key={s}><span className="capitalize">{s}</span>: <b className="text-gray-800">{summary[s]?.count || 0}</b> · {inr(summary[s]?.amount || 0)}</span>
        ))}
      </div>
      <Toolbar>
        <Field label="Search" className="w-full sm:w-56"><Input placeholder="Order no., customer, reference" value={filters.search} onChange={set('search')} /></Field>
        <Field label="Status" className="w-full sm:w-36"><Select placeholder="Any" options={REFUND_STATUSES} value={filters.status} onChange={set('status')} /></Field>
        <Field label="Store" className="w-full sm:w-48"><Select placeholder="All stores" options={storeOptions} value={filters.store_id} onChange={set('store_id')} /></Field>
        <Field label="From" className="w-full sm:w-40"><Input type="date" value={filters.from} onChange={set('from')} /></Field>
        <Field label="To" className="w-full sm:w-40"><Input type="date" value={filters.to} onChange={set('to')} /></Field>
        <Button variant="secondary" onClick={() => { setFilters(EMPTY); setPage(1); }}>Reset</Button>
      </Toolbar>
      <RefundTable rows={data?.items} loading={loading} error={error} showOrder onChanged={reload} empty="No refunds match these filters" />
      <Pager data={data} onPage={setPage} />
    </Card>
  );
};
