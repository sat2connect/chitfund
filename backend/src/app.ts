import cors from 'cors';
import express from 'express';
import type { AuthService } from './auth/authService.js';
import { createAuthRouter } from './auth/authRoutes.js';
import { sessionAuthenticate, sessionCookieName } from './auth/sessionAuth.js';
import { createUserAdminService } from './auth/userAdminService.js';
import { loadConfig, type AppConfig } from './config/index.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/common.js';
import type { PersistentStore } from './persistence/persistentStore.js';
import { RequestGate, unitOfWork } from './persistence/unitOfWork.js';
import type { Store } from './repositories/store.js';
import { createApiRouter } from './routes/index.js';
import { securityHeaders } from './security/headers.js';
import { createSeededStore } from './seed/crmSeed.js';

export interface AppOptions {
  /** When set, every mutating request is committed to PostgreSQL before it is answered. */
  persistence?: PersistentStore;
  /** Required with AUTH_MODE=session. */
  auth?: AuthService;
  config?: AppConfig;
}

export const createApp = (store: Store = createSeededStore(), opts: AppOptions = {}) => {
  const cfg = opts.config ?? loadConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development', AUTH_MODE: 'dev' });
  const session = cfg.authMode === 'session';
  if (session && (!opts.persistence || !opts.auth)) throw new Error('AUTH_MODE=session requires persistence and an AuthService');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use(requestId);
  app.use(securityHeaders({ hsts: cfg.isProduction }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || cfg.corsOrigins.includes(origin)),
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'authorization', ...(session ? [] : ['x-dev-user'])],
  }));
  app.use(express.json({ limit: '1mb' }));

  // Liveness: the process is up. Readiness: it can serve (database reachable, memory consistent).
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'chitfund-crm-backend', time: new Date().toISOString() });
  });
  app.get('/api/v1/ready', async (_req, res) => {
    try {
      if (opts.persistence?.poisoned) throw new Error('in-memory state needs a restart');
      await opts.persistence?.db.ping();
      res.json({ status: 'ready' });
    } catch (e) {
      res.status(503).json({ status: 'not_ready', reason: (e as Error).message });
    }
  });

  if (opts.persistence) app.use('/api/v1', unitOfWork(opts.persistence, new RequestGate()));

  if (session) {
    const authService = opts.auth!;
    const authenticate = sessionAuthenticate(authService, { cookieName: sessionCookieName(cfg.cookieSecure), allowedOrigins: cfg.corsOrigins });
    const authRouter = createAuthRouter(authService, { cookieSecure: cfg.cookieSecure, sessionAbsoluteMs: cfg.sessionAbsoluteMs, loginRateLimit: cfg.loginRateLimit, authenticate });
    const userAdmin = createUserAdminService(opts.persistence!.db, store, authService);
    app.use('/api/v1', createApiRouter(store, { mode: 'session', authenticate, authRouter, userAdmin }));
  } else {
    app.use('/api/v1', createApiRouter(store, { mode: 'dev' }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};