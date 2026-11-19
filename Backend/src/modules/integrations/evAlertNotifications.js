import { on } from '../shared/events.js';
import { emitToAdmins } from '../taxi/services/dispatchService.js';

/// Tells admins about a new EV alert the moment it is raised: a live
/// `ev_alert` event on the admin socket room, which the admin panel shows as a
/// toast (AdminLayout). The panel shows it only to admins with EV access.
///
/// Alerts are raised once per open problem (EvAlert dedupes), so this does not
/// repeat every poll. They come from the leader process; across several API
/// processes the Socket.IO Redis adapter (REDIS_URL) carries them to every
/// admin, as it already does for SOS and bookings.

export const toEvAlertPayload = ({ alert = {}, vehicle = {} } = {}) => ({
  id: String(alert._id || ''),
  type: alert.type || '',
  severity: alert.severity || 'warning',
  message: alert.message || '',
  value: alert.value ?? null,
  raisedAt: alert.raised_at || new Date(),
  vehicle: {
    id: String(vehicle._id || alert.vehicle_id || ''),
    registrationNo: vehicle.registration_no || '',
    franchiseId: vehicle.franchise_id ? String(vehicle.franchise_id) : null,
  },
});

let registered = false;
export const registerEvAlertNotifications = () => {
  if (registered) return;
  registered = true;
  on('ev.alert.raised', (payload) => emitToAdmins('ev_alert', toEvAlertPayload(payload)));
};
