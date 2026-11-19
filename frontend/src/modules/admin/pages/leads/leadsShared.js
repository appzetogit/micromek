/** Enums and helpers shared by the Leads & WhatsApp pages (mirror Backend/src/modules/leads/models/constants.js). */

export const LEAD_SOURCES = ['whatsapp', 'meta_ads', 'website', 'phone', 'manual', 'campaign'];
export const LEAD_TYPES = ['enquiry', 'order', 'wholesale'];
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
export const OPEN_LEAD_STATUSES = ['new', 'contacted', 'qualified'];
export const LEAD_TRANSITIONS = {
  new: ['contacted', 'qualified', 'won', 'lost'],
  contacted: ['new', 'qualified', 'won', 'lost'],
  qualified: ['contacted', 'won', 'lost'],
  won: [],
  lost: ['new', 'contacted'],
};
export const ACTIVITY_TYPES = ['note', 'call', 'email', 'whatsapp', 'meeting', 'visit'];
export const FOLLOW_UP_CHANNELS = ['call', 'whatsapp', 'email', 'visit', 'other'];
export const OPT_IN_STATUSES = ['unknown', 'opted_in', 'opted_out'];
export const TEMPLATE_STATUSES = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'DELETED'];

export const LEAD_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'follow_up', label: 'Next follow-up' },
  { value: 'value', label: 'Highest value' },
  { value: 'updated', label: 'Recently updated' },
];

/** Start / end of a yyyy-mm-dd day as ISO strings (local time). */
export const dayStartIso = (day) => (day ? new Date(`${day}T00:00:00`).toISOString() : '');
export const dayEndIso = (day) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : '');

/** <input type="datetime-local"> value <-> ISO. */
export const localToIso = (value) => (value ? new Date(value).toISOString() : null);
export const isoToLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const minutesLabel = (m) => {
  if (m === null || m === undefined) return '—';
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${Math.round(m % 60)}m`;
  return `${Math.round(h / 24)}d`;
};

export const leadName = (lead) => lead?.name || lead?.phone || lead?.email || 'Unnamed lead';

export const contactName = (contact) =>
  contact?.name || contact?.profile_name || (contact?.wa_id ? `+${contact.wa_id}` : 'Unknown');

/** Current admin from localStorage (same source as AdminLayout); missing means super admin. */
export const isSuperadmin = () => {
  try {
    const info = JSON.parse(window.localStorage.getItem('adminInfo') || 'null');
    return !info || info.admin_type !== 'subadmin';
  } catch {
    return true;
  }
};

// ---------- templates ----------

export const templateBodyText = (template) =>
  (template?.components || []).find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '';

export const templateParamCount = (template) => {
  if (template?.body_param_count) return template.body_param_count;
  const found = templateBodyText(template).match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  return found.reduce((max, p) => Math.max(max, Number(p.replace(/\D/g, ''))), 0);
};

/** Cloud API components for body text parameters. */
export const bodyComponents = (params = []) =>
  params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [];

/** Text parameters back out of stored components. */
export const paramsFromComponents = (components = []) =>
  ((components || []).find((c) => String(c.type).toLowerCase() === 'body')?.parameters || []).map((p) => p.text || '');

export const fillTemplate = (text, params = []) =>
  text.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => params[Number(n) - 1] || m);
