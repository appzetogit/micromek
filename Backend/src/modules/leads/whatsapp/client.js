import { ApiError } from '../../../utils/ApiError.js';
import { metaConfig, waConfig } from '../config.js';
import { withinServiceWindow, windowExpiresAt } from './webhook.js';

/// Thin Meta Graph API client for the WhatsApp Cloud API and Lead Ads.

export class GraphApiError extends ApiError {
  constructor(message, details) {
    super(502, message, details);
    this.name = 'GraphApiError';
  }
}

export const missingWhatsAppConfig = () => {
  const c = waConfig();
  return [
    ['WA_PHONE_NUMBER_ID', c.phoneNumberId],
    ['WA_ACCESS_TOKEN', c.accessToken],
  ].filter(([, v]) => !v).map(([k]) => k);
};

export const isWhatsAppEnabled = () => missingWhatsAppConfig().length === 0;

export const assertWhatsAppEnabled = () => {
  const missing = missingWhatsAppConfig();
  if (missing.length) {
    throw new ApiError(503, 'WhatsApp is not configured', { code: 'WHATSAPP_DISABLED', missing });
  }
};

/// Low-level request with timeout and structured errors.
export const graphRequest = async (path, { method = 'GET', token, body, query, timeoutMs } = {}) => {
  const c = waConfig();
  const url = new URL(`${c.graphBase.replace(/\/$/, '')}/${c.graphVersion}/${String(path).replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs || c.timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new GraphApiError(timedOut ? 'Meta Graph API request timed out' : 'Could not reach Meta Graph API', {
      code: timedOut ? 'GRAPH_TIMEOUT' : 'GRAPH_NETWORK',
      cause: error?.message,
    });
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!response.ok || data?.error) {
    const e = data?.error || {};
    throw new GraphApiError(e.error_user_msg || e.message || `Meta Graph API error (HTTP ${response.status})`, {
      code: 'GRAPH_ERROR',
      http_status: response.status,
      graph_code: e.code ?? null,
      graph_subcode: e.error_subcode ?? null,
      type: e.type || '',
      details: e.error_data?.details || '',
      fbtrace_id: e.fbtrace_id || '',
    });
  }
  return data;
};

const waRequest = (path, options = {}) => {
  assertWhatsAppEnabled();
  return graphRequest(path, { ...options, token: waConfig().accessToken });
};

const messageId = (data) => data?.messages?.[0]?.id || null;

export const assertServiceWindow = (lastInboundAt) => {
  if (!withinServiceWindow(lastInboundAt)) {
    throw new ApiError(409, 'The 24-hour customer service window is closed; send an approved template instead', {
      code: 'OUTSIDE_SERVICE_WINDOW',
      last_inbound_at: lastInboundAt || null,
      window_expired_at: windowExpiresAt(lastInboundAt),
    });
  }
};

export const assertTextBody = (body) => {
  const text = String(body ?? '').trim();
  if (!text) throw new ApiError(400, 'Message text is required');
  if (text.length > 4096) throw new ApiError(400, 'Message text is limited to 4096 characters');
  return text;
};

/// Free-form text. Only allowed inside the 24h customer-service window, which
/// the caller proves with the contact's last inbound message time.
export const sendText = async (to, body, { lastInboundAt, previewUrl = false } = {}) => {
  const text = assertTextBody(body);
  assertServiceWindow(lastInboundAt);
  const data = await waRequest(`${waConfig().phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: Boolean(previewUrl) },
    },
  });
  return { id: messageId(data), raw: data };
};

/// Approved template; allowed at any time (business-initiated).
export const sendTemplate = async (to, name, lang, components = []) => {
  if (!name) throw new ApiError(400, 'Template name is required');
  const data = await waRequest(`${waConfig().phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name,
        language: { code: lang || waConfig().templateLanguage },
        ...(Array.isArray(components) && components.length ? { components } : {}),
      },
    },
  });
  return { id: messageId(data), raw: data };
};

export const markRead = (waMessageId) =>
  waRequest(`${waConfig().phoneNumberId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId },
  });

/// All templates of the WABA (every status; the caller filters APPROVED).
export const listTemplates = async () => {
  assertWhatsAppEnabled();
  const wabaId = waConfig().businessAccountId;
  if (!wabaId) {
    throw new ApiError(503, 'WA_BUSINESS_ACCOUNT_ID is not configured', { code: 'WHATSAPP_DISABLED', missing: ['WA_BUSINESS_ACCOUNT_ID'] });
  }
  const items = [];
  let after;
  for (let page = 0; page < 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const data = await waRequest(`${wabaId}/message_templates`, {
      query: { fields: 'id,name,language,status,category,components,rejected_reason', limit: 100, after },
    });
    items.push(...(data?.data || []));
    after = data?.paging?.cursors?.after;
    if (!data?.paging?.next || !after) break;
  }
  return items;
};

export const getPhoneNumberInfo = () =>
  waRequest(waConfig().phoneNumberId, { query: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status' } });

/// Lead Ads: full lead from its leadgen id.
export const fetchMetaLead = (leadgenId) => {
  const token = metaConfig().pageAccessToken;
  if (!token) {
    throw new ApiError(503, 'META_PAGE_ACCESS_TOKEN is not configured', { code: 'META_DISABLED' });
  }
  return graphRequest(String(leadgenId), {
    token,
    query: { fields: 'created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic' },
  });
};

/// Body parameters ({{1}}, {{2}}, ...) as a components array.
export const bodyParams = (values = []) => {
  const params = values.map((v) => ({ type: 'text', text: String(v ?? '').trim() || '-' }));
  return params.length ? [{ type: 'body', parameters: params }] : [];
};
