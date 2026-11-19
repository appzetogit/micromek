import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CalendarClock, CheckCircle2, History, MessageCircle, Pencil, ShoppingBag, Trash2, UserCheck, UserRound,
} from 'lucide-react';
import {
  Button, Card, Field, Input, KeyValue, Modal, Notice, PageShell, Select, StatusBadge, Textarea,
  dateTime, errorMessage, inr, timeAgo, useAction, useApi,
} from '../platform/kit';
import {
  addFollowUp, addLeadActivity, assignLead, changeLeadStatus, completeFollowUp, deleteFollowUp, getAssignees, getLead, updateLead,
} from '../../services/leadsApi';
import {
  ACTIVITY_TYPES, FOLLOW_UP_CHANNELS, LEAD_TRANSITIONS, LEAD_TYPES, OPEN_LEAD_STATUSES, contactName, isSuperadmin, leadName, localToIso,
} from './leadsShared';

const toastError = (err) => toast.error(errorMessage(err));

// ---------- edit ----------

const EditLeadModal = ({ lead, onClose, onSaved }) => {
  const [form, setForm] = useState({
    name: lead.name || '',
    phone: lead.phone || '',
    email: lead.email || '',
    city: lead.city || '',
    type: lead.type || 'enquiry',
    requirement: lead.requirement || '',
    notes: lead.notes || '',
    value: lead.value ?? 0,
    tags: (lead.tags || []).join(', '),
    store_id: lead.store_id || '',
    franchise_id: lead.franchise_id || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [save, saving] = useAction(
    () => updateLead(lead._id, { ...form, value: Number(form.value) || 0, store_id: form.store_id || null, franchise_id: form.franchise_id || null }),
    { onSuccess: () => { toast.success('Lead updated'); onSaved(); }, onError: toastError },
  );
  return (
    <Modal
      open
      wide
      title="Edit lead"
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={saving} onClick={() => save()}>Save</Button></>}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="City"><Input value={form.city} onChange={set('city')} /></Field>
        <Field label="Type"><Select value={form.type} onChange={set('type')} options={LEAD_TYPES} /></Field>
        <Field label="Value (₹)"><Input type="number" min="0" value={form.value} onChange={set('value')} /></Field>
        <Field label="Tags" hint="Comma separated" className="md:col-span-2"><Input value={form.tags} onChange={set('tags')} /></Field>
        <Field label="Requirement" className="md:col-span-2"><Textarea value={form.requirement} onChange={set('requirement')} /></Field>
        <Field label="Notes" className="md:col-span-2"><Textarea value={form.notes} onChange={set('notes')} /></Field>
        <Field label="Store ID (optional)"><Input value={form.store_id} onChange={set('store_id')} placeholder="Commerce store id" /></Field>
        <Field label="Franchise ID (optional)"><Input value={form.franchise_id} onChange={set('franchise_id')} placeholder="Franchise id" /></Field>
      </div>
    </Modal>
  );
};

// ---------- status ----------

const StatusModal = ({ lead, status, onClose, onSaved }) => {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const lost = status === 'lost';
  const [save, saving] = useAction(() => changeLeadStatus(lead._id, { status, reason: lost ? reason : undefined, note: note || undefined }), {
    onSuccess: () => { toast.success(`Marked ${status}`); onSaved(); },
    onError: toastError,
  });
  return (
    <Modal
      open
      title={`Change status to ${status}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={lost ? 'danger' : 'primary'} busy={saving} disabled={lost && !reason.trim()} onClick={() => save()}>Change status</Button>
        </>
      )}
    >
      {status === 'won' ? <Notice tone="green">Won is final: the lead cannot be moved to another status afterwards.</Notice> : null}
      {lost ? <Field label="Reason lost *"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price too high" /></Field> : null}
      <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
};

// ---------- follow-ups ----------

const CompleteFollowUpModal = ({ leadId, followUp, onClose, onSaved }) => {
  const [outcome, setOutcome] = useState('');
  const [save, saving] = useAction(() => completeFollowUp(leadId, followUp._id, outcome), {
    onSuccess: () => { toast.success('Follow-up completed'); onSaved(); },
    onError: toastError,
  });
  return (
    <Modal
      open
      title="Complete follow-up"
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" busy={saving} onClick={() => save()}>Mark done</Button></>}
    >
      <p className="text-sm text-gray-600">{followUp.note || 'No note'} · due {dateTime(followUp.due_at)}</p>
      <Field label="Outcome"><Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened?" /></Field>
    </Modal>
  );
};

const FollowUpsCard = ({ lead, followUps, assignees, onChanged }) => {
  const [form, setForm] = useState({ due_at: '', channel: 'call', note: '', assigned_to: '' });
  const [completing, setCompleting] = useState(null);
  const open = OPEN_LEAD_STATUSES.includes(lead.status);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [add, adding] = useAction(
    () => addFollowUp(lead._id, { ...form, due_at: localToIso(form.due_at), assigned_to: form.assigned_to || undefined }),
    {
      onSuccess: () => { toast.success('Follow-up added'); setForm({ due_at: '', channel: 'call', note: '', assigned_to: '' }); onChanged(); },
      onError: toastError,
    },
  );
  const [remove] = useAction((f) => deleteFollowUp(lead._id, f._id), {
    onSuccess: () => { toast.success('Follow-up removed'); onChanged(); },
    onError: toastError,
  });

  return (
    <Card title="Follow-ups" icon={CalendarClock} subtitle={lead.next_follow_up_at ? `Next ${dateTime(lead.next_follow_up_at)}` : 'Nothing scheduled'}>
      {open ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4 mb-4 border-b border-gray-100">
          <Field label="Due"><Input type="datetime-local" value={form.due_at} onChange={set('due_at')} /></Field>
          <Field label="Channel"><Select value={form.channel} onChange={set('channel')} options={FOLLOW_UP_CHANNELS} /></Field>
          <Field label="Assign to">
            <Select value={form.assigned_to} onChange={set('assigned_to')} placeholder="Lead owner" options={(assignees || []).map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
          <Field label="Note"><Input value={form.note} onChange={set('note')} /></Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button icon={CalendarClock} busy={adding} disabled={!form.due_at} onClick={() => add()}>Add follow-up</Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400 mb-3">Follow-ups can only be added to open leads.</p>
      )}
      {followUps.length === 0 ? <p className="text-sm text-gray-400">No follow-ups yet.</p> : null}
      <ul className="divide-y divide-gray-100">
        {followUps.map((f) => {
          const pending = f.status === 'pending';
          const late = pending && f.overdue;
          return (
            <li key={f._id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`font-medium ${late ? 'text-red-600' : 'text-gray-900'}`}>{dateTime(f.due_at)}</span>
                  <StatusBadge status={late ? 'overdue' : f.status} tone={late ? 'red' : undefined} />
                  <span className="text-xs text-gray-400 capitalize">{f.channel}</span>
                  {f.assigned_to?.name ? <span className="text-xs text-gray-400">· {f.assigned_to.name}</span> : null}
                </div>
                {f.note ? <p className="text-xs text-gray-600 mt-0.5">{f.note}</p> : null}
                {f.outcome ? <p className="text-xs text-emerald-700 mt-0.5">Outcome: {f.outcome}</p> : null}
              </div>
              {pending ? (
                <div className="flex gap-2 shrink-0">
                  <Button variant="success" icon={CheckCircle2} onClick={() => setCompleting(f)}>Done</Button>
                  <Button
                    variant="danger"
                    icon={Trash2}
                    aria-label="Delete follow-up"
                    onClick={() => window.confirm('Delete this follow-up?') && remove(f)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {completing ? (
        <CompleteFollowUpModal leadId={lead._id} followUp={completing} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); onChanged(); }} />
      ) : null}
    </Card>
  );
};

// ---------- timeline ----------

const TimelineCard = ({ lead, onChanged }) => {
  const [type, setType] = useState('note');
  const [note, setNote] = useState('');
  const [add, adding] = useAction(() => addLeadActivity(lead._id, { type, note }), {
    onSuccess: () => { toast.success('Activity added'); setNote(''); onChanged(); },
    onError: toastError,
  });
  const items = [...(lead.timeline || [])].reverse();
  return (
    <Card title="Activity" icon={History}>
      <div className="flex flex-col sm:flex-row gap-3 pb-4 mb-4 border-b border-gray-100">
        <div className="sm:w-36"><Select value={type} onChange={(e) => setType(e.target.value)} options={ACTIVITY_TYPES} /></div>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'note' ? 'Add a note…' : `What happened on the ${type}?`} />
        <Button busy={adding} disabled={!note.trim()} onClick={() => add()} className="sm:self-start">Add</Button>
      </div>
      {items.length === 0 ? <p className="text-sm text-gray-400">No activity yet.</p> : null}
      <ol className="space-y-4">
        {items.map((a) => (
          <li key={a._id} className="flex gap-3">
            <span className="mt-1.5 w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <span className="font-semibold text-gray-700 capitalize">{a.type.replace(/_/g, ' ')}</span>
                <span title={dateTime(a.at)}>{timeAgo(a.at)}</span>
                {a.by?.name ? <span>· {a.by.name}</span> : null}
              </div>
              {a.note ? <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{a.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
};

// ---------- side cards ----------

const AssignCard = ({ lead, assignees, onChanged }) => {
  const current = lead.assigned_to?._id || '';
  const [adminId, setAdminId] = useState(current);
  const [save, saving] = useAction(() => assignLead(lead._id, adminId || null), {
    onSuccess: () => { toast.success(adminId ? 'Lead assigned' : 'Lead unassigned'); onChanged(); },
    onError: toastError,
  });
  return (
    <Card title="Assignee" icon={UserCheck} subtitle={lead.assigned_to?.name || 'Unassigned'}>
      <div className="flex gap-2">
        <Select
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          placeholder={isSuperadmin() ? 'Unassigned' : undefined}
          options={(assignees || []).map((a) => ({ value: a.id, label: a.name }))}
        />
        <Button busy={saving} disabled={adminId === current} onClick={() => save()}>Save</Button>
      </div>
      {lead.assigned_at ? <p className="mt-2 text-[11px] text-gray-400">Since {dateTime(lead.assigned_at)}{lead.auto_assigned ? ' (auto)' : ''}</p> : null}
    </Card>
  );
};

const WhatsAppCard = ({ lead, messages }) => {
  const contact = lead.contact;
  const inboxLink = lead.conversation
    ? `/admin/whatsapp/inbox?conversation=${lead.conversation}`
    : contact ? `/admin/whatsapp/inbox?search=${encodeURIComponent(contact.wa_id)}` : null;
  return (
    <Card
      title="WhatsApp"
      icon={MessageCircle}
      subtitle={contact ? contactName(contact) : 'No WhatsApp contact'}
      right={inboxLink ? <Link to={inboxLink} className="text-xs font-semibold text-indigo-600 hover:underline">Open chat</Link> : null}
    >
      {contact ? (
        <>
          <KeyValue
            items={[
              ['Opt-in', <StatusBadge key="o" status={contact.opt_in?.status || 'unknown'} />],
              ['Last inbound', contact.last_inbound_at ? timeAgo(contact.last_inbound_at) : '—'],
            ]}
          />
          {messages.length ? (
            <ul className="mt-4 space-y-2 max-h-64 overflow-y-auto">
              {messages.slice(-6).map((m) => (
                <li key={m._id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                  <span className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-xs ${m.direction === 'out' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                    {m.body || (m.template?.name ? `Template: ${m.template.name}` : `[${m.type}]`)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-gray-400">This lead has not messaged on WhatsApp.</p>
      )}
    </Card>
  );
};

// ---------- page ----------

const LeadDetail = () => {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi(() => getLead(id), [id]);
  const assignees = useApi(() => getAssignees(), []);
  const [editing, setEditing] = useState(false);
  const [nextStatus, setNextStatus] = useState(null);

  const lead = data?.lead;
  const transitions = lead ? LEAD_TRANSITIONS[lead.status] || [] : [];

  return (
    <PageShell
      module="Leads"
      page="Lead"
      title={lead ? leadName(lead) : 'Lead'}
      backTo="/admin/leads"
      right={lead ? <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button> : null}
    >
      {error ? <Notice tone="red">{error}</Notice> : null}
      {loading && !lead ? <p className="text-sm text-gray-400">Loading…</p> : null}
      {lead ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <Card title="Profile" icon={UserRound} right={<StatusBadge status={lead.status} />}>
              <KeyValue
                items={[
                  ['Name', lead.name || '—'],
                  ['Phone', lead.phone || '—'],
                  ['Email', lead.email || '—'],
                  ['City', lead.city || '—'],
                  ['Type', <span key="t" className="capitalize">{lead.type}</span>],
                  ['Source', <span key="s" className="capitalize">{String(lead.source).replace(/_/g, ' ')}</span>],
                  ['Value', inr(lead.value)],
                  ['Tags', lead.tags?.length ? lead.tags.join(', ') : '—'],
                  ['Requirement', lead.requirement || '—'],
                  ['Notes', lead.notes || '—'],
                  lead.store_id ? ['Store', lead.store_id] : null,
                  lead.franchise_id ? ['Franchise', lead.franchise_id] : null,
                  lead.campaign?.campaign_name ? ['Campaign', `${lead.campaign.campaign_name}${lead.campaign.ad_name ? ` · ${lead.campaign.ad_name}` : ''}`] : null,
                  lead.lost_reason ? ['Lost reason', lead.lost_reason] : null,
                  ['Created', `${dateTime(lead.createdAt)}${lead.created_by?.name ? ` by ${lead.created_by.name}` : ''}`],
                  ['First response', lead.first_response_at ? dateTime(lead.first_response_at) : 'Not yet'],
                ]}
              />
            </Card>
            <FollowUpsCard lead={lead} followUps={data.follow_ups || []} assignees={assignees.data} onChanged={reload} />
            <TimelineCard lead={lead} onChanged={reload} />
          </div>

          <div className="space-y-5">
            <Card title="Status" right={<StatusBadge status={lead.status} />}>
              {transitions.length ? (
                <div className="flex flex-wrap gap-2">
                  {transitions.map((s) => (
                    <Button key={s} variant={s === 'lost' ? 'danger' : s === 'won' ? 'success' : 'secondary'} onClick={() => setNextStatus(s)}>
                      <span className="capitalize">Mark {s}</span>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Won leads are final.</p>
              )}
              {lead.status_changed_at ? <p className="mt-3 text-[11px] text-gray-400">Changed {dateTime(lead.status_changed_at)}</p> : null}
            </Card>
            <AssignCard key={lead.assigned_to?._id || 'none'} lead={lead} assignees={assignees.data} onChanged={reload} />
            {lead.order_number || lead.order_id ? (
              <Card title="Linked order" icon={ShoppingBag}>
                {lead.order_id ? (
                  <Link to={`/admin/commerce/orders/${lead.order_id}`} className="text-sm font-semibold text-indigo-600 hover:underline">
                    {lead.order_number || 'View order'}
                  </Link>
                ) : <p className="text-sm text-gray-800">{lead.order_number}</p>}
              </Card>
            ) : null}
            <WhatsAppCard lead={lead} messages={data.recent_messages || []} />
          </div>
        </div>
      ) : null}

      {editing && lead ? <EditLeadModal lead={lead} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} /> : null}
      {nextStatus && lead ? (
        <StatusModal lead={lead} status={nextStatus} onClose={() => setNextStatus(null)} onSaved={() => { setNextStatus(null); reload(); }} />
      ) : null}
    </PageShell>
  );
};

export default LeadDetail;
