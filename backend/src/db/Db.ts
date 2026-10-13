/** Minimal database port. Production uses node-postgres; tests use the embedded PostgreSQL engine (PGlite). */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  readonly kind: 'pg' | 'pglite';
  /** Runs fn in one transaction: commits if it resolves, rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /**
   * Takes a session-level advisory lock so only one backend process writes at a time.
   * Returns false if another process already holds it.
   */
  acquireWriterLock(key: number): Promise<boolean>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Postgres error codes the application reacts to. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  RESTRICT_VIOLATION: '23001',
  SERIALIZATION_FAILURE: '40001',
} as const;

export const pgErrorCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;
