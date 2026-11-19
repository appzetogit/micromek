import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, Eye } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Modal, PageShell, Pager, Select, StatusBadge, Textarea, Toolbar,
  dateTime, errorMessage, num, timeAgo, useAction, useApi,
} from '../platform/kit';
import { acknowledgeEvAlert, listEvAlerts, resolveEvAlert } from '../../services/evApi';
import { ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TYPES } from './evShared';

const onError = (err) => toast.error(errorMessage(err));

const ResolveModal = ({ alert, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [resolve, busy] = useAction(() => resolveEvAlert(alert._id, note.trim()), {
    onSuccess: () => { toast.success('Alert resolved'); onDone(); },
    onError,
  });
  return (
    <Modal
      open
      title="Resolve alert?"
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" icon={CheckCircle2} busy={busy} onClick={() => resolve()}>Resolve</Button></>}
    >
      <p className="text-sm text-gray-600">{alert.message || alert.type.replace(/_/g, ' ')}</p>
      <p className="text-xs text-gray-400">If the condition still holds, the next poll raises a new alert.</p>
      <Field label="Resolution note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolved manually" /></Field>
    </Modal>
  );
};

const EvAlerts = () => {
  const [filters, setFilters] = useState({ status: 'live', type: '', severity: '' });
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState(null);
  const setFilter = (key) => (e) => { setFilters((f) => ({ ...f, [key]: e.target.value })); setPage(1); };
  const { data, loading, error, reload } = useApi(() => listEvAlerts({ ...filters, page, limit: 20 }), [filters, page]);
  const [acknowledge, acking] = useAction((id) => acknowledgeEvAlert(id), {
    onSuccess: () => { toast.success('Alert acknowledged'); reload(); },
    onError,
  });

  const columns = [
    { key: 'vehicle', label: 'Vehicle', render: (a) => (a.vehicle_id?._id ? (
      <Link to={`/admin/ev/vehicles/${a.vehicle_id._id}`} className="font-medium text-indigo-600 hover:underline">{a.vehicle_id.registration_no}</Link>
    ) : '—') },
    { key: 'type', label: 'Type', render: (a) => <span className="capitalize whitespace-nowrap">{a.type.replace(/_/g, ' ')}</span> },
    { key: 'severity', label: 'Severity', render: (a) => <StatusBadge status={a.severity} /> },
    { key: 'message', label: 'Message', render: (a) => <span className="text-xs">{a.message || '—'}</span> },
    { key: 'value', label: 'Value', align: 'right', render: (a) => num(a.value, 1) },
    { key: 'raised_at', label: 'Raised', render: (a) => <span title={dateTime(a.raised_at)}>{timeAgo(a.raised_at)}</span> },
    { key: 'status', label: 'Status', render: (a) => (
      <div>
        <StatusBadge status={a.status} />
        {a.resolved_at ? <p className="text-[11px] text-gray-400 mt-0.5">{a.resolved_by ? 'manual' : 'auto'} · {timeAgo(a.resolved_at)}</p> : null}
      </div>
    ) },
    { key: 'actions', label: '', align: 'right', render: (a) => (
      <div className="flex justify-end gap-2">
        {a.status === 'open' ? (
          <Button variant="secondary" icon={Eye} disabled={acking} onClick={() => acknowledge(a._id)}>Acknowledge</Button>
        ) : null}
        {a.status !== 'resolved' ? (
          <Button variant="secondary" icon={CheckCircle2} onClick={() => setResolving(a)}>Resolve</Button>
        ) : null}
      </div>
    ) },
  ];

  return (
    <PageShell module="EV Fleet" page="Alerts" title="EV Alerts">
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Status" className="w-full sm:w-56">
            <Select value={filters.status} onChange={setFilter('status')} placeholder="All statuses" options={ALERT_STATUSES} />
          </Field>
          <Field label="Type" className="w-full sm:w-44">
            <Select value={filters.type} onChange={setFilter('type')} placeholder="All types" options={ALERT_TYPES} />
          </Field>
          <Field label="Severity" className="w-full sm:w-40">
            <Select value={filters.severity} onChange={setFilter('severity')} placeholder="All severities" options={ALERT_SEVERITIES} />
          </Field>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No alerts match these filters" />
        <Pager data={data} onPage={setPage} />
      </Card>
      {resolving ? (
        <ResolveModal alert={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); reload(); }} />
      ) : null}
    </PageShell>
  );
};

export default EvAlerts;
