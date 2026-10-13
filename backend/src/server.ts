import http from 'node:http';
import { AuthService, defaultAuthSettings } from './auth/authService.js';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createPgDb } from './db/pgDb.js';
import { pendingMigrations } from './db/migrate.js';
import { migrate } from './db/migrate.js';
import { PersistentStore } from './persistence/persistentStore.js';
import { createEmptyStore } from './repositories/store.js';
import { seedDemoData } from './seed/crmSeed.js';
import { acquireWriterLockWithRetry, createStartupGate, provisionOnStart } from './startup.js';

/** Arbitrary constant: only one backend process may hold this lock and write. */
const WRITER_LOCK_KEY = 727_001;

async function main() {
  const cfg = loadConfig();

  // No DATABASE_URL: development convenience only (demo data in memory, nothing saved). loadConfig refuses this in production.
  if (!cfg.databaseUrl) {
    console.warn('DATABASE_URL is not set: running with demo data in memory. NOTHING IS SAVED. (development only)');
    const app = createApp(seedDemoData(createEmptyStore()), { config: cfg });
    app.listen(cfg.port, () => console.log(`Backend listening on http://localhost:${cfg.port} (in-memory demo, ${cfg.authMode} auth)`));
    return;
  }

  // Listen straight away so the platform's health check passes while this instance waits for the previous one to finish.
  const gate = createStartupGate();
  const server = http.createServer(gate.handler);
  server.listen(cfg.port, () => console.log(`Listening on port ${cfg.port}; starting up (${cfg.env}, ${cfg.authMode} auth, PostgreSQL)`));

  const db = createPgDb({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl, max: cfg.databasePoolMax });
  if (!(await acquireWriterLockWithRetry(db, WRITER_LOCK_KEY))) {
    console.error('Another backend process still holds the writer lock after waiting. Refusing to start.');
    process.exit(1);
  }

  if (process.env.AUTO_MIGRATE === 'true' && !cfg.isProduction) {
    const r = await migrate(db);
    if (r.applied.length) console.log('Applied migrations:', r.applied.join(', '));
  }
  const pending = await pendingMigrations(db);
  if (pending.length) {
    console.error(`Database schema is out of date (pending: ${pending.join(', ')}). Run the migrate command first.`);
    process.exit(1);
  }

  const store = createEmptyStore();
  const persistence = new PersistentStore(db, store);
  await persistence.load();
  if (process.env.SEED_DEMO === 'true' && !cfg.isProduction && store.branches.length === 0) {
    seedDemoData(store);
    await persistence.commit();
    console.log('Seeded demo data into an empty database (SEED_DEMO=true).');
  }
  await provisionOnStart(persistence, store, process.env);

  const auth = cfg.authMode === 'session' ? new AuthService(db, store, defaultAuthSettings(cfg.authEncryptionKey!, { sessionIdleMs: cfg.sessionIdleMs, sessionAbsoluteMs: cfg.sessionAbsoluteMs })) : undefined;
  gate.ready(createApp(store, { persistence, auth, config: cfg }));
  console.log('Ready.');

  const shutdown = (signal: string) => {
    console.log(`${signal} received: finishing in-flight requests, then releasing the database.`);
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 20_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
