import { ApiError } from '../../../utils/ApiError.js';
import { bigship } from './bigship.js';
import { localPorter } from './localPorter.js';
import { shiprocket } from './shiprocket.js';

/// Adapter contract:
///   { name, isEnabled(), quoteRates(shipment), createShipment(order, shipment),
///     track(awb), cancel(shipment|awb), parseWebhook(req) }
/// createShipment returns { status, raw_status, awb, courier_id, courier_name,
///   provider_order_id?, provider_shipment_id?, tracking_url?, charge?, error? }.
export const adapters = Object.freeze({ shiprocket, bigship, local_porter: localPorter });

export const getAdapter = (name) => {
  const adapter = adapters[String(name || '')];
  if (!adapter) throw new ApiError(400, `Unknown shipping provider: ${name}`);
  return adapter;
};

export const providerStatus = () =>
  Object.fromEntries(Object.entries(adapters).map(([k, a]) => [k, { enabled: a.isEnabled() }]));

export { setPlatformDeliveryBooker } from './localPorter.js';
