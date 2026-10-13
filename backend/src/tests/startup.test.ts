import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { acquireWriterLockWithRetry, createStartupGate, provisionOnStart } from '../startup.js';
import type { Db } from '../db/Db.js';
import { PersistentStore } from '../persistence/persistentStore.js';
import { createEmptyStore, type Store } from '../repositories/store.js';
import { canon, stateOf } from './scenario.js';
import { closeTestDb, freshDb } from './testDb.js';
import { createApp } from '../app.js';

afterAll(closeTestDb);

describe('handover between an old and a new instance', () => {
  it('waits for the previous instance to release the lock, then proceeds', async () => {
    let calls = 0;
    const logs: string[] = [];
    const ok = await acquireWriterLockWithRetry({ acquireWriterLock: async () => ++calls >= 4 }, 1, { intervalMs: 1, sleep: async () => undefined, log: (m) => logs.push(m) });
    expect(ok).toBe(true);
    expect(calls).toBe(4);
    expect(logs).toHaveLength(1); // told once, not on every attempt
  });

  it('gives up after the timeout so a stuck old instance cannot hang a deploy forever', async () => {
    let t = 0;
    const ok = await acquireWriterLockWithRetry({ acquireWriterLock: async () => false }, 1, { timeoutMs: 10_000, intervalMs: 1_000, now: () => t, sleep: async (ms) => { t += ms; }, log: () => undefined });
    expect(ok).toBe(false);
    expect(t).toBeGreaterThanOrEqual(10_000);
  });

  it('succeeds immediately without waiting when nobody holds the lock', async () => {
    let slept = 0;
    expect(await acquireWriterLockWithRetry({ acquireWriterLock: async () => true }, 1, { sleep: async () => { slept += 1; } })).toBe(true);
    expect(slept).toBe(0);
  });
});

describe('start-up gate', () => {
  it('passes the liveness check but refuses real traffic with a retryable 503 until ready', async () => {
    const gate = createStartupGate();
    const server = http.createServer(gate.handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const health = await request(url).get('/api/v1/health');
      expect(health.status).toBe(200);
      expect(health.body.status).toBe('starting');
      const early = await request(url).get('/api/v1/leads');
      expect(early.status).toBe(503);
      expect(early.body.error.code).toBe('STARTING');
      expect(early.headers['retry-after']).toBe('5');
      expect((await request(url).get('/api/v1/ready')).status).toBe(503);
      expect((await request(url).post('/api/v1/leads').send({})).status).toBe(503);
      expect(gate.isReady()).toBe(false);

      gate.ready(createApp());
      expect(gate.isReady()).toBe(true);
      const live = await request(url).get('/api/v1/health');
      expect(live.body.status).toBe('ok');
      expect((await request(url).get('/api/v1/leads').set('x-dev-user', 'u-crm-chn')).status).toBe(200);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('first-start provisioning', () => {
  let db: Db;
  let store: Store;
  let persist: PersistentStore;
  const PILOT = JSON.stringify({
    accountantApproval: { approvedBy: 'R. Subramanian, CA', approvedOn: '2026-11-20' },
    branches: [{ id: 'CHN', name: 'Chennai Central' }],
    accounts: [
      { code: '1010', name: 'Cash in hand', type: 'ASSET' }, { code: '1020', name: 'Bank', type: 'ASSET' }, { code: '1030', name: 'Gateway clearing', type: 'ASSET' },
      { code: '2100', name: 'Chit subscriptions', type: 'LIABILITY' }, { code: '2200', name: 'Prize payouts payable', type: 'LIABILITY' },
    ],
    postingRules: {
      debitByMode: { CASH: '1010', CHEQUE: '1020', UPI: '1020', BANK_TRANSFER: '1020', ONLINE_SIMULATED: '1030' },
      creditAccountCode: '2100', payoutDebitCode: '2200', payoutCreditByChannel: { BANK_TRANSFER: '1020', CHEQUE: '1020' },
    },
    fiscalCalendar: { startDate: '2026-04-01', months: 12 },
  });
  const ENV = { PROVISION_ON_START: 'true', PILOT_CONFIG_JSON: PILOT, BOOTSTRAP_ADMIN_NAME: 'Asha Admin', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.org', BOOTSTRAP_ADMIN_PASSWORD: 'a-long-unusual-passphrase-42' };

  beforeEach(async () => {
    db = await freshDb();
    store = createEmptyStore();
    persist = new PersistentStore(db, store);
    await persist.load();
  });

  it('does nothing unless explicitly switched on', async () => {
    expect(await provisionOnStart(persist, store, { ...ENV, PROVISION_ON_START: 'false' })).toEqual({ pilot: false, admin: false });
    expect(store.users).toHaveLength(0);
    expect(store.branches).toHaveLength(0);
  });

  it('creates the reference data and the first administrator once, durably, and never repeats', async () => {
    const logs: string[] = [];
    expect(await provisionOnStart(persist, store, ENV, (m) => logs.push(m))).toEqual({ pilot: true, admin: true });
    expect(store.branches.map((b) => b.id)).toEqual(['CHN']);
    expect(store.users.map((u) => u.roles)).toEqual([['SUPER_ADMIN']]);
    expect(logs.join(' ')).not.toContain(ENV.BOOTSTRAP_ADMIN_PASSWORD); // the password is never logged

    const reloaded = createEmptyStore();
    const p2 = new PersistentStore(db, reloaded);
    await p2.load();
    expect(canon(stateOf(reloaded))).toBe(canon(stateOf(store)));
    const cred = (await db.query<{ username: string; password_hash: string }>('select username, password_hash from user_credentials')).rows;
    expect(cred).toHaveLength(1);
    expect(cred[0]!.password_hash.startsWith('scrypt$')).toBe(true);

    // a later start with the variables still present changes nothing
    const before = canon(stateOf(reloaded));
    expect(await provisionOnStart(p2, reloaded, ENV)).toEqual({ pilot: false, admin: false });
    expect(canon(stateOf(reloaded))).toBe(before);
  });

  it('fails loudly (so a deploy visibly fails) on a bad configuration or weak password, and saves nothing', async () => {
    await expect(provisionOnStart(persist, store, { ...ENV, PILOT_CONFIG_JSON: '{not json' })).rejects.toThrow(/not valid JSON/);
    await expect(provisionOnStart(persist, store, { ...ENV, PILOT_CONFIG_JSON: JSON.stringify({ branches: [] }) })).rejects.toThrow(/Pilot configuration rejected/);
    await expect(provisionOnStart(persist, store, { ...ENV, PILOT_CONFIG_JSON: undefined, BOOTSTRAP_ADMIN_PASSWORD: 'password123' })).rejects.toThrow(/Password rejected/);
    expect(store.users).toHaveLength(0);
    expect((await db.query<{ c: number }>('select count(*)::int c from users')).rows[0]!.c).toBe(0);
  });
});
