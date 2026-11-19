/// Shared enums. Admins are the taxi panel's admin accounts (model "TaxiAdmin").
export const ADMIN_REF = 'TaxiAdmin';

export const LEAD_SOURCES = Object.freeze(['whatsapp', 'meta_ads', 'website', 'phone', 'manual', 'campaign']);
export const LEAD_TYPES = Object.freeze(['enquiry', 'order', 'wholesale']);
export const LEAD_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  QUALIFIED: 'qualified',
  WON: 'won',
  LOST: 'lost',
});
export const OPEN_LEAD_STATUSES = Object.freeze([LEAD_STATUS.NEW, LEAD_STATUS.CONTACTED, LEAD_STATUS.QUALIFIED]);

/// Allowed moves. Lost leads can be reopened; won is final.
export const LEAD_TRANSITIONS = Object.freeze({
  new: ['contacted', 'qualified', 'won', 'lost'],
  contacted: ['new', 'qualified', 'won', 'lost'],
  qualified: ['contacted', 'won', 'lost'],
  won: [],
  lost: ['new', 'contacted'],
});

export const ACTIVITY_TYPES = Object.freeze([
  'created', 'note', 'call', 'email', 'whatsapp', 'meeting', 'visit', 'status', 'assigned', 'updated',
  'follow_up', 'follow_up_done', 'follow_up_overdue', 'order', 'message', 'system',
]);
export const MANUAL_ACTIVITY_TYPES = Object.freeze(['note', 'call', 'email', 'whatsapp', 'meeting', 'visit']);

export const CONVERSATION_STATUS = Object.freeze(['open', 'bot', 'human', 'closed']);
export const OPT_IN_STATUS = Object.freeze(['unknown', 'opted_in', 'opted_out']);

export const MESSAGE_STATUS_RANK = Object.freeze({
  received: 0, queued: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5, skipped: 5,
});

export const BROADCAST_STATUS = Object.freeze(['draft', 'scheduled', 'running', 'done', 'cancelled']);
