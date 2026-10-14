import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PG, pgErrorCode, type Db } from '../db/Db.js';
import { MIGRATIONS_DIR, migrate } from '../db/migrate.js';
import { closeTestDb, freshDb } from './testDb.js';

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterAll(closeTestDb);

/** Runs statements in one transaction and returns the Postgres error code if it fails. */
const failure = async (fn: (q: { query: Db['query'] }) => Promise<unknown>) => {
  try {
    await db.tx(async (q) => { await fn(q); });
    return undefined;
  } catch (e) {
    return pgErrorCode(e);
  }
};

const J = '{}';
async function baseRows(q: { query: Db['query'] }) {
  await q.query(`insert into accounts (id, code, name, type, active, data) values ('ACC-1','1010','Cash','ASSET',true,$1), ('ACC-2','2100','Liab','LIABILITY',true,$1)`, [J]);
  await q.query(`insert into accounting_periods (id, name, start_date, end_date, status, data) values ('PER-1','Dec','2026-12-01','2026-12-31','OPEN',$1)`, [J]);
}
const journal = (id: string, status: string, extra = '') =>
  `insert into journals (id, number, journal_date, period_id, status, memo, simulated, source_type, revision, created_by, data${extra ? ', ' + extra.split('=')[0] : ''})
   values ('${id}', 'JV-${id}', '2026-12-01', 'PER-1', '${status}', 'm', false, 'MANUAL', 1, 'u', '{"lines":[]}'${extra ? ', ' + extra.split('=')[1] : ''})`;
const line = (jid: string, no: number, acc: string, debit: number, credit: number) =>
  `insert into journal_lines (journal_id, line_no, account_id, debit_paise, credit_paise) values ('${jid}', ${no}, '${acc}', ${debit}, ${credit})`;

describe('migrations', () => {
  it('applies all migrations once and is a no-op the second time', async () => {
    const second = await migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(['001_core.sql', '002_auth.sql', '003_group_approved_state.sql']);
    const tables = (await db.query<{ n: string }>(`select table_name n from information_schema.tables where table_schema='public'`)).rows.map((r) => r.n);
    expect(tables).toEqual(expect.arrayContaining(['journals', 'journal_lines', 'audit_log', 'bids', 'sessions', 'user_credentials', 'schema_migrations']));
  });

  it('refuses to run when an applied migration file has been edited', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db, dir);
    writeFileSync(path.join(dir, '001_core.sql'), readFileSync(path.join(dir, '001_core.sql'), 'utf8') + '\n-- tampered');
    await expect(migrate(db, dir)).rejects.toThrow(/was changed after it was applied/);
  });

  it('applies a new migration on top of existing ones', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    writeFileSync(path.join(dir, '003_extra.sql'), 'create table extra_probe (id int primary key);');
    const r = await migrate(db, dir);
    expect(r.applied).toEqual(['003_extra.sql']);
    expect((await db.query('select count(*)::int c from extra_probe')).rows[0]).toEqual({ c: 0 });
  });
});

describe('append-only logs', () => {
  it('lets audit entries be written but never changed, deleted or truncated', async () => {
    await db.query(`insert into audit_log (id, at, actor_id, action, entity_type, entity_id, data) values ('AUD-1', now(), 'u', 'a', 't', 'e', '{}')`);
    expect(await failure((q) => q.query(`update audit_log set action = 'x'`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`delete from audit_log`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`truncate audit_log`))).toBe(PG.RESTRICT_VIOLATION);
    expect((await db.query('select count(*)::int c from audit_log')).rows[0]).toEqual({ c: 1 });
  });

  it('keeps the bid log append-only and its sequence unique', async () => {
    await db.tx(async (q) => {
      await q.query(`insert into branches (id, name, data) values ('CHN','Chennai','{}')`);
      await q.query(`insert into customers (id, name, phone, branch_id, kyc_status, membership_status, data) values ('CU-1','A','9000000001','CHN','VERIFIED','ACTIVE','{}')`);
      await q.query(`insert into schemes (id, code, data) values ('S1','S','{}')`);
      await q.query(`insert into scheme_versions (id, scheme_id, version_no, status, revision, data) values ('V1','S1',1,'PUBLISHED',1,'{}')`);
      await q.query(`insert into chit_groups (id, code, scheme_id, scheme_version_id, branch_id, status, data) values ('G1','G','S1','V1','CHN','ACTIVE','{}')`);
      await q.query(`insert into auctions (id, group_id, branch_id, cycle_no, status, scheduled_open_at, scheduled_close_at, revision, data) values ('A1','G1','CHN',1,'OPEN','2026-12-01T05:00Z','2026-12-01T07:00Z',1,'{}')`);
      await q.query(`insert into bids (id, auction_id, ticket_no, customer_id, amount_paise, submitted_by, server_timestamp, sequence, client_request_id, data) values ('B1','A1',1,'CU-1',500,'u',now(),1,'req-1','{}')`);
    });
    expect(await failure((q) => q.query(`update bids set amount_paise = 999`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`delete from bids`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`insert into bids (id, auction_id, ticket_no, customer_id, amount_paise, submitted_by, server_timestamp, sequence, client_request_id, data) values ('B2','A1',2,'CU-1',600,'u',now(),1,'req-2','{}')`))).toBe(PG.UNIQUE_VIOLATION);
    expect(await failure((q) => q.query(`insert into auctions (id, group_id, branch_id, cycle_no, status, scheduled_open_at, scheduled_close_at, revision, data) values ('A2','G1','CHN',1,'SCHEDULED','2026-12-02T05:00Z','2026-12-02T07:00Z',1,'{}')`))).toBe(PG.UNIQUE_VIOLATION);
  });
});

describe('double-entry journals', () => {
  it('accepts a balanced posted journal', async () => {
    expect(await failure(async (q) => {
      await baseRows(q);
      await q.query(journal('J1', 'POSTED'));
      await q.query(line('J1', 1, 'ACC-1', 500, 0));
      await q.query(line('J1', 2, 'ACC-2', 0, 500));
    })).toBeUndefined();
  });

  it('rejects an unbalanced, empty or single-line posted journal at commit', async () => {
    expect(await failure(async (q) => { await baseRows(q); await q.query(journal('J1', 'POSTED')); await q.query(line('J1', 1, 'ACC-1', 500, 0)); await q.query(line('J1', 2, 'ACC-2', 0, 400)); })).toBe(PG.CHECK_VIOLATION);
    expect(await failure(async (q) => { await baseRows(q); await q.query(journal('J1', 'POSTED')); })).toBe(PG.CHECK_VIOLATION);
    expect(await failure(async (q) => { await baseRows(q); await q.query(journal('J1', 'POSTED')); await q.query(line('J1', 1, 'ACC-1', 500, 0)); })).toBe(PG.CHECK_VIOLATION);
  });

  it('allows an unbalanced draft but blocks it from being posted', async () => {
    await db.tx(async (q) => { await baseRows(q); await q.query(journal('J1', 'DRAFT')); await q.query(line('J1', 1, 'ACC-1', 500, 0)); });
    expect(await failure((q) => q.query(`update journals set status = 'POSTED' where id = 'J1'`))).toBe(PG.CHECK_VIOLATION);
  });

  it('rejects a line with both or neither side, or a negative amount', async () => {
    const run = (d: number, c: number) => failure(async (q) => { await baseRows(q); await q.query(journal('J1', 'DRAFT')); await q.query(line('J1', 1, 'ACC-1', d, c)); });
    expect(await run(5, 5)).toBe(PG.CHECK_VIOLATION);
    expect(await run(0, 0)).toBe(PG.CHECK_VIOLATION);
    expect(await run(-5, 0)).toBe(PG.CHECK_VIOLATION);
  });

  it('makes a posted journal immutable: no edits, deletes, or line changes', async () => {
    await db.tx(async (q) => {
      await baseRows(q);
      await q.query(journal('J1', 'POSTED'));
      await q.query(line('J1', 1, 'ACC-1', 500, 0));
      await q.query(line('J1', 2, 'ACC-2', 0, 500));
    });
    expect(await failure((q) => q.query(`update journals set memo = 'changed' where id = 'J1'`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`update journals set journal_date = '2026-12-05' where id = 'J1'`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`update journals set status = 'DRAFT' where id = 'J1'`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`delete from journals where id = 'J1'`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`update journal_lines set debit_paise = 900 where journal_id = 'J1' and line_no = 1`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`delete from journal_lines where journal_id = 'J1'`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure(async (q) => { await q.query(line('J1', 3, 'ACC-1', 10, 0)); await q.query(line('J1', 4, 'ACC-2', 0, 10)); })).toBe(PG.RESTRICT_VIOLATION);
  });

  it('permits only the POSTED -> REVERSED transition, and only with a reversing journal recorded', async () => {
    await db.tx(async (q) => {
      await baseRows(q);
      await q.query(journal('J1', 'POSTED'));
      await q.query(line('J1', 1, 'ACC-1', 500, 0));
      await q.query(line('J1', 2, 'ACC-2', 0, 500));
    });
    expect(await failure((q) => q.query(`update journals set status = 'REVERSED' where id = 'J1'`))).toBe(PG.RESTRICT_VIOLATION);
    expect(await failure((q) => q.query(`update journals set status = 'REVERSED', reversed_by = 'J2' where id = 'J1'`))).toBeUndefined();
    expect(await failure((q) => q.query(`update journals set status = 'POSTED' where id = 'J1'`))).toBe(PG.RESTRICT_VIOLATION);
  });

  it('lets a draft journal have its lines rewritten before posting', async () => {
    expect(await failure(async (q) => {
      await baseRows(q);
      await q.query(journal('J1', 'DRAFT'));
      await q.query(line('J1', 1, 'ACC-1', 500, 0));
      await q.query(`delete from journal_lines where journal_id = 'J1'`);
      await q.query(line('J1', 1, 'ACC-1', 700, 0));
      await q.query(line('J1', 2, 'ACC-2', 0, 700));
      await q.query(`update journals set status = 'POSTED' where id = 'J1'`);
    })).toBeUndefined();
  });
});

describe('other integrity constraints', () => {
  async function customer(q: { query: Db['query'] }) {
    await q.query(`insert into branches (id, name, data) values ('CHN','Chennai','{}')`);
    await q.query(`insert into customers (id, name, phone, branch_id, kyc_status, membership_status, data) values ('CU-1','A','9000000001','CHN','VERIFIED','ACTIVE','{}')`);
  }
  const payment = (id: string, status: string, ref: string, mode = 'UPI', simulated = false) =>
    `insert into payments (id, customer_id, branch_id, mode, amount_paise, reference, received_date, status, simulated, recorded_by, reconciliation_status, receipt_id, data)
     values ('${id}','CU-1','CHN','${mode}',100,'${ref}','2026-12-01','${status}',${simulated},'u','PENDING','R-${id}','{}')`;

  it('rejects overpaying an instalment and negative balances', async () => {
    const base = async (q: { query: Db['query'] }) => {
      await customer(q);
      await q.query(`insert into schemes (id, code, data) values ('S1','S','{}')`);
      await q.query(`insert into scheme_versions (id, scheme_id, version_no, status, revision, data) values ('V1','S1',1,'PUBLISHED',1,'{}')`);
      await q.query(`insert into chit_groups (id, code, scheme_id, scheme_version_id, branch_id, status, data) values ('G1','G','S1','V1','CHN','ACTIVE','{}')`);
    };
    const ins = (paid: number) => `insert into instalments (id, group_id, customer_id, branch_id, ticket_no, instalment_no, due_date, amount_paise, paid_paise, data) values ('I1','G1','CU-1','CHN',1,1,'2026-12-01',1000,${paid},'{}')`;
    expect(await failure(async (q) => { await base(q); await q.query(ins(1001)); })).toBe(PG.CHECK_VIOLATION);
    expect(await failure(async (q) => { await base(q); await q.query(ins(-1)); })).toBe(PG.CHECK_VIOLATION);
    expect(await failure(async (q) => { await base(q); await q.query(ins(1000)); })).toBeUndefined();
  });

  it('keeps one live payment per reference and mode, and frees it on reversal', async () => {
    await db.tx(customer);
    await db.query(payment('P1', 'SUCCESSFUL', 'UTR-1'));
    expect(await failure((q) => q.query(payment('P2', 'SUCCESSFUL', 'utr-1')))).toBe(PG.UNIQUE_VIOLATION);
    expect(await failure((q) => q.query(payment('P3', 'SUCCESSFUL', 'UTR-1', 'CHEQUE')))).toBeUndefined();
    await db.query(`update payments set status = 'REVERSED' where id = 'P1'`);
    expect(await failure((q) => q.query(payment('P4', 'SUCCESSFUL', 'UTR-1')))).toBeUndefined();
    expect(await failure((q) => q.query(payment('P5', 'SUCCESSFUL', 'SIM-1', 'ONLINE_SIMULATED', true)))).toBeUndefined();
  });

  it('rejects a payment whose customer does not exist (checked at commit)', async () => {
    expect(await failure(async (q) => {
      await q.query(`insert into branches (id, name, data) values ('CHN','Chennai','{}')`);
      await q.query(payment('P1', 'SUCCESSFUL', 'X'));
    })).toBe(PG.FOREIGN_KEY_VIOLATION);
  });

  it('never lets a request decide its own approval', async () => {
    const ins = (checker: string | null) => `insert into approvals (id, entity_type, entity_id, maker_id, checker_id, status, submitted_revision, data) values ('APR-1','JOURNAL','J1','u-maker',${checker ? `'${checker}'` : 'null'},'APPROVED',1,'{}')`;
    expect(await failure((q) => q.query(ins('u-maker')))).toBe(PG.CHECK_VIOLATION);
    expect(await failure((q) => q.query(ins('u-checker')))).toBeUndefined();
  });

  it('allows a single payout per auction and a single use of a disbursement reference', async () => {
    await db.tx(async (q) => {
      await customer(q);
      await q.query(`insert into schemes (id, code, data) values ('S1','S','{}')`);
      await q.query(`insert into scheme_versions (id, scheme_id, version_no, status, revision, data) values ('V1','S1',1,'PUBLISHED',1,'{}')`);
      await q.query(`insert into chit_groups (id, code, scheme_id, scheme_version_id, branch_id, status, data) values ('G1','G','S1','V1','CHN','ACTIVE','{}')`);
      for (const n of [1, 2]) await q.query(`insert into auctions (id, group_id, branch_id, cycle_no, status, scheduled_open_at, scheduled_close_at, revision, data) values ('A${n}','G1','CHN',${n},'APPROVED','2026-12-01T05:00Z','2026-12-01T07:00Z',1,'{}')`);
    });
    const payout = (id: string, auction: string, ref: string | null) => `insert into payouts (id, auction_id, group_id, customer_id, branch_id, status, amount_paise, disbursement_reference, reconciliation_status, created_by, data) values ('${id}','${auction}','G1','CU-1','CHN','PAID',100,${ref ? `'${ref}'` : 'null'},'PENDING','u','{}')`;
    await db.query(payout('PY1', 'A1', 'UTR-A'));
    expect(await failure((q) => q.query(payout('PY2', 'A1', 'UTR-B')))).toBe(PG.UNIQUE_VIOLATION);
    expect(await failure((q) => q.query(payout('PY3', 'A2', 'utr-a')))).toBe(PG.UNIQUE_VIOLATION);
    expect(await failure((q) => q.query(payout('PY4', 'A2', 'UTR-C')))).toBeUndefined();
  });
});
