/// Shared enums for the marketing / AI module.
export const ADMIN_REF = 'TaxiAdmin';

/// Holders of this permission (or super admins) may approve / reject AI output.
export const REVIEW_PERMISSION = 'marketing.approve';
export const VIEW_PERMISSION = 'marketing.view';

export const KB_SOURCE_TYPES = Object.freeze(['upload', 'product_catalog', 'faq', 'policy', 'manual']);
export const KB_FORMATS = Object.freeze(['text', 'markdown', 'faq_json', 'pdf', 'products']);
export const KB_STATUS = Object.freeze(['processing', 'ready', 'failed']);

export const CONTENT_CHANNELS = Object.freeze(['facebook', 'instagram', 'whatsapp', 'ad']);
export const CONTENT_KINDS = Object.freeze(['post', 'story', 'ad_copy', 'broadcast']);
export const CONTENT_STATUS = Object.freeze(['draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected']);
export const DEFAULT_KIND_BY_CHANNEL = Object.freeze({ facebook: 'post', instagram: 'post', whatsapp: 'broadcast', ad: 'ad_copy' });
export const CONTENT_TONES = Object.freeze(['friendly', 'professional', 'playful', 'urgent', 'premium', 'informative']);

/// action -> allowed source statuses, target status, whether a reviewer is needed.
export const CONTENT_TRANSITIONS = Object.freeze({
  submit: { from: ['draft', 'rejected'], to: 'in_review', reviewer: false },
  approve: { from: ['in_review'], to: 'approved', reviewer: true },
  reject: { from: ['in_review', 'approved', 'scheduled'], to: 'rejected', reviewer: true },
  schedule: { from: ['approved'], to: 'scheduled', reviewer: false },
  unschedule: { from: ['scheduled'], to: 'approved', reviewer: false },
});
export const CONTENT_EDITABLE = Object.freeze(['draft', 'rejected']);

export const CAMPAIGN_OBJECTIVES = Object.freeze([
  'OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_APP_PROMOTION',
]);
export const CAMPAIGN_STATUS = Object.freeze(['draft', 'approved', 'rejected', 'published']);
export const CAMPAIGN_TRANSITIONS = Object.freeze({
  approve: { from: ['draft'], to: 'approved', reviewer: true },
  reject: { from: ['draft', 'approved'], to: 'rejected', reviewer: true },
  reopen: { from: ['rejected'], to: 'draft', reviewer: false },
});
export const CAMPAIGN_EDITABLE = Object.freeze(['draft', 'rejected']);
export const CALL_TO_ACTIONS = Object.freeze([
  'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'GET_OFFER', 'ORDER_NOW', 'WHATSAPP_MESSAGE', 'CALL_NOW', 'BOOK_NOW',
]);

export const REPORT_STATUS = Object.freeze(['draft', 'approved', 'rejected']);
