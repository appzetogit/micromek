import { Router } from 'express';
import { authenticate } from '../../taxi/middlewares/authMiddleware.js';
import { adminGuard } from '../../shared/guards.js';
import * as c from '../controllers/evController.js';

/// Mounted at /api and /api/v1 ahead of the taxi router, so it only claims
/// /admin/ev/*, /franchise/ev/* and /webhooks/ev/* and passes everything else on.
export const evRouter = Router();

// Telematics vendor push (shared secret, no user auth).
evRouter.post('/webhooks/ev/:provider', c.webhookIngest);

// Admin
const admin = Router();
admin.use(...adminGuard('ev_fleet.view'));
admin.get('/ev/provider', c.adminProviderStatus);
admin.post('/ev/poll-now', c.adminPollNow);
admin.get('/ev/dashboard', c.adminDashboard);
admin.post('/ev/vehicles/sync', c.adminSyncVehicles);
admin.get('/ev/vehicles', c.adminListVehicles);
admin.post('/ev/vehicles', c.adminCreateVehicle);
admin.get('/ev/vehicles/:id', c.adminGetVehicle);
admin.patch('/ev/vehicles/:id', c.adminUpdateVehicle);
admin.delete('/ev/vehicles/:id', c.adminDeleteVehicle);
admin.get('/ev/vehicles/:id/telemetry', c.adminTelemetryHistory);
admin.get('/ev/trips', c.adminListTrips);
admin.get('/ev/trips/:id', c.adminGetTrip);
admin.get('/ev/alerts', c.adminListAlerts);
admin.post('/ev/alerts/:id/:action(acknowledge|resolve)', c.adminAlertAction);
admin.get('/ev/reports/utilisation', c.adminUtilisation);

// Franchise panel: read-only, scoped to the franchise's own vehicles.
const panel = Router();
panel.use(authenticate(['franchise']));
panel.get('/ev/dashboard', c.panelDashboard);
panel.get('/ev/vehicles', c.panelListVehicles);
panel.get('/ev/vehicles/:id', c.panelGetVehicle);
panel.get('/ev/vehicles/:id/telemetry', c.panelTelemetryHistory);
panel.get('/ev/trips', c.panelListTrips);
panel.get('/ev/trips/:id', c.panelGetTrip);
panel.get('/ev/alerts', c.panelListAlerts);
panel.get('/ev/reports/utilisation', c.panelUtilisation);

const ownsEvPath = (router) => (req, res, next) =>
  // Only claim /ev/...; everything else falls through to the other routers.
  /^\/ev(\/|$)/.test(req.path) ? router(req, res, next) : next();

evRouter.use('/admin', ownsEvPath(admin));
evRouter.use('/franchise', ownsEvPath(panel));
