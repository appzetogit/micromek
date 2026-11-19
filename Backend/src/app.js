import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './modules/taxi/middlewares/errorMiddleware.js';
import { taxiRouter } from './modules/taxi/routes/index.js';
import { platformRouter } from './modules/platformRouter.js';
import { registerIntegrations } from './modules/integrations/index.js';

export const createApp = () => {
  const app = express();
  registerIntegrations();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
  app.use(
    express.json({
      limit: '25mb',
      // Signed webhooks (WhatsApp, Meta Lead Ads) are verified over the exact
      // bytes received. Kept for /webhooks/ only, so large uploads aren't held twice.
      verify: (req, _res, buf) => {
        if (req.originalUrl?.includes('/webhooks/')) req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true })); 
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'Taxi backend is healthy' });
  });

  // Keep both mounts during integration so existing clients using /api or /api/v1 continue to work.
  // Franchise, EV, commerce and leads. Mounted first: each claims only its own
  // paths and lets everything else fall through to the taxi router.
  app.use('/api', platformRouter);
  app.use('/api/v1', platformRouter);
  app.use('/api', taxiRouter);
  app.use('/api/v1', taxiRouter);

  app.get(['/api', '/api/v1'], (_req, res) => {
    res.json({
      success: true,
      message: 'Taxi API is mounted',
      routes: {
        admins: ['/api/admin', '/api/v1/admin'],
        users: ['/api/users', '/api/v1/users'],
        drivers: ['/api/drivers', '/api/v1/drivers'],
        rides: ['/api/rides', '/api/v1/rides'],
        deliveries: ['/api/deliveries', '/api/v1/deliveries'],
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
