import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Ban, CheckCircle2, Eye, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, KeyValue, Modal, Notice, PageShell, Pager, Select, StatusBadge, Textarea, Toolbar,
  dateTime, errorMessage, num, useAction, useApi,
} from '../platform/kit';
import {
  broadcastAction, createBroadcast, deleteBroadcast, getBroadcast, listBroadcasts, listTemplates, updateBroadcast,
} from '../../services/leadsApi';
import TemplatePicker from './TemplatePicker';
import {
  LEAD_SOURCES, LEAD_STATUSES, LEAD_TYPES, bodyComponents, dayEndIso, dayStartIso, isSuperadmin, isoToLocal, localToIso, paramsFromComponents,
} from './leadsShared';

const BROADCAST_STATUSES = ['draft', 'scheduled', 'running', 'done', 'cancelled'];
const RECIPIENT_STATUSES = ['pending', 'sent', 'failed', 'skipped'];
const toastError = (err) => toast.error(errorMessage(err));

const toDay = (d) => (d ? isoToLocal(d).slice(0, 10) : '');

const formFrom = (b) => ({
  name: b?.name || '',
  template: { name: b?.template?.name || '', language: b?.template?.language || '', params: paramsFromComponents(b?.template?.components) },
  audienceType: b?.audience?.type || 'phones',
  phones: (b?.audience?.phones || []).join('\n'),
  filter: {
    status: b?.audience?.lead_filter?.status || [],
    source: b?.audience?.lead_filter?.source || [],
    type: b?.audience?.lead_filter?.type || [],
    tags: (b?.audience?.lead_filter?.tags || []).join(', '),
    created_from: toDay(b?.audience?.lead_filter?.created_from),
    created_to: toDay(b?.audience?.lead_filter?.created_to),
  },
  scheduled_at: isoToLocal(b?.scheduled_at),
});

const Chips = ({ options, value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((o) => {
      const on = value.includes(o);
      return (
        <button
          key={o}
          type="button"
          onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
          className={`px-2.5 py-1 rounded-full border text-xs capitalize ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          {o.replace(/_/g, ' ')}
        </button>
      );
    })}
  </div>
);

const BroadcastForm = ({ broadcast, templates, onClose, onSaved }) => {
  const [form, setForm] = useState(() => formFrom(broadcast));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, filter: { ...f.filter, [k]: v } }));

  const payload = () => ({
    name: form.name,
    template: { name: form.template.name, language: form.template.language, components: bodyComponents(form.template.params) },
    audience: form.audienceType === 'phones'
      ? { type: 'phones', phones: form.phones.split(/[\s,;]+/).filter(Boolean) }
      : {
        type: 'lead_filter',
        lead_filter: {
          status: form.filter.status,
          source: form.filter.source,
          type: form.filter.type,
          tags: form.filter.tags,
          created_from: dayStartIso(form.filter.created_from) || null,
          created_to: dayEndIso(form.filter.created_to) || null,
        },
      },
    scheduled_at: localToIso(form.scheduled_at),
  });

  const [save, saving] = useAction(() => (broadcast ? updateBroadcast(broadcast._id, payload()) : createBroadcast(payload())), {
    onSuccess: () => { toast.success(broadcast ? 'Broadcast updated (back to draft)' : 'Broadcast created as draft'); onSaved(); },
    onError: toastError,
  });

  const phoneCount = form.phones.split(/[\s,;]+/).filter(Boolean).length;
  const valid = form.name.trim() && form.template.name && (form.audienceType === 'lead_filter' || phoneCount > 0);

  return (
    <Modal
      open
      wide
      title={broadcast ? 'Edit broadcast' : 'New broadcast'}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={saving} disabled={!valid} onClick={() => save()}>Save draft</Button></>}
    >
      {broadcast ? <Notice>Saving changes sends the broadcast back to draft; a super admin must approve it again.</Notice> : null}
      <Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <TemplatePicker
        templates={templates}
        value={form.template}
        onChange={(t) => set('template', t)}
        paramHint="Write {{name}} inside a parameter to insert each recipient's name."
      />
      <div>
        <span className="block text-xs font-semibold text-gray-500 mb-1.5">Audience</span>
        <div className="flex gap-4 text-sm text-gray-700 mb-3">
          {[['phones', 'Phone numbers'], ['lead_filter', 'Leads matching a filter']].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="audience" checked={form.audienceType === v} onChange={() => set('audienceType', v)} /> {l}
            </label>
          ))}
        </div>
        {form.audienceType === 'phones' ? (
          <Field label={`Phones (${phoneCount})`} hint="One per line or comma separated. Opted-out contacts are skipped.">
            <Textarea rows={5} value={form.phones} onChange={(e) => set('phones', e.target.value)} />
          </Field>
        ) : (
          <div className="space-y-3 rounded-lg border border-gray-100 p-3">
            <div><span className="block text-xs text-gray-500 mb-1">Status</span><Chips options={LEAD_STATUSES} value={form.filter.status} onChange={(v) => setFilter('status', v)} /></div>
            <div><span className="block text-xs text-gray-500 mb-1">Source</span><Chips options={LEAD_SOURCES} value={form.filter.source} onChange={(v) => setFilter('source', v)} /></div>
            <div><span className="block text-xs text-gray-500 mb-1">Type</span><Chips options={LEAD_TYPES} value={form.filter.type} onChange={(v) => setFilter('type', v)} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Tags"><Input value={form.filter.tags} onChange={(e) => setFilter('tags', e.target.value)} placeholder="tag1, tag2" /></Field>
              <Field label="Created from"><Input type="date" value={form.filter.created_from} onChange={(e) => setFilter('created_from', e.target.value)} /></Field>
              <Field label="Created to"><Input type="date" value={form.filter.created_to} onChange={(e) => setFilter('created_to', e.target.value)} /></Field>
            </div>
            <p className="text-[11px] text-gray-400">Empty groups match everything. Leads without a phone are ignored.</p>
          </div>
        )}
      </div>
      <Field label="Schedule (optional)" hint="Leave empty to start it manually with Run after approval.">
        <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} />
      </Field>
    </Modal>
  );
};

const BroadcastDetail = ({ id, onClose }) => {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, loading, error } = useApi(() => getBroadcast(id, { recipients_page: page, recipients_status: status }), [id, page, status]);
  const pages = Math.ceil((data?.recipients_total || 0) / 100);
  const t = data?.totals || {};
  return (
    <Modal open wide title={data?.name || 'Broadcast'} onClose={onClose}>
      {error ? <Notice tone="red">{error}</Notice> : null}
      {data ? (
        <>
          <KeyValue
            items={[
              ['Status', <StatusBadge key="s" status={data.status} />],
              ['Template', `${data.template?.name} (${data.template?.language})`],
              ['Audience', data.audience?.type === 'phones' ? `${num(data.audience.phones?.length)} phones` : 'Lead filter'],
              ['Scheduled', data.scheduled_at ? dateTime(data.scheduled_at) : 'Manual'],
              ['Created', `${dateTime(data.createdAt)}${data.created_by?.name ? ` by ${data.created_by.name}` : ''}`],
              ['Approved', data.approved_at ? `${dateTime(data.approved_at)}${data.approved_by?.name ? ` by ${data.approved_by.name}` : ''}` : 'Not yet'],
              ['Started / finished', `${dateTime(data.started_at)} / ${dateTime(data.finished_at)}`],
              ['Totals', `${num(t.recipients)} recipients · ${num(t.sent)} sent · ${num(t.failed)} failed · ${num(t.skipped)} skipped`],
              data.last_error ? ['Last error', <span key="e" className="text-red-600">{data.last_error}</span>] : null,
            ]}
          />
          <div className="flex items-end justify-between gap-3 pt-2">
            <h4 className="text-sm font-semibold text-gray-900">Recipients ({num(data.recipients_total)})</h4>
            <div className="w-40">
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={RECIPIENT_STATUSES} />
            </div>
          </div>
          <div className="border border-gray-100 rounded-lg">
            <DataTable
              rowKey={(r) => r.phone}
              columns={[
                { key: 'phone', label: 'Phone' },
                { key: 'name', label: 'Name', render: (r) => r.name || '—' },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} tone={r.status === 'skipped' ? 'gray' : undefined} /> },
                { key: 'error', label: 'Error', render: (r) => (r.error ? <span className="text-xs text-red-600">{r.error}</span> : '—') },
                { key: 'at', label: 'At', className: 'whitespace-nowrap', render: (r) => dateTime(r.at) },
              ]}
              rows={data.recipients || []}
              loading={loading}
              empty={data.status === 'draft' || data.status === 'scheduled' ? 'Recipients are resolved when the broadcast starts' : 'No recipients'}
            />
            <Pager data={{ page, pages, total: data.recipients_total }} onPage={setPage} />
          </div>
        </>
      ) : loading ? <p className="text-sm text-gray-400">Loading…</p> : null}
    </Modal>
  );
};

const WhatsAppBroadcasts = () => {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // {} for new, broadcast for edit
  const [viewing, setViewing] = useState(null);
  const superadmin = isSuperadmin();
  const { data, loading, error, reload } = useApi(() => listBroadcasts({ status, page }), [status, page]);
  const templates = useApi(() => listTemplates({ status: 'APPROVED' }), []);

  const [act, acting] = useAction(
    async (b, action) => {
      if (action === 'delete') return deleteBroadcast(b._id);
      return broadcastAction(b._id, action);
    },
    {
      onSuccess: () => { toast.success('Done'); reload(); },
      onError: toastError,
    },
  );
  const confirmAct = (b, action, message) => { if (window.confirm(message)) act(b, action); };

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: 'template', label: 'Template', render: (r) => <span className="text-xs">{r.template?.name} <span className="text-gray-400">({r.template?.language})</span></span> },
    {
      key: 'audience',
      label: 'Audience',
      render: (r) => (
        <span className="whitespace-nowrap">
          {r.totals?.recipients ? num(r.totals.recipients) : r.audience?.type === 'phones' ? num(r.audience.phones?.length) : '—'}
          <span className="text-[11px] text-gray-400 ml-1">{r.audience?.type === 'phones' ? 'phones' : 'lead filter'}</span>
        </span>
      ),
    },
    { key: 'scheduled_at', label: 'Schedule', className: 'whitespace-nowrap', render: (r) => (r.scheduled_at ? dateTime(r.scheduled_at) : 'Manual') },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <div>
          <StatusBadge status={r.status} />
          {r.status === 'draft' ? <p className="text-[11px] text-gray-400 mt-0.5">{r.approved_at ? 'Approved' : 'Awaiting approval'}</p> : null}
        </div>
      ),
    },
    {
      key: 'totals',
      label: 'Sent / failed / skipped',
      className: 'whitespace-nowrap',
      render: (r) => (
        <span>
          <span className="text-emerald-700">{num(r.totals?.sent)}</span> / <span className="text-red-600">{num(r.totals?.failed)}</span> / <span className="text-gray-500">{num(r.totals?.skipped)}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => {
        const editable = ['draft', 'scheduled'].includes(r.status);
        return (
          <div className="flex justify-end flex-wrap gap-1.5">
            <Button variant="secondary" icon={Eye} aria-label="View" onClick={() => setViewing(r._id)} />
            {editable ? <Button variant="secondary" icon={Pencil} aria-label="Edit" onClick={() => setEditing(r)} /> : null}
            {r.status === 'draft' && !r.approved_at && superadmin ? (
              <Button variant="success" icon={CheckCircle2} disabled={acting} onClick={() => act(r, 'approve')}>Approve</Button>
            ) : null}
            {editable && r.approved_at ? (
              <Button icon={Play} disabled={acting} onClick={() => confirmAct(r, 'run', `Start sending "${r.name}" now?`)}>Run</Button>
            ) : null}
            {['scheduled', 'running'].includes(r.status) ? (
              <Button variant="danger" icon={Ban} disabled={acting} onClick={() => confirmAct(r, 'cancel', `Cancel "${r.name}"? Messages already sent are not recalled.`)}>Cancel</Button>
            ) : null}
            {r.status === 'draft' ? (
              <Button variant="danger" icon={Trash2} aria-label="Delete" disabled={acting} onClick={() => confirmAct(r, 'delete', `Delete the draft "${r.name}"? This cannot be undone.`)} />
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <PageShell
      module="WhatsApp"
      page="Broadcasts"
      title="Broadcasts"
      right={<Button icon={Plus} onClick={() => setEditing({})}>New broadcast</Button>}
    >
      {templates.data && !templates.data.items?.length ? (
        <Notice>No approved templates are synced yet. Sync them on the Templates page before creating a broadcast.</Notice>
      ) : null}
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Status" className="w-44">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All" options={BROADCAST_STATUSES} />
          </Field>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No broadcasts yet" />
        <Pager data={data} onPage={setPage} />
      </Card>

      {editing ? (
        <BroadcastForm
          broadcast={editing._id ? editing : null}
          templates={templates.data?.items || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
      {viewing ? <BroadcastDetail id={viewing} onClose={() => setViewing(null)} /> : null}
    </PageShell>
  );
};

export default WhatsAppBroadcasts;
