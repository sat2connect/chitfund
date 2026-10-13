import { AuthService, defaultAuthSettings } from './auth/authService.js';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createPgDb } from './db/pgDb.js';
import { migrate, pendingMigrations } from './db/migrate.js';
import { PersistentStore } from './persistence/persistentStore.js';
import { createEmptyStore } from './repositories/store.js';
import { seedDemoData } from './seed/crmSeed.js';

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

  const db = createPgDb({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl, max: cfg.databasePoolMax });
  if (!(await db.acquireWriterLock(WRITER_LOCK_KEY))) {
    console.error('Another backend process already holds the writer lock for this database. Refusing to start.');
    process.exit(1);
  }

  if (process.env.AUTO_MIGRATE === 'true' && !cfg.isProduction) {
    const r = await migrate(db);
    if (r.applied.length) console.log('Applied migrations:', r.applied.join(', '));
  }
  const pending = await pendingMigrations(db);
  if (pending.length) {
    console.error(`Database schema is out of date (pending: ${pending.join(', ')}). Run "npm run migrate" first.`);
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

  const auth = cfg.authMode === 'session' ? new AuthService(db, store, defaultAuthSettings(cfg.authEncryptionKey!, { sessionIdleMs: cfg.sessionIdleMs, sessionAbsoluteMs: cfg.sessionAbsoluteMs })) : undefined;
  const app = createApp(store, { persistence, auth, config: cfg });
  const server = app.listen(cfg.port, () => console.log(`Backend listening on port ${cfg.port} (${cfg.env}, ${cfg.authMode} auth, PostgreSQL)`));

  const shutdown = (signal: string) => {
    console.log(`${signal} received: finishing in-flight requests and closing.`);
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
