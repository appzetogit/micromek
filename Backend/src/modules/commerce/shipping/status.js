/// Provider-neutral shipment statuses, and how they drive the order status.

export const SHIPMENT_STATUSES = Object.freeze([
  'created', 'pending_assignment', 'booked', 'picked_up', 'in_transit', 'out_for_delivery',
  'delivered', 'rto', 'returned', 'cancelled', 'failed',
]);

export const TERMINAL_SHIPMENT = Object.freeze(['delivered', 'returned', 'cancelled', 'failed']);

// Forward-only progress; rto may follow any in-flight state.
const RANK = {
  created: 0, pending_assignment: 1, booked: 2, picked_up: 3, in_transit: 4, out_for_delivery: 5,
  rto: 6, delivered: 7, returned: 8, cancelled: 9, failed: 9,
};

export const isForward = (from, to) => {
  if (from === to || TERMINAL_SHIPMENT.includes(from)) return false;
  if (to === 'cancelled' || to === 'failed') return true;
  return (RANK[to] ?? -1) > (RANK[from] ?? -1);
};

/// Order status implied by a shipment status (null = no order change).
export const orderStatusFor = (shipmentStatus) => {
  if (['picked_up', 'in_transit', 'out_for_delivery', 'rto'].includes(shipmentStatus)) return 'shipped';
  if (shipmentStatus === 'delivered') return 'delivered';
  if (shipmentStatus === 'returned') return 'returned';
  return null;
};

/// Maps free-text courier statuses (Shiprocket / BigShip) to ours.
export const normalizeCourierStatus = (raw = '') => {
  const s = String(raw || '').trim().toUpperCase().replace(/[_-]+/g, ' ');
  if (!s) return null;
  if (s.startsWith('RTO')) return /DELIVERED|RECEIVED/.test(s) ? 'returned' : 'rto';
  if (/UNDELIVERED|NDR|FAILED DELIVERY/.test(s)) return 'out_for_delivery';
  if (/^DELIVERED/.test(s)) return 'delivered';
  if (/CANCEL/.test(s)) return 'cancelled';
  if (/OUT FOR DELIVERY/.test(s)) return 'out_for_delivery';
  if (/IN TRANSIT|SHIPPED|REACHED|DISPATCHED|IN TRANSIT|ARRIVED/.test(s)) return 'in_transit';
  if (/PICKED UP|PICKUP DONE|PICKED/.test(s)) return 'picked_up';
  if (/AWB|MANIFEST|PICKUP SCHEDULED|PICKUP QUEUED|PICKUP GENERATED|READY TO SHIP|NEW|BOOKED/.test(s)) return 'booked';
  if (/LOST|DAMAGED|DESTROYED/.test(s)) return 'failed';
  return null;
};
