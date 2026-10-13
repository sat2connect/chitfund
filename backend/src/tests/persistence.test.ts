import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/Db.js';
import { PersistentStore } from '../persistence/persistentStore.js';
import { createEmptyStore, type Store } from '../repositories/store.js';
import { createSeededStore } from '../seed/crmSeed.js';
import { HOUR, T0, activeGroup, canon, installClock, staff, stateOf, uniq, type Clock } from './scenario.js';
import { backupAndRestore, closeTestDb, freshDb } from './testDb.js';

let db: Db;
let store: Store;
let persist: PersistentStore;
let app: ReturnType<typeof createApp>;
let clock: Clock;
let s: ReturnType<typeof staff>;

beforeEach(async () => {
  db = await freshDb();
  clock = { ms: T0 };
  store = createSeededStore();
  installClock(store, clock);
  persist = new PersistentStore(db, store);
  persist.initialise(); // brand-new database
  await persist.commit(); // first start: the seed is written to the database
  app = createApp(store, { persistence: persist });
  s = staff(app);
});
afterAll(closeTestDb);

/** What a restarted backend would see: a brand-new store loaded only from the database. */
async function restart(): Promise<Store> {
  const fresh = createEmptyStore();
  installClock(fresh, clock);
  await new PersistentStore(db, fresh).load();
  return fresh;
}
const count = async (table: string) => (await db.query<{ c: number }>(`select count(*)::int c from ${table}`)).rows[0]!.c;

describe('durability', () => {
  it('stores the seed and reloads it exactly', async () => {
    const reloaded = await restart();
    expect(canon(stateOf(reloaded))).toBe(canon(stateOf(store)));
    expect(await count('users')).toBe(store.users.length);
  });

  it('survives a restart after a complete business cycle', async () => {
    const { groupId, cs, members } = await activeGroup(app, s);

    // collections: cash (partial), UPI, a simulated online attempt, and a late duplicate callback
    const cash = (await s.col.post('/payments/offline', { customerId: cs[0], mode: 'CASH', amountPaise: 4000000, clientRequestId: uniq('c') })).body.payment;
    const upi = (await s.col.post('/payments/offline', { customerId: cs[1], mode: 'UPI', reference: 'UTR-DUR-1', amountPaise: 10000000, clientRequestId: uniq('u') })).body.payment;
    const att = await members[2]!.post('/portal/payment-attempts', { amountPaise: 3000000 });
    expect((await s.fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-durable-1', outcome: 'SUCCESS' })).status).toBe(200);
    expect((await s.fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-durable-2', outcome: 'SUCCESS' })).status).toBe(409);

    // reconciliation and an approved reversal
    await s.fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 10000000, reference: 'UTR-DUR-1', direction: 'CREDIT' }] });
    const line = (await s.fm.get('/reconciliation/bank-lines')).body.items[0];
    await s.fm.post('/reconciliation/match', { paymentId: upi.id, bankLineId: line.id });
    const rev = await s.both.post(`/payments/${cash.id}/reversal-request`, { reason: 'Entered against wrong member' });
    await s.fc.post(`/approvals/${rev.body.id}/decision`, { decision: 'APPROVED' });

    // a manual journal, approved and then reversed
    const acc = (code: string) => store.accounts.find((a) => a.code === code)!.id;
    const j = (await s.fm.post('/accounting/journals', { date: '2026-12-01', memo: 'Office rent', lines: [{ accountId: acc('5100'), debitPaise: 500000 }, { accountId: acc('1020'), creditPaise: 500000 }] })).body;
    const sub = await s.fm.post(`/accounting/journals/${j.id}/submit`);
    await s.fc.post(`/approvals/${sub.body.approvalRequests[0].id}/decision`, { decision: 'APPROVED' });
    const jr = await s.fm.post(`/accounting/journals/${j.id}/reversal-request`, { reason: 'Wrong account' });
    await s.fc.post(`/approvals/${jr.body.request.id}/decision`, { decision: 'APPROVED' });

    // an auction: member bids, result approved, payout paid and reconciled
    const auc = await s.officer.post('/auctions', {
      groupId, cycleNo: 1, scheduledOpenAt: new Date(clock.ms + HOUR).toISOString(), scheduledCloseAt: new Date(clock.ms + 3 * HOUR).toISOString(),
      winnerSelection: 'HIGHEST_BID', tieBreak: 'EARLIEST_BID', bidPolicy: 'SINGLE', excludePriorWinners: true, requireNoOverdue: false,
    });
    await s.officer.post(`/auctions/${auc.body.id}/ready`);
    clock.ms += HOUR + 1000;
    await members[0]!.post(`/auctions/${auc.body.id}/bids`, { ticketNo: 1, amountPaise: 500000, clientRequestId: uniq('b') });
    await members[1]!.post(`/auctions/${auc.body.id}/bids`, { ticketNo: 2, amountPaise: 900000, clientRequestId: uniq('b') });
    clock.ms += 3 * HOUR;
    await s.officer.post(`/auctions/${auc.body.id}/compute`);
    await s.officer.post(`/auctions/${auc.body.id}/validate`);
    await s.officer.post(`/auctions/${auc.body.id}/submit`);
    const areq = (await s.head.get('/approvals?scope=queue&type=AUCTION_RESULT')).body.items[0];
    await s.head.post(`/approvals/${areq.id}/decision`, { decision: 'APPROVED' });
    const po = (await s.fm.post('/payouts', { auctionId: auc.body.id, amountPaise: 20000000, amountBasis: 'Calc sheet CS-1 (manual entry)', clientRequestId: uniq('p') })).body.payout;
    await s.fm.post(`/payouts/${po.id}/submit-review`);
    const doc = (await s.maker.get(`/payouts/${po.id}`)).body.documents[0];
    await s.maker.post(`/payouts/${po.id}/documents/${doc.id}/confirm`, { reference: 'FORM-1' });
    const preq = (await s.maker.post(`/payouts/${po.id}/request-approval`)).body.approvalRequests[0].id;
    await s.fc.post(`/approvals/${preq}/decision`, { decision: 'APPROVED' });
    await s.fm.post(`/payouts/${po.id}/initiate`, { channel: 'BANK_TRANSFER' });
    await s.fm.post(`/payouts/${po.id}/disbursement`, { reference: 'UTR-PAYOUT-1', paidDate: '2026-12-01' });
    await s.fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 20000000, reference: 'UTR-PAYOUT-1', direction: 'DEBIT' }] });
    const dq = (await s.fm.get('/payouts/reconciliation')).body.items[0];
    await s.fm.post('/payouts/reconciliation/match', { payoutId: po.id, bankLineId: dq.suggestion.bankLineId });

    // follow-up, dispute and a support conversation
    const lead = (await s.crm.get('/leads')).body.items[0];
    const fu = await s.crm.post(`/leads/${lead.id}/follow-ups`, { dueAt: '2030-01-01', note: 'Call back' });
    await s.crm.post(`/follow-ups/${fu.body.id}/complete`);
    await members[2]!.post(`/auctions/${auc.body.id}/disputes`, { reason: 'I could not see the bid screen' });
    const sc = (await members[0]!.post('/portal/support-cases', { category: 'PAYMENT', subject: 'Receipt question', description: 'Where is my receipt?', clientRequestId: uniq('s') })).body.case;
    await s.crm.post(`/support-cases/${sc.id}/assign`);
    await s.crm.post(`/support-cases/${sc.id}/messages`, { body: 'Checking.', internal: true });
    await s.crm.post(`/support-cases/${sc.id}/messages`, { body: 'Receipt re-sent.' });

    // everything the services built in memory is exactly what a restarted backend loads
    const reloaded = await restart();
    expect(canon(stateOf(reloaded))).toBe(canon(stateOf(store)));

    // spot-check database-level facts independent of the application
    expect(await count('journals')).toBe(store.journals.length);
    expect(await count('audit_log')).toBe(store.audit.length);
    expect((await db.query<{ n: number }>('select count(*)::int n from journal_lines')).rows[0]!.n).toBe(store.journals.reduce((a, x) => a + x.lines.length, 0));
    expect(await count('bids')).toBe(2);
    expect(store.journals.filter((x) => x.status === 'REVERSED').length).toBeGreaterThanOrEqual(2);
    expect(reloaded.auctions[0]!.bids.map((b) => b.sequence)).toEqual([1, 2]);

    // the reloaded backend keeps working: ids continue without collisions and books still balance
    const next = reloaded.nextId('LD');
    expect(reloaded.leads.some((l) => l.id === next)).toBe(false);
    const reloadedPersist = new PersistentStore(db, reloaded);
    await reloadedPersist.load();
    const app2 = createApp(reloaded, { persistence: reloadedPersist });
    const tb = (await request(app2).get('/api/v1/accounting/trial-balance').set('x-dev-user', 'u-fin-maker')).body;
    expect(tb.balanced).toBe(true);
  }, 120_000);

  it('does not write anything for read-only requests', async () => {
    const before = (await db.query<{ v: number }>('select coalesce(sum(version),0)::int v from leads')).rows[0]!.v;
    for (let i = 0; i < 5; i += 1) await s.crm.get('/leads');
    await s.audit.get('/audit-logs');
    expect((await db.query<{ v: number }>('select coalesce(sum(version),0)::int v from leads')).rows[0]!.v).toBe(before);
    expect(persist.isDirty()).toBe(false);
  });

  it('serialises parallel requests: no lost updates, no duplicate ids', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) =>
      s.crm.post('/leads', { name: `Parallel ${i}`, phone: `97000000${String(i).padStart(2, '0')}`, source: 'WALK_IN', branchId: 'CHN' })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = results.map((r) => r.body.id);
    expect(new Set(ids).size).toBe(15);
    expect(await count('leads')).toBe(store.leads.length);
    expect(canon(stateOf(await restart()))).toBe(canon(stateOf(store)));
  });
});

describe('failure handling', () => {
  it('rolls memory back when the request is rejected', async () => {
    const before = canon(stateOf(store));
    expect((await s.crm.post('/leads', { name: 'x', phone: '1', source: 'NOPE', branchId: 'CHN' })).status).toBe(400);
    expect((await s.crm.post('/leads/LD-9999/transition', { to: 'CONTACTED' })).status).toBe(404);
    expect(canon(stateOf(store))).toBe(before);
  });

  it('keeps a deliberately recorded failure (a late provider callback is logged, not lost)', async () => {
    const { cs } = await activeGroup(app, s);
    const att = (await s.col.post('/payment-attempts', { customerId: cs[0], amountPaise: 1000000 })).body;
    await s.fm.post(`/payment-attempts/${att.id}/simulated-callback`, { eventId: 'evt-keep-1', outcome: 'SUCCESS' });
    const late = await s.fm.post(`/payment-attempts/${att.id}/simulated-callback`, { eventId: 'evt-keep-2', outcome: 'SUCCESS' });
    expect(late.status).toBe(409);
    const reloaded = await restart();
    expect(reloaded.attempts.find((a) => a.id === att.id)!.callbacks.map((c) => c.eventId)).toEqual(['evt-keep-1', 'evt-keep-2']);
  });

  it('answers 500 and leaves no trace when the database is unavailable', async () => {
    const before = canon(stateOf(store));
    const original = db.tx.bind(db);
    (db as { tx: Db['tx'] }).tx = async () => { throw new Error('connection refused'); };
    let res;
    try {
      res = await s.crm.post('/leads', { name: 'Outage', phone: '9876500001', source: 'WALK_IN', branchId: 'CHN' });
    } finally {
      (db as { tx: Db['tx'] }).tx = original;
    }
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PERSISTENCE_ERROR');
    expect(res.body.error.requestId).toBeTruthy();
    expect(canon(stateOf(store))).toBe(before);
    // service continues: same request now succeeds and gets the id the failed one would have had
    const ok = await s.crm.post('/leads', { name: 'Outage', phone: '9876500001', source: 'WALK_IN', branchId: 'CHN' });
    expect(ok.status).toBe(201);
    expect(canon(stateOf(await restart()))).toBe(canon(stateOf(store)));
  });

  it('turns a database integrity refusal into a clean 409 and rolls back', async () => {
    // a row exists in the database that the in-memory state does not know about
    await db.query(`insert into schemes (id, code, data) values ('SCH-OOB','SCH-CLASH','{}')`);
    const before = canon(stateOf(store));
    const res = await s.maker.post('/schemes', {
      code: 'SCH-CLASH',
      config: { name: 'Clash Scheme', jurisdiction: 'TAMIL_NADU', chitValuePaise: 20000000, memberCount: 2, installmentAmountPaise: 10000000, frequency: 'MONTHLY', tenureMonths: 2, auction: { mode: 'MEMBER_BIDS' }, requiredDocuments: [], complianceChecklist: [], effectiveFrom: '2026-01-01' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INTEGRITY_VIOLATION');
    expect(canon(stateOf(store))).toBe(before);
    expect(await count('scheme_versions')).toBe(0);
  });
});

describe('backup and restore', () => {
  it('a copy of the database files restores into an identical, working system', async () => {
    const { cs } = await activeGroup(app, s);
    await s.col.post('/payments/offline', { customerId: cs[0], mode: 'CASH', amountPaise: 2500000, clientRequestId: uniq('bk') });
    await s.fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 1000, reference: 'BK-1', direction: 'CREDIT' }] });

    // 1. take a physical backup of the live database; 2. bring up a brand-new engine from that copy only
    const restored = await backupAndRestore();
    try {
      const fresh = createEmptyStore();
      installClock(fresh, clock);
      const restoredPersist = new PersistentStore(restored, fresh);
      await restoredPersist.load();
      expect(canon(stateOf(fresh))).toBe(canon(stateOf(store)));

      // the restored system accepts new business and keeps its integrity guards
      const app2 = createApp(fresh, { persistence: restoredPersist });
      const pay = await request(app2).post('/api/v1/payments/offline').set('x-dev-user', 'u-col-chn').send({ customerId: cs[1], mode: 'CASH', amountPaise: 1000000, clientRequestId: uniq('after') });
      expect(pay.status).toBe(201);
      const tb = (await request(app2).get('/api/v1/accounting/trial-balance').set('x-dev-user', 'u-fin-maker')).body;
      expect(tb.balanced).toBe(true);
      expect(tb.items.find((r: { code: string }) => r.code === '1010').debitPaise).toBe(3500000);
      await expect(restored.query(`update audit_log set action = 'tampered'`)).rejects.toMatchObject({ code: '23001' });
    } finally {
      await restored.close();
    }
  }, 120_000);
});