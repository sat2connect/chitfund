import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createInitialAdmin } from '../auth/bootstrap.js';
import { PG, pgErrorCode, type Db } from '../db/Db.js';
import { migrate, pendingMigrations } from '../db/migrate.js';
import { createPgDb } from '../db/pgDb.js';
import { initPilot, validatePilotConfig, type PilotConfig } from '../cli/initPilot.js';
import { PersistentStore } from '../persistence/persistentStore.js';
import { createEmptyStore, type Store } from '../repositories/store.js';
import { canon, installClock, stateOf, T0, type Clock } from './scenario.js';
import { closeTestDb, freshDb } from './testDb.js';

afterAll(closeTestDb);

const PILOT: PilotConfig = {
  accountantApproval: { approvedBy: 'R. Subramanian, CA', approvedOn: '2026-11-20', reference: 'CoA-v1' },
  branches: [{ id: 'CHN', name: 'Chennai Central' }, { id: 'CBE', name: 'Coimbatore' }],
  accounts: [
    { code: '1010', name: 'Cash in hand', type: 'ASSET' }, { code: '1020', name: 'Bank - collections', type: 'ASSET' },
    { code: '1030', name: 'Gateway clearing', type: 'ASSET' }, { code: '2100', name: 'Chit subscriptions', type: 'LIABILITY' },
    { code: '2200', name: 'Prize payouts payable', type: 'LIABILITY' }, { code: '4100', name: 'Commission income', type: 'INCOME' },
  ],
  postingRules: {
    debitByMode: { CASH: '1010', CHEQUE: '1020', UPI: '1020', BANK_TRANSFER: '1020', ONLINE_SIMULATED: '1030' },
    creditAccountCode: '2100', payoutDebitCode: '2200', payoutCreditByChannel: { BANK_TRANSFER: '1020', CHEQUE: '1020' },
  },
  fiscalCalendar: { startDate: '2026-04-01', months: 12 },
  settings: { graceDays: 3 },
};

describe('pilot initialisation', () => {
  let db: Db;
  let store: Store;
  let persist: PersistentStore;
  beforeEach(async () => {
    db = await freshDb();
    store = createEmptyStore();
    persist = new PersistentStore(db, store);
    persist.initialise();
  });
  const clone = (patch: (c: PilotConfig) => void) => { const c = structuredClone(PILOT); patch(c); return c; };

  it('loads approved reference data, marks the chart as approved, records who approved it, and survives a restart', async () => {
    await initPilot(persist, store, PILOT);
    expect(store.branches.map((b) => b.id)).toEqual(['CHN', 'CBE']);
    expect(store.accounts.every((a) => a.placeholder === false)).toBe(true);
    expect(store.periods).toHaveLength(12);
    expect(store.periods[0]).toMatchObject({ name: 'Apr 2026', startDate: '2026-04-01', endDate: '2026-04-30' });
    expect(store.periods[11]).toMatchObject({ startDate: '2027-03-01', endDate: '2027-03-31' });
    expect(store.settings.graceDays).toBe(3);
    const entry = store.audit.find((a) => a.action === 'system.init_pilot')!;
    expect(JSON.stringify(entry.detail)).toContain('R. Subramanian');
    const reloaded = createEmptyStore();
    await new PersistentStore(db, reloaded).load();
    expect(canon(stateOf(reloaded))).toBe(canon(stateOf(store)));
  });

  it('refuses incomplete or inconsistent configuration and reports every problem', () => {
    const problems = validatePilotConfig(clone((c) => {
      c.accountantApproval = { approvedBy: '', approvedOn: 'soon' };
      c.accounts.push({ code: '1010', name: 'Dup', type: 'ASSET' });
      c.postingRules.creditAccountCode = '9999';
      c.postingRules.debitByMode.CASH = '2100'; // a liability used as the cash debit account
      c.branches.push({ id: 'chn', name: 'bad id' });
      c.fiscalCalendar = { startDate: '2026-04-15', months: 0 };
    }), store);
    const text = problems.join('\n');
    expect(text).toMatch(/accountantApproval/);
    expect(text).toMatch(/Duplicate account code 1010/);
    expect(text).toMatch(/unknown account "9999"/);
    expect(text).toMatch(/debit for CASH uses account 2100, which is a LIABILITY/);
    expect(text).toMatch(/Branch id "chn"/);
    expect(text).toMatch(/fiscalCalendar/);
  });

  it('writes nothing when the configuration is rejected, and never overwrites an initialised system', async () => {
    await expect(initPilot(persist, store, clone((c) => { c.accounts = []; }))).rejects.toThrow(/Pilot configuration rejected/);
    expect(store.branches).toHaveLength(0);
    expect((await db.query<{ c: number }>('select count(*)::int c from branches')).rows[0]!.c).toBe(0);
    await initPilot(persist, store, PILOT);
    await expect(initPilot(persist, store, PILOT)).rejects.toThrow(/already has branches/);
  });
});

describe('real node-postgres driver against the embedded engine', () => {
  let raw: PGlite;
  let server: PGLiteSocketServer;
  let db: Db;
  const port = 54_377;

  beforeEach(async () => {
    await db?.close().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    await raw?.close().catch(() => undefined);
    raw = await PGlite.create();
    server = new PGLiteSocketServer({ db: raw, port, host: '127.0.0.1' });
    await server.start();
    db = createPgDb({ connectionString: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  });
  afterAll(async () => {
    await db?.close().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    await raw?.close().catch(() => undefined);
  });

  it('migrates, reports pending migrations, and is idempotent', async () => {
    expect(await pendingMigrations(db)).toEqual(['001_core.sql', '002_auth.sql']);
    expect((await migrate(db)).applied).toEqual(['001_core.sql', '002_auth.sql']);
    expect(await pendingMigrations(db)).toEqual([]);
    expect((await migrate(db)).applied).toEqual([]);
  });

  it('commits transactions atomically and rolls back on failure, with usable error codes', async () => {
    await migrate(db);
    await expect(db.tx(async (q) => {
      await q.query(`insert into branches (id, name, data) values ('A','Alpha','{}')`);
      await q.query(`insert into branches (id, name, data) values ('A','Alpha again','{}')`);
    })).rejects.toSatisfy((e) => pgErrorCode(e) === PG.UNIQUE_VIOLATION);
    expect((await db.query<{ c: number }>('select count(*)::int c from branches')).rows[0]!.c).toBe(0);
    await db.tx(async (q) => { await q.query(`insert into branches (id, name, data) values ('A','Alpha','{}')`); });
    expect((await db.query<{ c: number }>('select count(*)::int c from branches')).rows[0]!.c).toBe(1);
    await db.ping();
    expect(await db.acquireWriterLock(1)).toBe(true);
  });

  it('runs the whole application on it: bootstrap, sign-in, a business change, restart', async () => {
    await migrate(db);
    const clock: Clock = { ms: T0 };
    const store = createEmptyStore();
    installClock(store, clock);
    const persist = new PersistentStore(db, store);
    await persist.load();
    await initPilot(persist, store, PILOT);
    await createInitialAdmin(persist, store, { name: 'Asha Admin', username: 'admin@example.org', password: 'correct-horse-battery-9' }, { n: 1024, r: 8, p: 1 });

    // a durable write through the HTTP layer, then a cold start from the same database
    const { AuthService, defaultAuthSettings } = await import('../auth/authService.js');
    const { loadConfig } = await import('../config/index.js');
    const { totp } = await import('../auth/totp.js');
    const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'session', AUTH_ENCRYPTION_KEY: '09'.repeat(32), CORS_ORIGINS: 'http://localhost:5173' });
    const auth = new AuthService(db, store, defaultAuthSettings(config.authEncryptionKey!, { scrypt: { n: 1024, r: 8, p: 1 } }));
    const app = createApp(store, { persistence: persist, auth, config });

    const login = await request(app).post('/api/v1/auth/login').send({ username: 'admin@example.org', password: 'correct-horse-battery-9' });
    expect(login.body.status).toBe('MFA_ENROLLMENT_REQUIRED');
    const enrol = await request(app).post('/api/v1/auth/mfa/enroll').send({ challengeToken: login.body.challengeToken, code: totp(login.body.secret, clock.ms) });
    expect(enrol.status).toBe(200);
    const cookie = (enrol.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const created = await request(app).post('/api/v1/users').set('Cookie', cookie).set('x-csrf-token', enrol.body.csrfToken).set('Origin', 'http://localhost:5173')
      .send({ name: 'Karthik Raman', username: 'karthik@example.org', roles: ['CRM_EXEC'], branchIds: ['CHN'] });
    expect(created.status).toBe(201);

    const cold = createEmptyStore();
    installClock(cold, clock);
    await new PersistentStore(db, cold).load();
    expect(cold.users.map((u) => u.name)).toEqual(['Asha Admin', 'Karthik Raman']);
    expect(canon(stateOf(cold))).toBe(canon(stateOf(store)));
    const sessions = (await db.query<{ c: number }>('select count(*)::int c from sessions')).rows[0]!.c;
    expect(sessions).toBe(1); // the session written through pg survived too
  }, 60_000);
});
