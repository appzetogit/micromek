import { registerCityDelivery } from './commerceCityDelivery.js';
import { registerEvAlertNotifications } from './evAlertNotifications.js';

/// Links between modules (commerce ↔ taxi parcels, EV alerts → admin panel).
/// Registered in every API process, from createApp.
export const registerIntegrations = () => {
  registerCityDelivery();
  registerEvAlertNotifications();
};
