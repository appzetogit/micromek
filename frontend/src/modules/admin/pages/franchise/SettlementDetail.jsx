import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Ban, Banknote, CheckCircle2, IndianRupee, Landmark, ListPlus, Loader2, Receipt, RefreshCw, Scale,
} from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, KeyValue, Modal, Notice, PageShell, Select, StatCard, StatGrid,
  StatusBadge, dateTime, errorMessage, inr, num, useAction, useApi,
} from '../platform/kit';
import {
  addSettlementAdjustment, getSettlement, refreshSettlement, transitionSettlement,
} from '../../services/franchiseApi';
import { MODULE, periodText, ruleLabel } from './franchiseHelpers';

const PAYMENT_MODES = ['bank_transfer', 'upi', 'cheque', 'cash'];

const breakdownColumns = [
  { key: 'transport_type', label: 'Transport type', render: (r) => <span className="capitalize">{r.transport_type}</span> },
  { key: 'rides', label: 'Rides', align: 'right', render: (r) => num(r.rides) },
  { key: 'gross_fare', label: 'Gross fare', align: 'right', render: (r) => inr(r.gross_fare) },
  { key: 'platform_commission', label: 'Platform commission', align: 'right', render: (r) => inr(r.platform_commission) },
  { key: 'rule', label: 'Rule', render: (r) => ruleLabel({ type: r.rule_type, value: r.rule_value }) },
  { key: 'franchise_share', label: 'Franchise share', align: 'right', render: (r) => inr(r.franchise_share) },
];

const adjustmentColumns = [
  { key: 'at', label: 'When', render: (a) => dateTime(a.at) },
  { key: 'reason', label: 'Reason' },
  {
    key: 'amount',
    label: 'Amount',
    align: 'right',
    render: (a) => <span className={a.amount < 0 ? 'text-red-600' : 'text-emerald-600'}>{a.amount > 0 ? '+' : ''}{inr(a.amount)}</span>,
  },
];

const SettlementDetail = () => {
  const { id } = useParams();
  const { data: s, loading, error, reload } = useApi(() => getSettlement(id), [id]);
  const [adjustment, setAdjustment] = useState({ amount: '', reason: '' });
  const [payOpen, setPayOpen] = useState(false);
  const [payment, setPayment] = useState({ payment_reference: '', payment_mode: 'bank_transfer' });

  const done = (message) => () => {
    toast.success(message);
    reload();
  };
  const fail = (err) => toast.error(errorMessage(err));

  const [refresh, refreshing] = useAction(() => refreshSettlement(id), { onSuccess: done('Totals refreshed'), onError: fail });
  const [approve, approving] = useAction(() => transitionSettlement(id, 'approve'), { onSuccess: done('Settlement approved'), onError: fail });
  const [cancel, cancelling] = useAction(() => transitionSettlement(id, 'cancel'), { onSuccess: done('Settlement cancelled'), onError: fail });
  const [pay, paying] = useAction(
    () => transitionSettlement(id, 'pay', { payment_reference: payment.payment_reference.trim(), payment_mode: payment.payment_mode }),
    {
      onSuccess: () => {
        setPayOpen(false);
        done('Settlement marked as paid')();
      },
      onError: fail,
    },
  );
  const [adjust, adjusting] = useAction(
    () => addSettlementAdjustment(id, { amount: Number(adjustment.amount), reason: adjustment.reason.trim() }),
    {
      onSuccess: () => {
        setAdjustment({ amount: '', reason: '' });
        done('Adjustment added')();
      },
      onError: fail,
    },
  );

  const submitAdjustment = (e) => {
    e.preventDefault();
    const amount = Number(adjustment.amount);
    if (!Number.isFinite(amount) || amount === 0) toast.error('Enter a non-zero amount');
    else if (!adjustment.reason.trim()) toast.error('Enter a reason');
    else adjust();
  };

  if (loading && !s) {
    return <PageShell module={MODULE} page="Settlement" backTo="/admin/franchise-settlements"><p className="text-sm text-gray-400"><Loader2 size={16} className="inline animate-spin mr-2" />Loading…</p></PageShell>;
  }
  if (!s) {
    return <PageShell module={MODULE} page="Settlement" backTo="/admin/franchise-settlements"><Notice tone="red">{error || 'Settlement not found'}</Notice></PageShell>;
  }

  const franchise = s.franchise_id || {};
  const bank = franchise.bank || {};
  const isDraft = s.status === 'draft';
  const isApproved = s.status === 'approved';
  const adjustmentsTotal = (s.adjustments || []).reduce((acc, a) => acc + Number(a.amount || 0), 0);

  return (
    <PageShell
      module={MODULE}
      page="Settlement"
      title={`${franchise.name || 'Settlement'} · ${periodText(s)}`}
      backTo="/admin/franchise-settlements"
      right={<StatusBadge status={s.status} />}
    >
      {error ? <Notice tone="red">{error}</Notice> : null}

      <StatGrid>
        <StatCard label="Completed rides" value={num(s.rides)} icon={Receipt} />
        <StatCard label="Gross fare" value={inr(s.gross_fare)} icon={IndianRupee} tone="blue" />
        <StatCard label="Platform commission" value={inr(s.platform_commission)} icon={IndianRupee} tone="gray" />
        <StatCard label="Franchise share" value={inr(s.franchise_share)} icon={IndianRupee} tone="green" />
        <StatCard label="Adjustments" value={inr(adjustmentsTotal)} icon={Scale} tone={adjustmentsTotal < 0 ? 'red' : 'amber'} />
        <StatCard label="Payable" value={inr(s.payable)} icon={Banknote} tone="indigo" />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title="Breakdown by transport type" icon={Receipt} bodyClassName="">
            <DataTable columns={breakdownColumns} rows={s.breakdown || []} rowKey={(r) => r.transport_type} empty="No completed rides in this period" />
          </Card>

          <Card title="Adjustments" subtitle="Credits (+) or deductions (−) on the franchise share" icon={Scale} bodyClassName="">
            <DataTable columns={adjustmentColumns} rows={s.adjustments || []} empty="No adjustments" />
            {isDraft ? (
              <form onSubmit={submitAdjustment} className="grid grid-cols-1 sm:grid-cols-[9rem_1fr_auto] gap-3 items-end p-4 border-t border-gray-100">
                <Field label="Amount (₹)">
                  <Input type="number" step="0.01" value={adjustment.amount} onChange={(e) => setAdjustment((a) => ({ ...a, amount: e.target.value }))} placeholder="-500" />
                </Field>
                <Field label="Reason">
                  <Input value={adjustment.reason} onChange={(e) => setAdjustment((a) => ({ ...a, reason: e.target.value }))} placeholder="e.g. penalty for missed SLA" />
                </Field>
                <Button type="submit" icon={ListPlus} busy={adjusting}>Add</Button>
              </form>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Actions" icon={CheckCircle2}>
            <div className="space-y-3">
              {isDraft ? (
                <>
                  <Button variant="secondary" icon={RefreshCw} className="w-full" busy={refreshing} onClick={() => refresh()}>Refresh totals</Button>
                  <Button
                    variant="success"
                    icon={CheckCircle2}
                    className="w-full"
                    busy={approving}
                    onClick={() => window.confirm(`Approve this settlement for ${inr(s.payable)}? Totals and adjustments are locked after approval.`) && approve()}
                  >
                    Approve
                  </Button>
                </>
              ) : null}
              {isApproved ? <Button icon={Banknote} className="w-full" onClick={() => setPayOpen(true)}>Mark as paid</Button> : null}
              {isDraft || isApproved ? (
                <Button
                  variant="danger"
                  icon={Ban}
                  className="w-full"
                  busy={cancelling}
                  onClick={() => window.confirm('Cancel this settlement? The period can then be generated again.') && cancel()}
                >
                  Cancel settlement
                </Button>
              ) : null}
              {!isDraft && !isApproved ? <p className="text-sm text-gray-400">No actions for a {s.status} settlement.</p> : null}
            </div>
          </Card>

          <Card title="Details" icon={Receipt}>
            <KeyValue items={[
              ['Franchise', franchise._id ? <Link className="text-indigo-600 hover:underline" to={`/admin/franchises/${franchise._id}`}>{franchise.name} ({franchise.code})</Link> : '—'],
              ['Source', <span className="capitalize">{s.source}</span>],
              ['Created', dateTime(s.createdAt)],
              ['Approved', dateTime(s.approved_at)],
              ['Paid', dateTime(s.paid_at)],
              ['Payment', s.payment_reference ? `${s.payment_reference} (${String(s.payment_mode).replace(/_/g, ' ')})` : '—'],
              ['Notes', s.notes || '—'],
            ]}
            />
          </Card>

          <Card title="Payout bank details" icon={Landmark}>
            {bank.account_number || bank.upi_id ? (
              <KeyValue items={[
                ['Account name', bank.account_name || '—'],
                ['Account number', bank.account_number || '—'],
                ['IFSC', bank.ifsc || '—'],
                ['Bank', bank.bank_name || '—'],
                ['UPI', bank.upi_id || '—'],
              ]}
              />
            ) : <p className="text-sm text-gray-400">No bank details on file for this franchise.</p>}
          </Card>
        </div>
      </div>

      <Modal
        open={payOpen}
        title={`Pay ${inr(s.payable)} to ${franchise.name || 'franchise'}`}
        onClose={() => setPayOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button
              icon={Banknote}
              busy={paying}
              disabled={!payment.payment_reference.trim()}
              onClick={() => pay()}
            >
              Mark as paid
            </Button>
          </>
        )}
      >
        <p className="text-sm text-gray-500">Record the payout you made outside the panel. This cannot be undone.</p>
        <Field label="Payment reference *" hint="UTR, transaction or cheque number">
          <Input value={payment.payment_reference} onChange={(e) => setPayment((p) => ({ ...p, payment_reference: e.target.value }))} />
        </Field>
        <Field label="Payment mode">
          <Select value={payment.payment_mode} onChange={(e) => setPayment((p) => ({ ...p, payment_mode: e.target.value }))} options={PAYMENT_MODES} />
        </Field>
      </Modal>
    </PageShell>
  );
};

export default SettlementDetail;
