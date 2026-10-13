import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './Db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** backend/migrations, whether running from src/db (tsx) or dist/db (compiled). */
export const MIGRATIONS_DIR = path.resolve(here, '../../migrations');

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Applies pending SQL migrations in order, each in its own transaction.
 * An already-applied migration whose file has changed is an error: history must not be rewritten.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  await db.query(`create table if not exists schema_migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const done = new Map((await db.query<{ version: string; checksum: string }>('select version, checksum from schema_migrations')).rows.map((r) => [r.version, r.checksum]));
  const result: MigrationResult = { applied: [], alreadyApplied: [] };

  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const checksum = sha(sql);
    const prior = done.get(file);
    if (prior) {
      if (prior !== checksum) throw new Error(`Migration ${file} was changed after it was applied. Create a new migration instead.`);
      result.alreadyApplied.push(file);
      continue;
    }
    await db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(727001)'); // two deployers cannot migrate at once
      await q.query(sql);
      await q.query('insert into schema_migrations (version, checksum) values ($1, $2)', [file, checksum]);
    });
    result.applied.push(file);
  }
  return result;
}

/** Test/dev helper: wipes the schema and re-applies all migrations. Never call against real data. */
export async function resetDatabase(db: Db): Promise<void> {
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db);
}

/** Migration files that have not been applied yet (used at start-up to refuse an out-of-date schema). */
export async function pendingMigrations(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const exists = await db.query<{ t: string | null }>("select to_regclass('public.schema_migrations') as t");
  const done = new Set(exists.rows[0]?.t ? (await db.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version) : []);
  return readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort().filter((f) => !done.has(f));
}