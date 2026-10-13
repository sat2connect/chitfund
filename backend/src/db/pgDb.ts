import pg from 'pg';
import type { Db, Queryable, QueryResult } from './Db.js';

/** node-postgres implementation. SSL and pool size come from configuration, never from code. */
export const createPgDb = (opts: { connectionString: string; ssl?: boolean; max?: number }): Db => {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl ? { rejectUnauthorized: true } : undefined,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client error must not crash the process; the next query reports the real problem.
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));

  let lockClient: pg.PoolClient | undefined;

  const wrap = (c: { query: (t: string, p?: unknown[]) => Promise<pg.QueryResult> }): Queryable => ({
    async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      const r = await c.query(text, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  });

  return {
    kind: 'pg',
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(wrap(client));
        await client.query('commit');
        return result;
      } catch (e) {
        try {
          await client.query('rollback');
        } catch {
          /* connection already broken: the original error is the useful one */
        }
        throw e;
      } finally {
        client.release();
      }
    },
    async acquireWriterLock(key) {
      lockClient ??= await pool.connect(); // held for the process lifetime; released on exit or crash
      const r = await lockClient.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [key]);
      return r.rows[0]?.ok === true;
    },
    async ping() {
      await pool.query('select 1');
    },
    async close() {
      lockClient?.release();
      await pool.end();
    },
  };
};
