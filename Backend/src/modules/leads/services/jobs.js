import mongoose from 'mongoose';
import { emit } from '../../shared/events.js';
import { leadsConfig } from '../config.js';
import { Lead } from '../models/Lead.js';
import { LeadFollowUp } from '../models/LeadFollowUp.js';
import { runDueBroadcasts } from './broadcastService.js';
import { activity, pushActivity } from './leadService.js';

/// Background work: broadcasts, overdue follow-ups, reminders.
/// Emits (for notifications/sockets elsewhere):
///   leads.follow_up.due      { followUp, lead }  - due within LEADS_REMINDER_LEAD_MINUTES
///   leads.follow_up.overdue  { followUp, lead }  - first time a follow-up passes due_at

const log = (...args) => console.log('[leads/jobs]', ...args);

export const markOverdueFollowUps = async (now = new Date()) => {
  const due = await LeadFollowUp.find({ status: 'pending', overdue: false, due_at: { $lt: now } }).limit(500);
  for (const followUp of due) {
    // eslint-disable-next-line no-await-in-loop
    const res = await LeadFollowUp.updateOne({ _id: followUp._id, overdue: false }, { $set: { overdue: true } });
    if (!res.modifiedCount) continue;
    // eslint-disable-next-line no-await-in-loop
    const lead = await Lead.findById(followUp.lead);
    if (lead) {
      pushActivity(lead, activity('follow_up_overdue', { note: `Follow-up due ${followUp.due_at.toISOString()} is overdue`, meta: { follow_up: followUp._id } }));
      // eslint-disable-next-line no-await-in-loop
      await lead.save();
    }
    emit('leads.follow_up.overdue', { followUp, lead });
  }
  return due.length;
};

export const emitFollowUpReminders = async (now = new Date()) => {
  const horizon = new Date(now.getTime() + leadsConfig().reminderLeadMinutes * 60000);
  const upcoming = await LeadFollowUp.find({ status: 'pending', reminded_at: null, due_at: { $gte: now, $lte: horizon } }).limit(500);
  for (const followUp of upcoming) {
    // eslint-disable-next-line no-await-in-loop
    const res = await LeadFollowUp.updateOne({ _id: followUp._id, reminded_at: null }, { $set: { reminded_at: now } });
    if (!res.modifiedCount) continue;
    // eslint-disable-next-line no-await-in-loop
    const lead = await Lead.findById(followUp.lead).select('name phone status assigned_to').lean();
    emit('leads.follow_up.due', { followUp, lead });
  }
  return upcoming.length;
};

let timer = null;
let running = false;

export const runLeadJobsOnce = async () => {
  if (running) return false;
  if (mongoose.connection.readyState !== 1) return false;
  running = true;
  try {
    const now = new Date();
    for (const [name, fn] of [
      ['broadcasts', () => runDueBroadcasts()],
      ['overdue', () => markOverdueFollowUps(now)],
      ['reminders', () => emitFollowUpReminders(now)],
    ]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fn();
      } catch (error) {
        log(`${name} failed:`, error.message);
      }
    }
    return true;
  } finally {
    running = false;
  }
};

export const startLeadJobs = () => {
  if (timer) return timer;
  timer = setInterval(() => { runLeadJobsOnce(); }, leadsConfig().jobIntervalMs);
  timer.unref?.();
  return timer;
};

export const stopLeadJobs = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
