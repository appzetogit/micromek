import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlarmClock, Plus, UserPlus } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, Notice, PageShell, Pager, Select, StatusBadge, Textarea, Toolbar,
  dateOnly, dateTime, errorMessage, inr, useAction, useApi, useDebounced,
} from '../platform/kit';
import { bulkAssignLeads, createLead, getAssignees, listLeads } from '../../services/leadsApi';
import { LEAD_SORTS, LEAD_SOURCES, LEAD_STATUSES, LEAD_TYPES, dayEndIso, dayStartIso, isSuperadmin, leadName, localToIso } from './leadsShared';

const EMPTY_FILTERS = { status: '', source: '', type: '', assigned_to: '', tags: '', from: '', to: '', search: '', overdue: false, sort: 'newest' };
const EMPTY_LEAD = { name: '', phone: '', email: '', type: 'enquiry', source: 'manual', requirement: '', value: '', tags: '', assigned_to: '', follow_up_at: '', follow_up_note: '' };

const NewLeadModal = ({ open, onClose, assignees }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_LEAD);
  const [duplicate, setDuplicate] = useState(null);
  const superadmin = isSuperadmin();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const close = () => {
    setForm(EMPTY_LEAD);
    setDuplicate(null);
    onClose();
  };

  const [save, saving] = useAction(
    (allowDuplicate) => createLead({
      ...form,
      value: form.value === '' ? undefined : Number(form.value),
      assigned_to: form.assigned_to || undefined,
      follow_up_at: localToIso(form.follow_up_at) || undefined,
      follow_up_note: form.follow_up_note || undefined,
      allow_duplicate: allowDuplicate === true || undefined,
    }),
    {
      onSuccess: (body) => {
        toast.success('Lead created');
        const id = body?.data?._id;
        close();
        if (id) navigate(`/admin/leads/${id}`);
      },
      onError: (err) => {
        if (err?.status === 409 && err?.details?.code === 'LEAD_EXISTS') setDuplicate({ id: err.details.lead_id, message: err.message });
        else toast.error(errorMessage(err));
      },
    },
  );

  return (
    <Modal
      open={open}
      title="New lead"
      onClose={close}
      wide
      footer={(
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          {duplicate ? <Button variant="danger" busy={saving} onClick={() => save(true)}>Create duplicate anyway</Button> : null}
          <Button busy={saving} onClick={() => save(false)} disabled={!form.name && !form.phone && !form.email}>Create lead</Button>
        </>
      )}
    >
      {duplicate ? (
        <Notice>
          {duplicate.message}.{' '}
          {duplicate.id ? <Link to={`/admin/leads/${duplicate.id}`} className="font-semibold underline" onClick={close}>Open the existing lead</Link> : null}
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => { set('phone')(e); setDuplicate(null); }} placeholder="10-digit or with country code" /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Value (₹)"><Input type="number" min="0" value={form.value} onChange={set('value')} /></Field>
        <Field label="Type"><Select value={form.type} onChange={set('type')} options={LEAD_TYPES} /></Field>
        <Field label="Source"><Select value={form.source} onChange={set('source')} options={LEAD_SOURCES} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={set('tags')} /></Field>
        {superadmin ? (
          <Field label="Assign to" hint="Leave empty to auto-assign">
            <Select value={form.assigned_to} onChange={set('assigned_to')} placeholder="Auto-assign" options={(assignees || []).map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
        ) : null}
        <Field label="Requirement" className="md:col-span-2"><Textarea value={form.requirement} onChange={set('requirement')} /></Field>
        <Field label="First follow-up (optional)"><Input type="datetime-local" value={form.follow_up_at} onChange={set('follow_up_at')} /></Field>
        <Field label="Follow-up note"><Input value={form.follow_up_note} onChange={set('follow_up_note')} disabled={!form.follow_up_at} /></Field>
      </div>
    </Modal>
  );
};

const LeadsList = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [bulkAdmin, setBulkAdmin] = useState('');
  const [creating, setCreating] = useState(false);
  const search = useDebounced(filters.search);
  const tags = useDebounced(filters.tags);

  const assignees = useApi(() => getAssignees(), []);
  const leads = useApi(
    () => listLeads({
      page,
      limit: 20,
      status: filters.status,
      source: filters.source,
      type: filters.type,
      assigned_to: filters.assigned_to,
      tags,
      from: dayStartIso(filters.from),
      to: dayEndIso(filters.to),
      search,
      overdue: filters.overdue ? 'true' : '',
      sort: filters.sort,
    }),
    [page, filters.status, filters.source, filters.type, filters.assigned_to, tags, filters.from, filters.to, search, filters.overdue, filters.sort],
  );

  const setFilter = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
    setSelected([]);
  };

  const [bulkAssign, assigning] = useAction(() => bulkAssignLeads(selected, bulkAdmin), {
    onSuccess: (body) => {
      toast.success(`Assigned ${body?.data?.updated ?? selected.length} lead(s)`);
      setSelected([]);
      leads.reload();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rows = leads.data?.items || [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r._id));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => setSelected(allChecked ? [] : rows.map((r) => r._id));
  const overdue = (lead) => lead.next_follow_up_at && new Date(lead.next_follow_up_at) < new Date() && ['new', 'contacted', 'qualified'].includes(lead.status);

  const columns = [
    {
      key: 'select',
      label: <input type="checkbox" aria-label="Select all" checked={allChecked} onChange={toggleAll} />,
      render: (r) => (
        <input type="checkbox" aria-label="Select lead" checked={selected.includes(r._id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r._id)} />
      ),
    },
    {
      key: 'name',
      label: 'Name',
      render: (r) => (
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate max-w-[14rem]">{leadName(r)}</p>
          {r.tags?.length ? <p className="text-[11px] text-gray-400 truncate max-w-[14rem]">{r.tags.join(', ')}</p> : null}
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—', className: 'whitespace-nowrap' },
    { key: 'source', label: 'Source', render: (r) => <span className="capitalize">{String(r.source || '—').replace(/_/g, ' ')}</span> },
    { key: 'type', label: 'Type', render: (r) => <span className="capitalize">{r.type}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'assigned_to', label: 'Assignee', render: (r) => r.assigned_to?.name || <span className="text-gray-400">Unassigned</span> },
    { key: 'value', label: 'Value', align: 'right', render: (r) => (r.value ? inr(r.value) : '—') },
    {
      key: 'next_follow_up_at',
      label: 'Next follow-up',
      className: 'whitespace-nowrap',
      render: (r) => (r.next_follow_up_at ? (
        <span className={overdue(r) ? 'text-red-600 font-medium' : ''}>{dateTime(r.next_follow_up_at)}</span>
      ) : '—'),
    },
    { key: 'createdAt', label: 'Created', className: 'whitespace-nowrap', render: (r) => dateOnly(r.createdAt) },
  ];

  const assigneeOptions = (assignees.data || []).map((a) => ({ value: a.id, label: a.name }));

  return (
    <PageShell
      module="Leads"
      page="All leads"
      title="Leads"
      right={<Button icon={Plus} onClick={() => setCreating(true)}>New lead</Button>}
    >
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Search" className="w-full sm:w-56">
            <Input value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Name, phone, email, order…" />
          </Field>
          <Field label="Status" className="w-36"><Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} placeholder="All" options={LEAD_STATUSES} /></Field>
          <Field label="Source" className="w-36"><Select value={filters.source} onChange={(e) => setFilter('source', e.target.value)} placeholder="All" options={LEAD_SOURCES} /></Field>
          <Field label="Type" className="w-36"><Select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} placeholder="All" options={LEAD_TYPES} /></Field>
          <Field label="Assigned to" className="w-44">
            <Select
              value={filters.assigned_to}
              onChange={(e) => setFilter('assigned_to', e.target.value)}
              placeholder="Anyone"
              options={[{ value: 'me', label: 'Me' }, { value: 'unassigned', label: 'Unassigned' }, ...assigneeOptions]}
            />
          </Field>
          <Field label="Tags" className="w-36"><Input value={filters.tags} onChange={(e) => setFilter('tags', e.target.value)} placeholder="tag1, tag2" /></Field>
          <Field label="Created from" className="w-40"><Input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} /></Field>
          <Field label="Created to" className="w-40"><Input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} /></Field>
          <Field label="Sort" className="w-44"><Select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)} options={LEAD_SORTS} /></Field>
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-2 cursor-pointer">
            <input type="checkbox" checked={filters.overdue} onChange={(e) => setFilter('overdue', e.target.checked)} />
            <AlarmClock size={14} className="text-red-500" /> Overdue follow-up
          </label>
          <Button variant="secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); setSelected([]); }}>Reset</Button>
        </Toolbar>

        {selected.length ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-indigo-50/60 border-b border-indigo-100 text-sm">
            <span className="font-medium text-indigo-700">{selected.length} selected</span>
            <div className="w-52">
              <Select value={bulkAdmin} onChange={(e) => setBulkAdmin(e.target.value)} placeholder="Assign to…" options={assigneeOptions} />
            </div>
            <Button icon={UserPlus} busy={assigning} disabled={!bulkAdmin} onClick={() => bulkAssign()}>Assign</Button>
            <Button variant="secondary" onClick={() => setSelected([])}>Clear</Button>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          rows={rows}
          loading={leads.loading}
          error={leads.error}
          empty="No leads match these filters"
          onRowClick={(r) => navigate(`/admin/leads/${r._id}`)}
        />
        <Pager data={leads.data} onPage={(p) => { setPage(p); setSelected([]); }} />
      </Card>

      <NewLeadModal open={creating} onClose={() => setCreating(false)} assignees={assignees.data} />
    </PageShell>
  );
};

export default LeadsList;
