import { Router } from 'express';
import { authenticate } from '../../taxi/middlewares/authMiddleware.js';
import { loginRateLimit, otpSendRateLimit } from '../../taxi/middlewares/rateLimitMiddleware.js';
import { adminGuard } from '../../shared/guards.js';
import * as c from '../controllers/franchiseController.js';

export const franchiseRouter = Router();

// Public
franchiseRouter.post('/franchise/apply', otpSendRateLimit, c.applyForFranchise);
franchiseRouter.post('/franchise/auth/login', loginRateLimit, c.franchiseLogin);

// Franchise panel (role: franchise)
const panel = Router();
panel.use(authenticate(['franchise']));
panel.get('/me', c.panelMe);
panel.patch('/me', c.panelUpdateMe);
panel.post('/me/password', c.panelChangePassword);
panel.get('/dashboard', c.panelDashboard);
panel.get('/drivers', c.panelDrivers);
panel.get('/owners', c.panelOwners);
panel.get('/fleet-vehicles', c.panelFleetVehicles);
panel.get('/rides', c.panelRides);
panel.get('/fares', c.panelFares);
panel.get('/settlements', c.panelSettlements);
panel.get('/settlements/:id', c.panelSettlement);
franchiseRouter.use('/franchise', panel);

// Admin
const admin = Router();
admin.use(...adminGuard('franchises.view'));
admin.get('/franchises', c.adminListFranchises);
admin.post('/franchises', c.adminCreateFranchise);
admin.get('/franchises/leaderboard', c.adminFranchiseLeaderboard);
admin.get('/franchises/:id', c.adminGetFranchise);
admin.patch('/franchises/:id', c.adminUpdateFranchise);
admin.post('/franchises/:id/:action(approve|reject|suspend|reactivate)', c.adminSetFranchiseStatus);
admin.delete('/franchises/:id', c.adminDeleteFranchise);

admin.get('/franchise-settlements', c.adminListSettlements);
admin.post('/franchise-settlements', c.adminGenerateSettlement);
admin.get('/franchise-settlements/:id', c.adminGetSettlement);
admin.post('/franchise-settlements/:id/refresh', c.adminRefreshSettlement);
admin.post('/franchise-settlements/:id/adjustments', c.adminAdjustSettlement);
admin.post('/franchise-settlements/:id/:action(approve|pay|cancel)', c.adminTransitionSettlement);
franchiseRouter.use('/admin', (req, res, next) =>
  // Only claim the paths this module owns; everything else falls through to the taxi admin router.
  /^\/(franchises|franchise-settlements)(\/|$)/.test(req.path) ? admin(req, res, next) : next());
