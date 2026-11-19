import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

/// Production runs four API processes (ecosystem.config.cjs). Background jobs
/// for the platform modules - EV polling, commerce sweeps, WhatsApp broadcasts -
/// must run in exactly one of them, or customers get four copies of a message.
/// One process holds a lease document in Mongo and renews it; if it dies, the
/// lease expires and another process takes over.
const LEASE_MS = 45_000;
const RENEW_MS = 15_000;
const instanceId = `${process.pid}-${randomUUID().slice(0, 8)}`;

let leader = false;
let timer = null;
const jobs = [];

const locks = () => mongoose.connection.collection('platform_job_locks');

const tryAcquire = async (name) => {
  const now = new Date();
  try {
    const result = await locks().findOneAndUpdate(
      { _id: name, $or: [{ owner: instanceId }, { expiresAt: { $lt: now } }] },
      { $set: { owner: instanceId, expiresAt: new Date(now.getTime() + LEASE_MS), renewedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    const doc = result?.value !== undefined ? result.value : result;
    return doc?.owner === instanceId;
  } catch (error) {
    // Duplicate key: another live instance holds it.
    if (error?.code === 11000) return false;
    console.error('[leader] lease check failed', error.message);
    return false;
  }
};

const tick = async (name) => {
  const held = await tryAcquire(name);
  if (held && !leader) {
    leader = true;
    console.log(`[leader] ${instanceId} now runs platform jobs`);
    for (const job of jobs) {
      try { job.start(); } catch (error) { console.error(`[leader] ${job.name} failed to start`, error); }
    }
  } else if (!held && leader) {
    leader = false;
    console.warn(`[leader] ${instanceId} lost the lease; stopping platform jobs`);
    for (const job of jobs) {
      try { job.stop?.(); } catch (error) { console.error(`[leader] ${job.name} failed to stop`, error); }
    }
  }
};

/// Register a job: `start` is called when this process becomes leader,
/// `stop` (optional) when it loses the lease.
export const registerLeaderJob = (name, start, stop) => jobs.push({ name, start, stop });

export const startLeaderElection = (name = 'platform-jobs') => {
  if (timer) return;
  tick(name);
  timer = setInterval(() => tick(name), RENEW_MS);
  timer.unref?.();
};

export const isLeader = () => leader;
