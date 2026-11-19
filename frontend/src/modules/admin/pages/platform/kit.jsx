/* eslint-disable react-refresh/only-export-components */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import AdminPageHeader from '../../components/ui/AdminPageHeader';
import api from '../../../../shared/api/axiosInstance';

/**
 * Small shared kit for the platform-module admin pages (franchise, EV,
 * commerce, leads/WhatsApp). Plain Tailwind on the admin design system
 * (design-system.md); the admin dark theme remaps these classes.
 */

// ---------- formatting ----------

export const inr = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const num = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits });

export const pct = (n, digits = 0) => (n === null || n === undefined ? '—' : `${num(n, digits)}%`);

export const dateTime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const dateOnly = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const timeAgo = (d) => {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/** yyyy-mm-dd for <input type="date">, n days before today (0 = today). */
export const isoDay = (daysAgo = 0) => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
};

/** Message from an API rejection ({ message, details, status }) or Error. */
export const errorMessage = (err, fallback = 'Something went wrong') =>
  err?.message || err?.data?.message || fallback;

/** Drop empty values and build a query string. */
export const qs = (params = {}) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

// ---------- data hooks ----------

/**
 * Runs `fn` (returns the API body: { success, data }) on mount and whenever
 * `deps` change. Returns the body's `data`. Stale responses are ignored.
 */
export const useApi = (fn, deps = []) => {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const body = await fn();
      if (id === seq.current) setState({ data: body?.data ?? body, loading: false, error: null });
    } catch (err) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: errorMessage(err) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
};

/** Wraps an async action with a busy flag; returns [run, busy]. */
export const useAction = (fn, { onSuccess, onError } = {}) => {
  const [busy, setBusy] = useState(false);
  const run = async (...args) => {
    setBusy(true);
    try {
      const result = await fn(...args);
      onSuccess?.(result);
      return result;
    } catch (err) {
      if (onError) onError(err);
      else window.alert(errorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
};

/** Debounced value, for search boxes. */
export const useDebounced = (value, ms = 350) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

/** Download a protected file (PDF/CSV) with the admin token and save it. */
export const downloadFile = async (url, filename) => {
  const blob = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};

// ---------- layout ----------

export const PageShell = ({ module, page, title, backTo, right, children }) => (
  <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
    <AdminPageHeader module={module} page={page} title={title} backTo={backTo} right={right} />
    {children}
  </div>
);

export const Card = ({ title, subtitle, icon: Icon, right, children, className = '', bodyClassName = 'p-5' }) => (
  <div className={`bg-white rounded-xl border border-gray-200 ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          {Icon ? (
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Icon size={18} />
            </div>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{title}</h3>
            {subtitle ? <p className="text-xs text-gray-400 truncate">{subtitle}</p> : null}
          </div>
        </div>
        {right}
      </div>
    )}
    <div className={bodyClassName}>{children}</div>
  </div>
);

const TONES = {
  indigo: 'bg-indigo-50 text-indigo-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-50 text-blue-600',
};

export const StatCard = ({ label, value, hint, icon: Icon, tone = 'indigo', onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`text-left bg-white rounded-xl border border-gray-200 p-4 ${onClick ? 'hover:border-indigo-300 cursor-pointer' : 'cursor-default'}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="mt-1 text-xl font-semibold text-gray-900 truncate">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-gray-400 truncate">{hint}</p> : null}
      </div>
      {Icon ? (
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone] || TONES.indigo}`}>
          <Icon size={18} />
        </div>
      ) : null}
    </div>
  </button>
);

export const StatGrid = ({ children }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">{children}</div>
);

// ---------- status ----------

const STATUS_TONE = {
  approved: 'green', active: 'green', paid: 'green', delivered: 'green', won: 'green', done: 'green',
  completed: 'green', resolved: 'green', online: 'green', charging: 'green', fast_charging: 'green', in: 'blue',
  pending: 'amber', draft: 'amber', placed: 'amber', new: 'amber', open: 'amber', scheduled: 'amber',
  acknowledged: 'blue', confirmed: 'blue', packed: 'blue', shipped: 'blue', contacted: 'blue', qualified: 'blue',
  running: 'blue', bot: 'blue', human: 'blue', in_transit: 'blue', picked_up: 'blue', pending_assignment: 'amber',
  rejected: 'red', suspended: 'red', cancelled: 'red', failed: 'red', lost: 'red', critical: 'red', returned: 'red',
  offline: 'red', refund_due: 'red', opted_out: 'red', inactive: 'gray', closed: 'gray', maintenance: 'gray', warning: 'amber',
};
const BADGE = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export const StatusBadge = ({ status, tone, label }) => {
  const key = String(status || '').toLowerCase();
  const cls = BADGE[tone || STATUS_TONE[key] || 'gray'];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium capitalize whitespace-nowrap ${cls}`}>
      {label || key.replace(/_/g, ' ') || '—'}
    </span>
  );
};

// ---------- table ----------

/**
 * columns: [{ key, label, render?(row), align?: 'right'|'center', className? }]
 */
export const DataTable = ({ columns, rows = [], loading, error, empty = 'Nothing here yet', onRowClick, rowKey = (r) => r._id || r.id }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100 text-left">
          {columns.map((c) => (
            <th key={c.key} className={`px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading && !rows.length ? (
          <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-gray-400"><Loader2 className="inline animate-spin mr-2" size={16} />Loading…</td></tr>
        ) : error ? (
          <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-red-600">{error}</td></tr>
        ) : !rows.length ? (
          <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-gray-400"><Inbox className="inline mr-2" size={16} />{empty}</td></tr>
        ) : (
          rows.map((row, i) => (
            <tr
              key={rowKey(row) || i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-gray-50 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 text-gray-700 align-middle ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''} ${c.className || ''}`}>
                  {c.render ? c.render(row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

/** For the backend's paged shape { items, total, page, limit, pages }. */
export const Pager = ({ data, onPage }) => {
  if (!data || !data.pages || data.pages <= 1) return null;
  const { page, pages, total } = data;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
      <span>{num(total)} total · page {page} of {pages}</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={14} /></button>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
};

// ---------- forms ----------

export const inputClass =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400';
export const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';

export const Field = ({ label, hint, children, className = '' }) => (
  <label className={`block ${className}`}>
    {label ? <span className={labelClass}>{label}</span> : null}
    {children}
    {hint ? <span className="block mt-1 text-[11px] text-gray-400">{hint}</span> : null}
  </label>
);

export const Input = (props) => <input {...props} className={`${inputClass} ${props.className || ''}`} />;
export const Textarea = (props) => <textarea rows={3} {...props} className={`${inputClass} ${props.className || ''}`} />;
export const Select = ({ options = [], placeholder, ...props }) => (
  <select {...props} className={`${inputClass} ${props.className || ''}`}>
    {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
    {options.map((o) => {
      const value = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? o.label : String(o).replace(/_/g, ' ');
      return <option key={value} value={value}>{label}</option>;
    })}
  </select>
);

export const Button = ({ variant = 'primary', busy, icon: Icon, children, className = '', ...props }) => {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 border border-indigo-600',
    secondary: 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200',
    danger: 'bg-white text-red-600 hover:bg-red-50 border border-red-200',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-600',
  };
  return (
    <button
      type="button"
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
};

/** Row of filter controls above a table. */
export const Toolbar = ({ children }) => (
  <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-gray-100">{children}</div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
    {tabs.map((t) => {
      const key = typeof t === 'object' ? t.value : t;
      const label = typeof t === 'object' ? t.label : t;
      return (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${value === key ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          {label}
        </button>
      );
    })}
  </div>
);

export const Modal = ({ open, title, onClose, children, footer, wide }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Portalled to <body>: inside the page wrapper a fixed element is placed
  // relative to that wrapper and sits under the sidebar. The wrapper class
  // keeps the admin theme (scoped to .redigo-admin-root) on the modal.
  return createPortal(
    <div className="redigo-admin-root">
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onMouseDown={onClose}>
      <div
        className={`bg-white rounded-xl border border-gray-200 shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">{footer}</div> : null}
      </div>
    </div>
    </div>,
    document.body,
  );
};

export const KeyValue = ({ items }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
    {items.filter(Boolean).map(([k, v]) => (
      <div key={k} className="min-w-0">
        <dt className="text-xs text-gray-400">{k}</dt>
        <dd className="text-gray-800 break-words">{v ?? '—'}</dd>
      </div>
    ))}
  </dl>
);

export const Notice = ({ tone = 'amber', children }) => (
  <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${BADGE[tone]}`}>{children}</div>
);

/** Simple horizontal bars for small breakdowns (no chart library). */
export const BarList = ({ items = [], format = num }) => {
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return (
    <div className="space-y-2.5">
      {items.length === 0 ? <p className="text-sm text-gray-400">No data</p> : null}
      {items.map((i) => (
        <div key={i.label}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-600 capitalize truncate">{String(i.label).replace(/_/g, ' ')}</span>
            <span className="text-gray-900 font-medium">{format(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${((Number(i.value) || 0) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};
