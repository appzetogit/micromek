import { EventEmitter } from 'node:events';

/// In-process event bus so modules can react to each other without importing
/// each other (e.g. commerce emits order updates, the WhatsApp module sends
/// the customer a template message). Listeners must not throw; failures are
/// logged and never reach the emitter.
///
/// Events in use:
///   commerce.order.created          { order }
///   commerce.order.status_changed   { order, from, to }
///   commerce.shipment.updated       { shipment, order }
///   commerce.cart.abandoned         { cart, customer }
///   ev.alert.raised                 { alert, vehicle }
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export const emit = (event, payload) => {
  try {
    bus.emit(event, payload);
  } catch (error) {
    console.error(`[events] listener for ${event} failed`, error);
  }
};

export const on = (event, handler) =>
  bus.on(event, async (payload) => {
    try {
      await handler(payload);
    } catch (error) {
      console.error(`[events] handler for ${event} failed`, error);
    }
  });
