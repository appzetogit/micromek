import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle, ArrowLeft, Bot, Check, CheckCheck, Clock, FileText, Info, Loader2, MessageCircle, RotateCcw, Search, Send, UserCheck, X,
} from 'lucide-react';
import {
  Button, Field, Input, Modal, Notice, PageShell, Select, StatusBadge, dateTime, errorMessage, timeAgo, useAction, useApi, useDebounced,
} from '../platform/kit';
import {
  conversationAction, getAssignees, getConversation, getWhatsAppStatus, listConversations, listMessages, listTemplates, sendMessage, updateContact,
} from '../../services/leadsApi';
import TemplatePicker from './TemplatePicker';
import { OPT_IN_STATUSES, bodyComponents, contactName } from './leadsShared';

const THREAD_POLL_MS = 10000;
const LIST_POLL_MS = 20000;
const STATUS_FILTERS = [
  { value: '', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'bot', label: 'Bot' },
  { value: 'human', label: 'Human' },
  { value: 'closed', label: 'Closed' },
];
const toastError = (err) => toast.error(errorMessage(err));

/** Calls fn every ms while mounted. */
const usePoll = (fn, ms) => {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);
  useEffect(() => {
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
};

const previewText = (m) => m?.body || (m?.type ? `[${m.type}]` : '');

// ---------- message ----------

const errorText = (m) => m.error?.message || m.error?.title || m.statuses?.find((s) => s.error)?.error?.message || 'Failed to send';

const Ticks = ({ m }) => {
  if (m.status === 'failed' || m.status === 'skipped') return <AlertCircle size={13} className="text-red-300" />;
  if (m.status === 'read') return <CheckCheck size={13} className="text-sky-300" />;
  if (m.status === 'delivered') return <CheckCheck size={13} className="text-indigo-200" />;
  if (m.status === 'sent') return <Check size={13} className="text-indigo-200" />;
  return <Clock size={12} className="text-indigo-200" />;
};

const MessageBubble = ({ m }) => {
  const out = m.direction === 'out';
  const failed = m.status === 'failed' || m.status === 'skipped';
  const body = m.body || (m.template?.name ? '' : `[${m.type}${m.media?.caption ? `: ${m.media.caption}` : ''}]`);
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[70%] flex flex-col ${out ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-[22px] px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${out
            ? `rounded-br-sm border ${failed ? 'bg-red-50 text-red-800 border-red-200' : 'bg-indigo-600 text-white border-indigo-600'}`
            : 'rounded-bl-sm bg-white text-slate-800 border border-slate-200'}`}
        >
          {m.template?.name ? (
            <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1 ${out && !failed ? 'text-indigo-200' : 'text-slate-400'}`}>
              <FileText size={11} /> Template · {m.template.name}
            </span>
          ) : null}
          {body || (m.template?.name ? <span className="italic opacity-80">Template message</span> : null)}
        </div>
        <div className="flex items-center gap-1.5 mt-1 px-1 text-[10px] text-slate-400">
          {out && m.origin && m.origin !== 'staff' ? <span className="capitalize">{m.origin} ·</span> : null}
          {out && m.sent_by?.name ? <span>{m.sent_by.name} ·</span> : null}
          <span title={dateTime(m.createdAt)}>{new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          {out ? <span className={`inline-flex rounded-full px-1 ${failed ? '' : 'bg-indigo-600'}`}><Ticks m={m} /></span> : null}
        </div>
        {out && failed ? <p className="mt-0.5 px-1 text-[11px] text-red-600">{errorText(m)}</p> : null}
      </div>
    </div>
  );
};

// ---------- composer ----------

const Composer = ({ conversationId, windowOpen, templates, onRefresh }) => {
  const [text, setText] = useState('');
  const [templateMode, setTemplateMode] = useState(false);
  const [template, setTemplate] = useState({ name: '', language: '', params: [] });
  const templateOnly = templateMode || !windowOpen;

  const [send, sending] = useAction(
    () => sendMessage(conversationId, templateOnly
      ? { template: { name: template.name, language: template.language, components: bodyComponents(template.params) } }
      : { text: text.trim() }),
    {
      onSuccess: () => {
        if (templateOnly) setTemplate({ name: '', language: '', params: [] });
        else setText('');
        onRefresh();
      },
      onError: (err) => {
        if (err?.details?.code === 'OUTSIDE_SERVICE_WINDOW') {
          setTemplateMode(true);
          toast.error('The 24-hour window has closed. Send an approved template instead.');
        } else {
          toastError(err);
        }
        onRefresh();
      },
    },
  );

  const canSend = templateOnly
    ? Boolean(template.name) && (template.params || []).every((p) => p.trim())
    : Boolean(text.trim());

  return (
    <div className="shrink-0 border-t border-slate-200/60 bg-white p-3 sm:p-4">
      {templateOnly ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {windowOpen ? 'Sending a template message.' : 'The 24-hour service window is closed. Only approved templates can be sent.'}
            </p>
            {windowOpen ? <button type="button" className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setTemplateMode(false)}>Write a message</button> : null}
          </div>
          <TemplatePicker templates={templates} value={template} onChange={setTemplate} />
          <div className="flex justify-end">
            <Button icon={Send} busy={sending} disabled={!canSend} onClick={() => send()}>Send template</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <button
            type="button"
            title="Send a template"
            onClick={() => setTemplateMode(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 ring-1 ring-slate-200 hover:text-indigo-600"
          >
            <FileText size={16} />
          </button>
          <textarea
            rows={1}
            value={text}
            maxLength={4096}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && canSend && !sending) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message… (Shift+Enter for a new line)"
            className="flex-1 resize-none max-h-32 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="button"
            disabled={!canSend || sending}
            onClick={() => send()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            aria-label="Send"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      )}
    </div>
  );
};

// ---------- contact panel ----------

const ContactPanel = ({ conversation, serviceWindow, onChanged, onClose }) => {
  const contact = conversation.contact || {};
  const [name, setName] = useState(contact.name || '');
  const [saveName, savingName] = useAction(() => updateContact(contact._id, { name }), {
    onSuccess: () => { toast.success('Contact updated'); onChanged(); },
    onError: toastError,
  });
  const [saveOptIn, savingOptIn] = useAction((status) => updateContact(contact._id, { opt_in_status: status }), {
    onSuccess: () => { toast.success('Opt-in updated'); onChanged(); },
    onError: toastError,
  });
  const lead = conversation.lead;
  return (
    <div className="h-full overflow-y-auto p-5 space-y-5 text-sm">
      <div className="flex items-center justify-between xl:hidden">
        <h3 className="font-semibold text-slate-900">Contact</h3>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
      </div>
      <div>
        <p className="text-xs text-slate-400">WhatsApp</p>
        <p className="font-medium text-slate-900">+{contact.wa_id}</p>
        {contact.profile_name ? <p className="text-xs text-slate-500">Profile: {contact.profile_name}</p> : null}
      </div>
      <Field label="Name">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="secondary" busy={savingName} disabled={name === (contact.name || '')} onClick={() => saveName()}>Save</Button>
        </div>
      </Field>
      <Field label="Opt-in" hint={contact.opt_in?.at ? `Since ${dateTime(contact.opt_in.at)}${contact.opt_in.source ? ` (${contact.opt_in.source})` : ''}` : undefined}>
        <Select
          value={contact.opt_in?.status || 'unknown'}
          disabled={savingOptIn}
          onChange={(e) => {
            const v = e.target.value;
            if (v !== 'opted_out' || window.confirm('Mark this contact as opted out? Broadcasts and automated messages will skip them.')) saveOptIn(v);
          }}
          options={OPT_IN_STATUSES}
        />
      </Field>
      <div>
        <p className="text-xs text-slate-400">Service window</p>
        <p className={serviceWindow?.open ? 'text-emerald-700' : 'text-slate-600'}>
          {serviceWindow?.open ? `Open until ${dateTime(serviceWindow.expires_at)}` : 'Closed (templates only)'}
        </p>
        <p className="text-xs text-slate-400 mt-1">Last inbound {contact.last_inbound_at ? timeAgo(contact.last_inbound_at) : '—'}</p>
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-1">Lead</p>
        {lead ? (
          <Link to={`/admin/leads/${lead._id}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
            <span className="font-medium text-indigo-600 truncate">{lead.name || 'Open lead'}</span>
            <StatusBadge status={lead.status} />
          </Link>
        ) : <p className="text-slate-500">No lead linked</p>}
      </div>
      {conversation.assigned_to?.name ? (
        <div>
          <p className="text-xs text-slate-400">Assigned to</p>
          <p className="text-slate-800">{conversation.assigned_to.name}</p>
        </div>
      ) : null}
    </div>
  );
};

// ---------- handover ----------

const HandoverModal = ({ conversationId, onClose, onDone }) => {
  const assignees = useApi(() => getAssignees(), []);
  const [adminId, setAdminId] = useState('');
  const [save, saving] = useAction(() => conversationAction(conversationId, 'handover', adminId ? { admin_id: adminId } : {}), {
    onSuccess: () => { toast.success('Conversation handed over'); onDone(); },
    onError: toastError,
  });
  return (
    <Modal
      open
      title="Hand over to staff"
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={saving} onClick={() => save()}>Hand over</Button></>}
    >
      <Field label="Assign to" hint="Leave as is to keep the current assignee (or take it yourself).">
        <Select
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          placeholder="Current assignee / me"
          options={(assignees.data || []).map((a) => ({ value: a.id, label: a.name }))}
        />
      </Field>
    </Modal>
  );
};

// ---------- thread ----------

const Thread = ({ id, templates, onListChanged, onBack }) => {
  const [limit, setLimit] = useState(50);
  const [showInfo, setShowInfo] = useState(false);
  const [handover, setHandover] = useState(false);
  const conv = useApi(() => getConversation(id), [id]);
  const msgs = useApi(() => listMessages(id, { limit }), [id, limit]);
  const scroller = useRef(null);
  const markedRead = useRef(false);

  const refresh = () => { conv.reload(); msgs.reload(); };
  usePoll(refresh, THREAD_POLL_MS);

  const items = msgs.data?.items || [];
  const newest = items[items.length - 1]?._id;
  // Stick to the bottom on first load and when a new message arrives (not when loading older ones).
  useEffect(() => {
    if (newest && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [newest]);

  // Opening the thread marks it read on the server; refresh the list's unread dot once.
  useEffect(() => {
    if (msgs.data && !markedRead.current) {
      markedRead.current = true;
      onListChanged();
    }
  }, [msgs.data, onListChanged]);

  const [act, acting] = useAction((action) => conversationAction(id, action), {
    onSuccess: () => { toast.success('Conversation updated'); refresh(); onListChanged(); },
    onError: toastError,
  });

  const c = conv.data?.conversation;
  const serviceWindow = conv.data?.service_window;
  const status = c?.status;

  if (conv.error && !c) {
    return <div className="flex-1 flex items-center justify-center p-6 text-sm text-red-600">{conv.error}</div>;
  }
  if (!c) {
    return <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="animate-spin mr-2" size={16} />Loading…</div>;
  }

  return (
    <div className="flex flex-1 min-w-0 min-h-0 relative">
      <div className="flex flex-1 min-w-0 flex-col bg-[linear-gradient(180deg,#fbfcff_0%,#f6f8fc_100%)]">
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200/60 bg-white px-3 sm:px-5 py-3">
          <button type="button" onClick={onBack} className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Back"><ArrowLeft size={18} /></button>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 shrink-0"><MessageCircle size={18} /></div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 truncate">{contactName(c.contact)}</p>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <StatusBadge status={status} />
              <span className={serviceWindow?.open ? 'text-emerald-600' : ''}>{serviceWindow?.open ? '24h window open' : 'Window closed'}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {status === 'open' || status === 'bot' ? (
              <button type="button" disabled={acting} onClick={() => setHandover(true)} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                <UserCheck size={13} /> Handover
              </button>
            ) : null}
            {status === 'open' || status === 'human' ? (
              <button type="button" disabled={acting} onClick={() => act('bot')} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                <Bot size={13} /> Bot
              </button>
            ) : null}
            {status === 'closed' ? (
              <button type="button" disabled={acting} onClick={() => act('reopen')} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                <RotateCcw size={13} /> Reopen
              </button>
            ) : (
              <button
                type="button"
                disabled={acting}
                onClick={() => window.confirm('Close this conversation?') && act('close')}
                className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-rose-600 hover:bg-rose-100 disabled:opacity-50"
              >
                Close
              </button>
            )}
            <button type="button" onClick={() => setShowInfo((v) => !v)} className="xl:hidden rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50" aria-label="Contact details">
              <Info size={14} />
            </button>
          </div>
        </div>

        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-5 space-y-3">
          {msgs.data?.has_more && limit < 200 ? (
            <div className="flex justify-center">
              <button type="button" onClick={() => setLimit((l) => Math.min(200, l + 50))} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50">
                Load older
              </button>
            </div>
          ) : null}
          {msgs.error && !items.length ? <p className="text-center text-sm text-red-600">{msgs.error}</p> : null}
          {msgs.loading && !msgs.data ? <p className="text-center text-sm text-slate-400"><Loader2 className="inline animate-spin mr-2" size={14} />Loading messages…</p> : null}
          {msgs.data && !items.length ? <p className="text-center text-sm text-slate-400">No messages yet.</p> : null}
          {items.map((m) => <MessageBubble key={m._id} m={m} />)}
        </div>

        {status === 'closed' ? (
          <div className="shrink-0 border-t border-slate-200/60 bg-white p-4 text-center text-sm text-slate-500">This conversation is closed. Reopen it to reply.</div>
        ) : (
          <Composer
            key={id}
            conversationId={id}
            windowOpen={Boolean(serviceWindow?.open)}
            templates={templates}
            onRefresh={() => { msgs.reload(); conv.reload(); onListChanged(); }}
          />
        )}
      </div>

      <aside className={`${showInfo ? 'absolute inset-0 z-10 bg-white' : 'hidden'} xl:static xl:block xl:w-72 shrink-0 border-l border-slate-200/60 bg-white`}>
        <ContactPanel
          key={c.contact?._id}
          conversation={c}
          serviceWindow={serviceWindow}
          onChanged={conv.reload}
          onClose={() => setShowInfo(false)}
        />
      </aside>

      {handover ? (
        <HandoverModal conversationId={id} onClose={() => setHandover(false)} onDone={() => { setHandover(false); refresh(); onListChanged(); }} />
      ) : null}
    </div>
  );
};

// ---------- page ----------

const WhatsAppInbox = () => {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [unread, setUnread] = useState(false);
  const [search, setSearch] = useState(() => params.get('search') || '');
  const debouncedSearch = useDebounced(search);

  const waStatus = useApi(() => getWhatsAppStatus(), []);
  const templates = useApi(() => listTemplates({ status: 'APPROVED' }), []);
  const list = useApi(
    () => listConversations({ status, assigned_to: mine ? 'me' : '', unread: unread ? 'true' : '', search: debouncedSearch, limit: 50 }),
    [status, mine, unread, debouncedSearch],
  );
  usePoll(list.reload, LIST_POLL_MS);

  const select = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('conversation', id);
    else next.delete('conversation');
    setParams(next, { replace: true });
  };

  const conversations = list.data?.items || [];
  const cfg = waStatus.data;

  return (
    <PageShell module="WhatsApp" page="Inbox" title="WhatsApp inbox">
      {cfg && !cfg.enabled ? (
        <Notice>
          WhatsApp is not configured, so replies and templates cannot be sent.
          {cfg.missing?.length ? <> Missing: <span className="font-semibold">{cfg.missing.join(', ')}</span>.</> : null}
        </Notice>
      ) : null}

      <div className="flex h-[calc(100vh-13rem)] min-h-[34rem] min-w-0 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        {/* conversation list */}
        <div className={`${selectedId ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 xl:w-96 shrink-0 min-h-0 flex-col border-r-[1.5px] border-slate-200/60 bg-[#F8FAFC]`}>
          <div className="shrink-0 border-b border-slate-200/60 bg-white p-4 space-y-3">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5">
              <Search size={14} className="text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or number"
                className="w-full bg-transparent text-[13px] font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatus(f.value)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap border ${status === f.value ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex gap-4 text-xs text-slate-600">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unread</label>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {list.loading && !list.data ? <p className="p-6 text-center text-sm text-slate-400"><Loader2 className="inline animate-spin mr-2" size={14} />Loading…</p> : null}
            {list.error && !list.data ? <p className="p-6 text-center text-sm text-red-600">{list.error}</p> : null}
            {list.data && !conversations.length ? (
              <div className="m-2 rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">No conversations</div>
            ) : null}
            {conversations.map((c) => {
              const active = c._id === selectedId;
              const unreadCount = c.unread_count > 0;
              return (
                <button
                  key={c._id}
                  type="button"
                  onClick={() => select(c._id)}
                  className={`w-full text-left rounded-2xl px-3 py-3 transition-colors ${active ? 'bg-white ring-1 ring-indigo-200 shadow-sm' : 'hover:bg-white'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${unreadCount ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{contactName(c.contact)}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(c.last_message?.at || c.updatedAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">
                      {c.last_message?.direction === 'out' ? 'You: ' : ''}{previewText(c.last_message) || 'No messages'}
                    </span>
                    {unreadCount ? <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-indigo-600" title={`${c.unread_count} unread`} /> : null}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <StatusBadge status={c.status} />
                    {!c.service_window?.open && c.status !== 'closed' ? <span className="text-[10px] text-slate-400">window closed</span> : null}
                    {c.assigned_to?.name ? <span className="truncate text-[10px] text-slate-400">· {c.assigned_to.name}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* thread */}
        <div className={`${selectedId ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 min-h-0`}>
          {selectedId ? (
            <Thread key={selectedId} id={selectedId} templates={templates.data?.items || []} onListChanged={list.reload} onBack={() => select(null)} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center bg-[linear-gradient(180deg,#fbfcff_0%,#f6f8fc_100%)] p-6 text-center">
              <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center text-slate-300 mb-6"><MessageCircle size={32} /></div>
              <p className="text-sm font-semibold text-slate-600">Select a conversation</p>
              <p className="text-xs text-slate-400 mt-1">Messages from WhatsApp customers appear here.</p>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
};

export default WhatsAppInbox;
