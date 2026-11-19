import { CommerceActivityLog } from '../models/ActivityLog.js';

/// Records who did what. Never throws and never blocks the request.
export const logActivity = (req, action, { store_id = null, entity = '', entity_id = '', meta = {} } = {}) => {
  const actor = req?.commerce?.actor || { type: 'system', id: '', name: 'system' };
  CommerceActivityLog.create({
    actor: { type: actor.type, id: String(actor.id || ''), name: actor.name || '', role: actor.role || '' },
    store_id: store_id || null,
    action,
    entity,
    entity_id: String(entity_id || ''),
    meta,
    ip: req?.ip || '',
  }).catch((error) => console.error('[commerce] activity log failed', error.message));
};
