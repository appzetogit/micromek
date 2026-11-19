import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Activity, Building2, Car, CheckCircle2, Edit, IndianRupee, Landmark, Loader2, MapPin, Percent,
  PauseCircle, PlayCircle, Receipt, Star, Trash2, Users, XCircle,
} from 'lucide-react';
import {
  BarList, Button, Card, DataTable, KeyValue, Modal, Notice, PageShell, StatCard, StatGrid, StatusBadge,
  Field, Textarea, Toolbar, dateOnly, dateTime, errorMessage, inr, isoDay, num, pct, useAction, useApi,
} from '../platform/kit';
import { deleteFranchise, getFranchise, setFranchiseStatus } from '../../services/franchiseApi';
import { MODULE, STATUS_ACTIONS, TRANSPORT_TYPES, refName, ruleLabel, territoryConflict, toIsoRange } from './franchiseHelpers';
import { DateRange, TerritoryConflict } from './FranchiseParts';

const ACTION_META = {
  approve: { label: 'Approve', done: 'approved', icon: CheckCircle2, variant: 'success' },
  reject: { label: 'Reject', done: 'rejected', icon: XCircle, variant: 'danger' },
  suspend: { label: 'Suspend', done: 'suspended', icon: PauseCircle, variant: 'danger' },
  reactivate: { label: 'Reactivate', done: 'reactivated', icon: PlayCircle, variant: 'success' },
};

const breakdownColumns = [
  { key: 'transport_type', label: 'Transport type', render: (r) => <span className="capitalize">{r.transport_type}</span> },
  { key: 'rides', label: 'Rides', align: 'right', render: (r) => num(r.rides) },
  { key: 'gross_fare', label: 'Gross fare', align: 'right', render: (r) => inr(r.gross_fare) },
  { key: 'platform_commission', label: 'Platform commission', align: 'right', render: (r) => inr(r.platform_commission) },
  { key: 'rule', label: 'Rule', render: (r) => ruleLabel({ type: r.rule_type, value: r.rule_value }) },
  { key: 'franchise_share', label: 'Franchise share', align: 'right', render: (r) => inr(r.franchise_share) },
];

const Chips = ({ items }) => (items?.length ? (
  <div className="flex flex-wrap gap-1.5">
    {items.map((x) => (
      <span key={x._id || x} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-xs">{refName(x)}</span>
    ))}
  </div>
) : <span className="text-gray-400">None</span>);

const FranchiseDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: isoDay(29), to: isoDay(0) });
  const [pending, setPending] = useState(null); // status action awaiting a note
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState(null);

  const { data, loading, error, reload } = useApi(
    () => getFranchise(id, toIsoRange(range.from, range.to)),
    [id, range.from, range.to],
  );
  const franchise = data?.franchise;
  const perf = data?.performance;

  const [runStatus, statusBusy] = useAction(
    () => setFranchiseStatus(id, pending, note.trim()),
    {
      onSuccess: () => {
        toast.success(`Franchise ${ACTION_META[pending].done}`);
        setPending(null);
        setNote('');
        setConflict(null);
        reload();
      },
      onError: (err) => {
        const taken = territoryConflict(err);
        if (taken) {
          setConflict(taken);
          setPending(null);
        } else toast.error(errorMessage(err));
      },
    },
  );

  const [runDelete, deleting] = useAction(() => deleteFranchise(id), {
    onSuccess: () => {
      toast.success('Franchise deleted');
      navigate('/admin/franchises');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const confirmDelete = () => {
    if (window.confirm(`Delete ${franchise.name}? Its territory is released and it can no longer log in.`)) runDelete();
  };

  if (loading && !data) {
    return <PageShell module={MODULE} page="Franchise" backTo="/admin/franchises"><p className="text-sm text-gray-400"><Loader2 size={16} className="inline animate-spin mr-2" />Loading…</p></PageShell>;
  }
  if (!franchise) {
    return <PageShell module={MODULE} page="Franchise" backTo="/admin/franchises"><Notice tone="red">{error || 'Franchise not found'}</Notice></PageShell>;
  }

  const actions = STATUS_ACTIONS[franchise.status] || [];
  const byType = franchise.commission?.by_transport_type || {};

  return (
    <PageShell
      module={MODULE}
      page={franchise.name}
      title={franchise.name}
      backTo="/admin/franchises"
      right={<Button variant="secondary" icon={Edit} onClick={() => navigate(`/admin/franchises/${id}/edit`)}>Edit</Button>}
    >
      {conflict ? <TerritoryConflict franchises={conflict} /> : null}
      {error ? <Notice tone="red">{error}</Notice> : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card
          className="lg:col-span-2"
          title="Profile"
          subtitle={franchise.code}
          icon={Building2}
          right={<StatusBadge status={franchise.status} />}
        >
          <KeyValue
            items={[
              ['Business type', <span className="capitalize">{franchise.business_type}</span>],
              ['Contact', franchise.contact_name],
              ['Mobile', franchise.mobile],
              ['Email', franchise.email],
              ['Address', [franchise.address, franchise.city, franchise.state, franchise.pincode].filter(Boolean).join(', ') || '—'],
              ['GST / PAN', [franchise.gst_number, franchise.pan_number].filter(Boolean).join(' / ') || '—'],
              ['Contract', `${dateOnly(franchise.contract_start)} → ${dateOnly(franchise.contract_end)}`],
              ['Settlement cycle', <span className="capitalize">{franchise.settlement_cycle}</span>],
              ['Last login', dateTime(franchise.last_login_at)],
              ['Created', dateTime(franchise.createdAt)],
            ]}
          />
        </Card>

        <Card title="Status" icon={Activity}>
          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              <p>Current: <StatusBadge status={franchise.status} /></p>
              {franchise.status_note ? <p className="mt-2 text-gray-500">“{franchise.status_note}”</p> : null}
              {franchise.reviewed_at ? <p className="mt-1 text-xs text-gray-400">Reviewed {dateTime(franchise.reviewed_at)}</p> : null}
            </div>
            {actions.map((a) => (
              <Button key={a} variant={ACTION_META[a].variant} icon={ACTION_META[a].icon} className="w-full" onClick={() => setPending(a)}>
                {ACTION_META[a].label}
              </Button>
            ))}
            <Button variant="secondary" icon={Receipt} className="w-full" onClick={() => navigate(`/admin/franchise-settlements?franchise_id=${id}`)}>
              View settlements
            </Button>
            <Button variant="danger" icon={Trash2} className="w-full" busy={deleting} onClick={confirmDelete}>Delete franchise</Button>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card title="Territory" icon={MapPin}>
          <KeyValue items={[
            ['Service locations', <Chips items={franchise.service_location_ids} />],
            ['Zones', <Chips items={franchise.zone_ids} />],
          ]}
          />
        </Card>
        <Card title="Commission rules" icon={Percent}>
          <KeyValue items={[
            ['Default', ruleLabel(franchise.commission?.default)],
            ...TRANSPORT_TYPES.map((t) => [
              t[0].toUpperCase() + t.slice(1),
              byType[t] ? ruleLabel(byType[t]) : <span className="text-gray-400">Uses default</span>,
            ]),
          ]}
          />
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">Fares in territory (× platform tariff)</p>
            <KeyValue items={TRANSPORT_TYPES.map((t) => {
              const v = Number(franchise.fare_multipliers?.[t] ?? 1);
              return [t[0].toUpperCase() + t.slice(1), v === 1 ? <span className="text-gray-400">Platform price</span> : `${v}× (${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%)`];
            })}
            />
          </div>
        </Card>
        <Card title="Bank details" icon={Landmark}>
          <KeyValue items={[
            ['Account name', franchise.bank?.account_name || '—'],
            ['Account number', franchise.bank?.account_number || '—'],
            ['IFSC', franchise.bank?.ifsc || '—'],
            ['Bank', franchise.bank?.bank_name || '—'],
            ['UPI', franchise.bank?.upi_id || '—'],
          ]}
          />
        </Card>
      </div>

      <Card title="Performance" subtitle="Completed rides in the franchise territory" icon={Activity} className="mb-6" bodyClassName="">
        <Toolbar>
          <DateRange from={range.from} to={range.to} onChange={setRange} />
          {loading ? <Loader2 size={16} className="animate-spin text-gray-400 mb-2.5" /> : null}
        </Toolbar>
        {perf ? (
          <div className="p-5">
            <StatGrid>
              <StatCard label="Completed rides" value={num(perf.rides)} hint={`${num(perf.requests)} requested · ${num(perf.cancelled)} cancelled`} icon={Car} />
              <StatCard label="Gross fare" value={inr(perf.gross_fare)} icon={IndianRupee} tone="blue" />
              <StatCard label="Platform commission" value={inr(perf.platform_commission)} icon={IndianRupee} tone="gray" />
              <StatCard label="Franchise share" value={inr(perf.franchise_share)} icon={IndianRupee} tone="green" />
              <StatCard label="Completion rate" value={pct(perf.completion_rate, 1)} icon={CheckCircle2} tone="green" />
              <StatCard label="Drivers online" value={`${num(perf.drivers_online)} / ${num(perf.drivers_total)}`} icon={Users} tone="amber" />
              <StatCard label="Avg driver rating" value={perf.avg_driver_rating ?? '—'} icon={Star} tone="amber" />
            </StatGrid>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 border border-gray-100 rounded-lg">
                <DataTable columns={breakdownColumns} rows={perf.breakdown || []} rowKey={(r) => r.transport_type} empty="No completed rides in this period" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-3">Gross fare by transport type</p>
                <BarList items={(perf.breakdown || []).map((r) => ({ label: r.transport_type, value: r.gross_fare }))} format={inr} />
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <Modal
        open={Boolean(pending)}
        title={pending ? `${ACTION_META[pending].label} ${franchise.name}` : ''}
        onClose={() => setPending(null)}
        footer={pending ? (
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant={ACTION_META[pending].variant} busy={statusBusy} onClick={() => runStatus()}>{ACTION_META[pending].label}</Button>
          </>
        ) : null}
      >
        <Field label="Note" hint="Saved on the franchise as the status note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional reason" />
        </Field>
      </Modal>
    </PageShell>
  );
};

export default FranchiseDetail;
