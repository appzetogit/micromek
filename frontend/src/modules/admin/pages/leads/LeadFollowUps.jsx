import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Modal, PageShell, Pager, StatusBadge, Tabs, Textarea, dateTime, errorMessage, useAction, useApi,
} from '../platform/kit';
import { completeFollowUp, listFollowUps } from '../../services/leadsApi';
import { leadName } from './leadsShared';

const TABS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'done', label: 'Done' },
];

const CompleteModal = ({ followUp, onClose, onSaved }) => {
  const [outcome, setOutcome] = useState('');
  const [save, saving] = useAction(() => completeFollowUp(followUp.lead._id, followUp._id, outcome), {
    onSuccess: () => { toast.success('Follow-up completed'); onSaved(); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal
      open
      title={`Complete follow-up · ${leadName(followUp.lead)}`}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" busy={saving} onClick={() => save()}>Mark done</Button></>}
    >
      <p className="text-sm text-gray-600">{followUp.note || 'No note'} · due {dateTime(followUp.due_at)}</p>
      <Field label="Outcome"><Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened?" /></Field>
    </Modal>
  );
};

const LeadFollowUps = () => {
  const [tab, setTab] = useState('overdue');
  const [page, setPage] = useState(1);
  const [completing, setCompleting] = useState(null);
  const done = tab === 'done';
  const { data, loading, error, reload } = useApi(
    () => listFollowUps(done ? { status: 'done', page } : { due: tab, status: 'pending', page }),
    [tab, page],
  );

  const columns = [
    {
      key: 'lead',
      label: 'Lead',
      render: (r) => (r.lead ? (
        <div>
          <Link to={`/admin/leads/${r.lead._id}`} className="font-medium text-indigo-600 hover:underline">{leadName(r.lead)}</Link>
          <div className="flex items-center gap-2 mt-0.5">
            {r.lead.phone ? <span className="text-[11px] text-gray-400">{r.lead.phone}</span> : null}
            <StatusBadge status={r.lead.status} />
          </div>
        </div>
      ) : <span className="text-gray-400">Deleted lead</span>),
    },
    {
      key: 'due_at',
      label: 'Due',
      className: 'whitespace-nowrap',
      render: (r) => <span className={tab === 'overdue' ? 'text-red-600 font-medium' : ''}>{dateTime(r.due_at)}</span>,
    },
    { key: 'channel', label: 'Channel', render: (r) => <span className="capitalize">{r.channel}</span> },
    {
      key: 'note',
      label: done ? 'Note / outcome' : 'Note',
      render: (r) => (
        <div className="max-w-xs">
          <p className="truncate">{r.note || '—'}</p>
          {done && r.outcome ? <p className="text-[11px] text-emerald-700 truncate">{r.outcome}</p> : null}
        </div>
      ),
    },
    { key: 'assigned_to', label: 'Assignee', render: (r) => r.assigned_to?.name || '—' },
    done
      ? { key: 'done_at', label: 'Completed', className: 'whitespace-nowrap', render: (r) => dateTime(r.done_at) }
      : {
        key: 'actions',
        label: '',
        align: 'right',
        render: (r) => (r.lead ? <Button variant="success" icon={CheckCircle2} onClick={() => setCompleting(r)}>Done</Button> : null),
      },
  ];

  return (
    <PageShell module="Leads" page="Follow-ups" title="Follow-ups">
      <Tabs tabs={TABS} value={tab} onChange={(t) => { setTab(t); setPage(1); }} />
      <Card bodyClassName="">
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          error={error}
          empty={done ? 'No completed follow-ups' : `No ${tab} follow-ups`}
        />
        <Pager data={data} onPage={setPage} />
      </Card>
      {completing ? <CompleteModal followUp={completing} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); reload(); }} /> : null}
    </PageShell>
  );
};

export default LeadFollowUps;
