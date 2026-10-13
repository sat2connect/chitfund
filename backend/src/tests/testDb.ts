import { PGlite } from '@electric-sql/pglite';
import { createPgliteDb } from '../db/pgliteDb.js';
import { migrate, resetDatabase } from '../db/migrate.js';
import type { Db } from '../db/Db.js';

let shared: { raw: PGlite; db: Db } | undefined;

/**
 * One embedded PostgreSQL engine per test file (starting it costs about a second);
 * each test gets a clean, fully migrated schema.
 */
export async function freshDb(): Promise<Db> {
  if (!shared) {
    const raw = await PGlite.create();
    shared = { raw, db: createPgliteDb(raw) };
    await migrate(shared.db);
    return shared.db;
  }
  await resetDatabase(shared.db);
  return shared.db;
}

export async function closeTestDb(): Promise<void> {
  await shared?.db.close();
  shared = undefined;
}

/** Physical backup of the live database, restored into a second, independent engine (a recovery drill). */
export async function backupAndRestore(): Promise<Db> {
  if (!shared) throw new Error('no database to back up');
  const file = await shared.raw.dumpDataDir('none');
  const copy = await PGlite.create({ loadDataDir: file });
  return createPgliteDb(copy);
}