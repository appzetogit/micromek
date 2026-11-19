import { ApiError } from '../../../utils/ApiError.js';

/// Publisher interface (Facebook Page / Instagram Business / Meta Ads):
///   { name, enabled: true,
///     publishContent(item) -> { external_id, permalink?, raw? },
///     publishCampaign(draft) -> { external_id, raw? } }
/// Register it with registerPublisher() and select it with MKT_PUBLISHER=<name>.
/// Only `disabled` exists today: Meta Graph publishing is not implemented.

const notConfigured = () => {
  throw new ApiError(503, 'Meta publishing is not configured', { code: 'META_PUBLISHING_NOT_CONFIGURED' });
};

export const disabledPublisher = Object.freeze({
  name: 'disabled',
  enabled: false,
  publishContent: async () => notConfigured(),
  publishCampaign: async () => notConfigured(),
});

const registry = new Map([['disabled', disabledPublisher]]);
const warned = new Set();

export const registerPublisher = (name, impl) => registry.set(String(name).toLowerCase(), impl);
export const unregisterPublisher = (name) => { if (name !== 'disabled') registry.delete(String(name).toLowerCase()); };

export const getPublisher = () => {
  const name = String(process.env.MKT_PUBLISHER || 'disabled').trim().toLowerCase();
  const impl = registry.get(name);
  if (impl) return impl;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[marketing/publisher] MKT_PUBLISHER="${name}" is not registered; publishing stays disabled`);
  }
  return disabledPublisher;
};

export const publisherStatus = () => {
  const p = getPublisher();
  return { publisher: p.name, enabled: !!p.enabled, registered: [...registry.keys()] };
};
