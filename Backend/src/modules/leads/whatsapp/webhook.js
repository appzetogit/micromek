import crypto from 'node:crypto';

/// Pure helpers for Meta webhooks (no DB, no network) so they can be unit-tested.

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/// Checks X-Hub-Signature-256 ("sha256=<hex hmac of the raw body>").
export const verifySignature = (rawBody, signatureHeader, appSecret) => {
  if (!appSecret || !signatureHeader || rawBody == null) return false;
  const [scheme, given] = String(signatureHeader).split('=');
  if (scheme !== 'sha256' || !given || !/^[a-f0-9]{64}$/i.test(given)) return false;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', appSecret).update(buf).digest();
  const actual = Buffer.from(given, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

/// GET hub challenge. Returns the challenge to echo, or null to refuse.
export const verifyChallenge = (query = {}, verifyToken) => {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || !verifyToken || !token || challenge == null) return null;
  const a = Buffer.from(String(token));
  const b = Buffer.from(String(verifyToken));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return String(challenge);
};

/// True while the customer-service window opened by the customer's last
/// inbound message is still open (free-form messages allowed).
export const withinServiceWindow = (lastInboundAt, now = Date.now()) => {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(t)) return false;
  const n = now instanceof Date ? now.getTime() : Number(now);
  return n - t >= 0 && n - t < SERVICE_WINDOW_MS;
};

export const windowExpiresAt = (lastInboundAt) =>
  lastInboundAt ? new Date(new Date(lastInboundAt).getTime() + SERVICE_WINDOW_MS) : null;

const OPT_OUT = new Set(['STOP', 'STOP ALL', 'STOPALL', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'CANCEL ALL']);
const OPT_IN = new Set(['START', 'UNSTOP', 'SUBSCRIBE', 'OPT IN', 'OPTIN']);

const keyword = (text) =>
  String(text ?? '').trim().toUpperCase().replace(/[^A-Z ]+/g, '').replace(/\s+/g, ' ').trim();

/// The whole message must be the keyword - "please don't stop my order" is not an opt-out.
export const isOptOut = (text) => OPT_OUT.has(keyword(text));
export const isOptIn = (text) => OPT_IN.has(keyword(text));

/// Digits only, with the default country code added to bare national numbers.
export const normalizePhone = (value, defaultCountryCode = '91') => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10 && defaultCountryCode) digits = `${defaultCountryCode}${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
};

const tsToDate = (ts) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

/// Flattens one inbound Cloud API message into what we store.
export const normalizeInboundMessage = (m, { phoneNumberId = '', profileName = '' } = {}) => {
  const type = String(m.type || 'unknown');
  const out = {
    id: m.id,
    from: String(m.from || ''),
    phone_number_id: phoneNumberId,
    profile_name: profileName,
    timestamp: tsToDate(m.timestamp),
    type,
    body: '',
    media: null,
    location: null,
    interactive: null,
    context: m.context ? { from: m.context.from || '', id: m.context.id || '' } : null,
    referral: m.referral
      ? {
        source_url: m.referral.source_url || '',
        source_id: m.referral.source_id || '',
        source_type: m.referral.source_type || '',
        headline: m.referral.headline || '',
        body: m.referral.body || '',
        ctwa_clid: m.referral.ctwa_clid || '',
      }
      : null,
    errors: Array.isArray(m.errors) ? m.errors : [],
  };

  if (type === 'text') {
    out.body = String(m.text?.body || '');
  } else if (type === 'interactive') {
    const i = m.interactive || {};
    const reply = i.button_reply || i.list_reply || i.nfm_reply || {};
    out.interactive = {
      type: i.type || '',
      id: reply.id || '',
      title: reply.title || reply.name || '',
      description: reply.description || '',
    };
    out.body = out.interactive.title || reply.response_json || '';
  } else if (type === 'button') {
    out.interactive = { type: 'button', id: m.button?.payload || '', title: m.button?.text || '', description: '' };
    out.body = String(m.button?.text || m.button?.payload || '');
  } else if (type === 'location') {
    const l = m.location || {};
    out.location = {
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
      name: l.name || '',
      address: l.address || '',
      url: l.url || '',
    };
    out.body = [l.name, l.address].filter(Boolean).join(', ') || `${l.latitude},${l.longitude}`;
  } else if (MEDIA_TYPES.includes(type)) {
    const md = m[type] || {};
    out.media = {
      id: md.id || '',
      mime_type: md.mime_type || '',
      sha256: md.sha256 || '',
      caption: md.caption || '',
      filename: md.filename || '',
      voice: Boolean(md.voice),
      animated: Boolean(md.animated),
    };
    out.body = md.caption || md.filename || '';
  } else if (type === 'contacts') {
    out.body = (m.contacts || []).map((c) => c.name?.formatted_name).filter(Boolean).join(', ');
  } else if (type === 'reaction') {
    out.body = String(m.reaction?.emoji || '');
    out.context = { from: '', id: m.reaction?.message_id || '' };
  } else if (type === 'order') {
    out.body = String(m.order?.text || 'Order');
  }
  return out;
};

export const normalizeStatus = (s, { phoneNumberId = '' } = {}) => ({
  id: s.id,
  status: String(s.status || ''),
  timestamp: tsToDate(s.timestamp),
  recipient_id: String(s.recipient_id || ''),
  phone_number_id: phoneNumberId,
  conversation: s.conversation
    ? { id: s.conversation.id || '', origin: s.conversation.origin?.type || '', expires_at: s.conversation.expiration_timestamp ? tsToDate(s.conversation.expiration_timestamp) : null }
    : null,
  pricing: s.pricing ? { billable: s.pricing.billable, category: s.pricing.category || '', model: s.pricing.pricing_model || '' } : null,
  errors: (Array.isArray(s.errors) ? s.errors : []).map((e) => ({
    code: e.code,
    title: e.title || '',
    message: e.message || e.error_data?.details || '',
    details: e.error_data?.details || '',
  })),
});

/// Splits a WhatsApp Cloud API webhook body into inbound messages and
/// outbound status updates. Unknown objects/fields are ignored.
export const parseCloudWebhook = (body) => {
  const result = { messages: [], statuses: [] };
  if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return result;
  for (const entry of body.entry) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'messages' || !change.value) continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id || '';
      const names = new Map((value.contacts || []).map((c) => [String(c.wa_id), c.profile?.name || '']));
      for (const m of value.messages || []) {
        if (!m?.id) continue;
        result.messages.push(normalizeInboundMessage(m, { phoneNumberId, profileName: names.get(String(m.from)) || '' }));
      }
      for (const s of value.statuses || []) {
        if (!s?.id) continue;
        result.statuses.push(normalizeStatus(s, { phoneNumberId }));
      }
    }
  }
  return result;
};

/// Meta Lead Ads webhook (object "page", field "leadgen").
export const parseLeadgenWebhook = (body) => {
  if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return [];
  const leads = [];
  for (const entry of body.entry) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'leadgen' || !change.value?.leadgen_id) continue;
      const v = change.value;
      leads.push({
        leadgen_id: String(v.leadgen_id),
        page_id: String(v.page_id || entry.id || ''),
        form_id: String(v.form_id || ''),
        ad_id: String(v.ad_id || ''),
        adgroup_id: String(v.adgroup_id || ''),
        created_time: v.created_time ? tsToDate(v.created_time) : new Date(),
      });
    }
  }
  return leads;
};

/// Picks name/phone/email out of a Graph lead's field_data; everything else
/// is kept as answers.
export const mapLeadFieldData = (fieldData = []) => {
  const answers = {};
  for (const f of Array.isArray(fieldData) ? fieldData : []) {
    if (!f?.name) continue;
    answers[f.name] = Array.isArray(f.values) ? f.values.join(', ') : String(f.values ?? '');
  }
  const find = (...keys) => {
    for (const k of keys) if (answers[k]) return answers[k];
    return '';
  };
  const first = find('first_name');
  const last = find('last_name');
  return {
    name: find('full_name', 'name') || [first, last].filter(Boolean).join(' '),
    phone: find('phone_number', 'phone', 'mobile', 'mobile_number', 'whatsapp_number'),
    email: find('email', 'email_address', 'work_email'),
    city: find('city'),
    answers,
  };
};
