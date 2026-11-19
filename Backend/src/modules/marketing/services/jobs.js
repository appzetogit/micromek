import mongoose from 'mongoose';
import { ContentItem } from '../models/ContentItem.js';
import { getPublisher } from '../publishers/index.js';
import { markPublished } from './contentService.js';
import { envInt } from './util.js';

const LOCK_MS = 5 * 60000;
let loggedDisabled = false;

/// Publish scheduled (= approved and given a time) content that is due.
/// With the disabled publisher this does nothing and logs once.
export const runPublishDue = async ({ now = new Date(), limit = 20 } = {}) => {
  const publisher = getPublisher();
  if (!publisher.enabled) {
    if (!loggedDisabled) {
      loggedDisabled = true;
      console.log('[marketing/jobs] publisher disabled (MKT_PUBLISHER not set); scheduled content will not be published');
    }
    return { published: 0, failed: 0, skipped: 'publisher_disabled' };
  }
  loggedDisabled = false;
  const maxAttempts = envInt('MKT_PUBLISH_MAX_ATTEMPTS', 3);
  const due = await ContentItem.find({
    status: 'scheduled',
    scheduled_at: { $lte: now },
    'publish.attempts': { $not: { $gte: maxAttempts } },
  }).select('_id').sort({ scheduled_at: 1 }).limit(limit).lean();

  let published = 0;
  let failed = 0;
  for (const { _id } of due) {
    // Claim the item so two processes never publish it twice.
    // eslint-disable-next-line no-await-in-loop
    const item = await ContentItem.findOneAndUpdate(
      { _id, status: 'scheduled', $or: [{ 'publish.locked_until': null }, { 'publish.locked_until': { $lt: now } }] },
      { $set: { 'publish.locked_until': new Date(now.getTime() + LOCK_MS), 'publish.last_attempt_at': now }, $inc: { 'publish.attempts': 1 } },
      { returnDocument: 'after' },
    );
    if (!item) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await publisher.publishContent(item.toObject());
      // eslint-disable-next-line no-await-in-loop
      await markPublished(item, publisher, result);
      published += 1;
    } catch (error) {
      failed += 1;
      // eslint-disable-next-line no-await-in-loop
      await ContentItem.updateOne({ _id }, { $set: { 'publish.error': String(error.message).slice(0, 1000), 'publish.locked_until': null } });
    }
  }
  return { published, failed };
};

let timer = null;
let running = false;

export const startMarketingJobs = () => {
  if (timer) return stopMarketingJobs;
  const every = envInt('MKT_PUBLISH_INTERVAL_MS', 60000);
  timer = setInterval(async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try { await runPublishDue(); } catch (error) { console.warn('[marketing/jobs] tick failed', error.message); } finally { running = false; }
  }, every);
  timer.unref?.();
  return stopMarketingJobs;
};

export const stopMarketingJobs = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
