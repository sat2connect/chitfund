import type { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable, QueryResult } from './Db.js';

type Runner = Pick<PGlite, 'query' | 'exec'>;

const wrap = (r: Runner): Queryable => ({
  async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    if (!params || params.length === 0) {
      // exec supports multi-statement scripts such as migrations
      const results = await r.exec(text);
      const last = results[results.length - 1];
      return { rows: (last?.rows ?? []) as T[], rowCount: last?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const res = await r.query(text, params as unknown[]);
    return { rows: res.rows as T[], rowCount: res.affectedRows ?? res.rows.length };
  },
});

/**
 * Embedded real PostgreSQL engine (WebAssembly). Used for tests, and for local runs without a server.
 * It is a single connection, so it is not a production database.
 */
export const createPgliteDb = (db: PGlite): Db => ({
  kind: 'pglite',
  ...wrap(db),
  tx: (fn) => db.transaction((t) => fn(wrap(t as unknown as Runner))),
  async acquireWriterLock() {
    return true; // one process owns the embedded database
  },
  async ping() {
    await db.query('select 1');
  },
  async close() {
    await db.close();
  },
});
