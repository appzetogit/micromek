import { Router } from 'express';
import { franchiseRouter } from './franchise/routes/index.js';
import { evRouter } from './ev/routes/index.js';
import { leadsRouter } from './leads/routes/index.js';
import { commerceRouter } from './commerce/routes/index.js';

/// Routers for the modules added on top of the taxi platform. Each one only
/// claims its own path prefixes and passes everything else on. The more
/// specific /franchise/{ev,commerce} routers go before the franchise panel.
export const platformRouter = Router();

platformRouter.use(evRouter);
platformRouter.use(commerceRouter);
platformRouter.use(leadsRouter);
platformRouter.use(franchiseRouter);
