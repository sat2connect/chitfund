import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/index.js';
import { createPgDb } from '../db/pgDb.js';
import { PersistentStore } from '../persistence/persistentStore.js';
import { createEmptyStore } from '../repositories/store.js';

export const connect = () => {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL is required');
  return { cfg, db: createPgDb({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl, max: 2 }) };
};

export const connectWithStore = async () => {
  const c = connect();
  const store = createEmptyStore();
  const persist = new PersistentStore(c.db, store);
  await persist.load();
  return { ...c, store, persist };
};

/** True when this module is the program being run (not merely imported by a test). */
export const isMain = (metaUrl: string) => process.argv[1] !== undefined && metaUrl === pathToFileURL(process.argv[1]).href;

export const run = (fn: () => Promise<void>) =>
  fn().then(() => process.exit(0), (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });