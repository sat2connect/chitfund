import type { Db, Queryable } from '../db/Db.js';
import type { Store } from '../repositories/store.js';
import { CONFIG_KEYS, TABLES, collectionOf, type TableSpec } from './tables.js';

type Entity = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Extra SQL (credentials, sessions, ...) that must commit or roll back together with the request's business changes. */
export class UnitOfWork {
  readonly statements: { text: string; params: unknown[] }[] = [];
  exec(text: string, params: unknown[] = []) {
    this.statements.push({ text, params });
  }
}

interface Snap {
  json: string;
  child?: string;
}
interface Change {
  spec: TableSpec;
  entity: Entity;
  json: string;
  prevChild?: string;
}

/**
 * Durable, transactional persistence for the application's working state.
 *
 *  - `load()` reads every row into the in-memory `Store` the services operate on.
 *  - `commit()` writes exactly what a request changed, in ONE database transaction, before the client is answered.
 *  - `restore()` puts memory back to the last committed state if a request failed or its commit was rejected.
 *
 * Because services work on memory, this design assumes ONE backend process writing at a time (enforced with an
 * advisory lock at start-up) and a data set that fits in memory. See docs/persistence.md for the scale-out path.
 */
export class PersistentStore {
  private snaps = new Map<string, Map<string, Snap>>();
  private counterSnap: Record<string, number> = {};
  private configSnap = new Map<string, string>();
  private ready = false;
  /** Set if memory could not be restored after a failure: the process must be restarted before serving more requests. */
  poisoned = false;

  constructor(readonly db: Db, readonly store: Store) {}

  private assertReady() {
    if (!this.ready) throw new Error('PersistentStore used before load() or initialise()');
  }

  /** First start of a brand-new database: treat nothing as committed, so the first commit() writes everything in memory. */
  initialise(): void {
    this.snaps.clear();
    this.counterSnap = {};
    this.configSnap.clear();
    this.ready = true;
  }

  async load(): Promise<void> {
    for (const spec of TABLES) {
      const rows = await this.db.query<{ data: Entity }>(`select data from ${spec.table} order by seq`);
      const entities = rows.rows.map((r) => r.data);
      if (spec.child) await spec.child.attach(entities, async (sql) => (await this.db.query<{ data: Entity }>(sql)).rows.map((r) => r.data));
      const arr = collectionOf(this.store, spec.key);
      arr.length = 0;
      arr.push(...entities);
    }
    for (const k of Object.keys(this.store.counters)) delete this.store.counters[k];
    for (const r of (await this.db.query<{ prefix: string; value: string }>('select prefix, value from counters')).rows) this.store.counters[r.prefix] = Number(r.value);
    for (const r of (await this.db.query<{ key: string; value: unknown }>('select key, value from app_config')).rows) {
      if ((CONFIG_KEYS as readonly string[]).includes(r.key)) Object.assign((this.store as unknown as Record<string, object>)[r.key]!, r.value);
    }
    this.snapshotAll();
    this.ready = true;
  }

  private snapshotAll() {
    this.snaps.clear();
    for (const spec of TABLES) {
      const m = new Map<string, Snap>();
      for (const e of collectionOf(this.store, spec.key)) m.set(e.id, { json: JSON.stringify(e), child: spec.child?.fingerprint(e) });
      this.snaps.set(spec.table, m);
    }
    this.counterSnap = { ...this.store.counters };
    this.configSnap.clear();
    for (const k of CONFIG_KEYS) this.configSnap.set(k, JSON.stringify((this.store as unknown as Record<string, unknown>)[k]));
  }

  private diff() {
    const changes: Change[] = [];
    for (const spec of TABLES) {
      const prev = this.snaps.get(spec.table) ?? new Map<string, Snap>();
      for (const e of collectionOf(this.store, spec.key)) {
        const json = JSON.stringify(e);
        const p = prev.get(e.id);
        if (!p) changes.push({ spec, entity: e, json });
        else if (p.json !== json) {
          if (spec.appendOnly) continue; // append-only rows are never rewritten
          changes.push({ spec, entity: e, json, prevChild: p.child });
        }
      }
    }
    const counters = Object.entries(this.store.counters).filter(([k, v]) => this.counterSnap[k] !== v);
    const configs = CONFIG_KEYS.map((k) => [k, JSON.stringify((this.store as unknown as Record<string, unknown>)[k])] as const).filter(([k, j]) => this.configSnap.get(k) !== j);
    return { changes, counters, configs };
  }

  /** True when memory differs from what is committed. */
  isDirty(): boolean {
    this.assertReady();
    const d = this.diff();
    return d.changes.length > 0 || d.counters.length > 0 || d.configs.length > 0;
  }

  async commit(uow: UnitOfWork = new UnitOfWork()): Promise<void> {
    this.assertReady();
    const { changes, counters, configs } = this.diff();
    if (!changes.length && !counters.length && !configs.length && !uow.statements.length) return;

    await this.db.tx(async (q) => {
      for (const c of changes) await this.writeEntity(q, c);
      for (const [prefix, value] of counters) {
        await q.query('insert into counters (prefix, value) values ($1, $2) on conflict (prefix) do update set value = excluded.value', [prefix, value]);
      }
      for (const [key, json] of configs) {
        await q.query('insert into app_config (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, json]);
      }
      for (const st of uow.statements) await q.query(st.text, st.params);
    });

    // Only after the transaction committed does memory become the new baseline.
    for (const c of changes) {
      const m = this.snaps.get(c.spec.table) ?? this.snaps.set(c.spec.table, new Map()).get(c.spec.table)!;
      m.set(c.entity.id, { json: c.json, child: c.spec.child?.fingerprint(c.entity) });
    }
    for (const [k, v] of counters) this.counterSnap[k] = v;
    for (const [k, j] of configs) this.configSnap.set(k, j);
  }

  private async writeEntity(q: Queryable, c: Change) {
    const { spec, entity } = c;
    const cols = Object.keys(spec.columns);
    const values = cols.map((col) => spec.columns[col]!(entity));
    const data = JSON.stringify(spec.child ? spec.child.strip(entity) : entity);
    const names = ['id', ...cols, 'data'];
    const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
    const text = spec.appendOnly
      ? `insert into ${spec.table} (${names.join(', ')}) values (${placeholders}) on conflict (id) do nothing`
      : `insert into ${spec.table} (${names.join(', ')}) values (${placeholders})
         on conflict (id) do update set ${[...cols, 'data'].map((n) => `${n} = excluded.${n}`).join(', ')},
         version = ${spec.table}.version + 1, updated_at = now()`;
    await q.query(text, [entity.id, ...values, data]);
    if (spec.child) for (const op of spec.child.write(entity, c.prevChild)) await q.query(op.text, op.params);
  }

  /** Discards uncommitted changes in memory, returning to the last committed state. */
  restore(): void {
    this.assertReady();
    for (const spec of TABLES) {
      const prev = this.snaps.get(spec.table) ?? new Map<string, Snap>();
      const arr = collectionOf(this.store, spec.key);
      const same = arr.length === prev.size && arr.every((e) => prev.get(e.id)?.json === JSON.stringify(e));
      if (same) continue;
      const restored = [...prev.values()].map((s) => JSON.parse(s.json) as Entity);
      arr.length = 0;
      arr.push(...restored);
    }
    for (const k of Object.keys(this.store.counters)) delete this.store.counters[k];
    Object.assign(this.store.counters, this.counterSnap);
    for (const k of CONFIG_KEYS) {
      const saved = this.configSnap.get(k);
      if (!saved) continue; // nothing committed yet for this key
      const target = (this.store as unknown as Record<string, Record<string, unknown>>)[k]!;
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, JSON.parse(saved));
    }
  }
}
