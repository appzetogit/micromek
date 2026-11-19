/// Env for the leads / WhatsApp module. Read lazily (functions, not constants)
/// so tests and late dotenv loads see the current process.env.

const str = (key, fallback = '') => {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};
const int = (key, fallback) => {
  const value = Number.parseInt(process.env[key], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const bool = (key, fallback = false) => {
  const value = str(key).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
};

export const waConfig = () => ({
  graphVersion: str('WA_GRAPH_VERSION', 'v21.0'),
  graphBase: str('WA_GRAPH_BASE_URL', 'https://graph.facebook.com'),
  phoneNumberId: str('WA_PHONE_NUMBER_ID'),
  accessToken: str('WA_ACCESS_TOKEN'),
  appSecret: str('WA_APP_SECRET'),
  verifyToken: str('WA_VERIFY_TOKEN'),
  businessAccountId: str('WA_BUSINESS_ACCOUNT_ID'),
  timeoutMs: int('WA_HTTP_TIMEOUT_MS', 15000),
  defaultCountryCode: str('WA_DEFAULT_COUNTRY_CODE', '91').replace(/\D/g, ''),
  templateLanguage: str('WA_TPL_LANG', 'en'),
  botEnabled: bool('WA_BOT_ENABLED', false),
  requireOptIn: bool('WA_REQUIRE_OPT_IN', false),
  optOutReply: str('WA_OPT_OUT_REPLY'),
  broadcastBatch: int('WA_BROADCAST_BATCH', 50),
  broadcastDelayMs: int('WA_BROADCAST_DELAY_MS', 250),
  broadcastMaxRecipients: int('WA_BROADCAST_MAX_RECIPIENTS', 10000),
});

export const metaConfig = () => ({
  pageAccessToken: str('META_PAGE_ACCESS_TOKEN'),
  // Lead Ads usually come through the same Meta app; separate values win when set.
  appSecret: str('META_APP_SECRET', str('WA_APP_SECRET')),
  verifyToken: str('META_VERIFY_TOKEN', str('WA_VERIFY_TOKEN')),
});

export const leadsConfig = () => {
  const mode = str('LEADS_AUTO_ASSIGN', 'round_robin').toLowerCase();
  return {
    autoAssign: ['round_robin', 'least_loaded', 'none'].includes(mode) ? mode : 'round_robin',
    jobIntervalMs: int('LEADS_JOB_INTERVAL_MS', 60000),
    reminderLeadMinutes: int('LEADS_REMINDER_LEAD_MINUTES', 15),
  };
};

/// Template names per automated notification. `params` lists the context keys
/// (see eventListeners.buildContext) that fill the body {{1}}, {{2}}, ... in
/// order; override with <ENV>_PARAMS="name,number" (empty string = no params).
const TEMPLATE_DEFAULTS = {
  order_confirmed: { env: 'WA_TPL_ORDER_CONFIRMED', params: ['name', 'number', 'total'] },
  order_shipped: { env: 'WA_TPL_ORDER_SHIPPED', params: ['name', 'number', 'awb', 'tracking_url'] },
  order_delivered: { env: 'WA_TPL_ORDER_DELIVERED', params: ['name', 'number'] },
  cart_reminder: { env: 'WA_TPL_CART_REMINDER', params: ['name'] },
  payment_reminder: { env: 'WA_TPL_PAYMENT_REMINDER', params: ['name', 'number', 'total'] },
};

export const notificationTemplate = (kind) => {
  const def = TEMPLATE_DEFAULTS[kind];
  if (!def) return null;
  const name = str(def.env);
  const rawParams = process.env[`${def.env}_PARAMS`];
  const params = typeof rawParams === 'string'
    ? rawParams.split(',').map((p) => p.trim()).filter(Boolean)
    : def.params;
  return {
    kind,
    env: def.env,
    name,
    language: str(`${def.env}_LANG`, waConfig().templateLanguage),
    params,
  };
};

export const NOTIFICATION_KINDS = Object.keys(TEMPLATE_DEFAULTS);
