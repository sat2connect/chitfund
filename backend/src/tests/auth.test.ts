import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createInitialAdmin } from '../auth/bootstrap.js';
import { AuthService, defaultAuthSettings } from '../auth/authService.js';
import { hashPassword, verifyPassword } from '../auth/crypto.js';
import { checkPassword } from '../auth/passwordPolicy.js';
import { base32Decode, base32Encode, totp, verifyTotp } from '../auth/totp.js';
import { loadConfig } from '../config/index.js';
import type { Db } from '../db/Db.js';
import { PersistentStore } from '../persistence/persistentStore.js';
import { createEmptyStore, type Store } from '../repositories/store.js';
import { seedDemoData } from '../seed/crmSeed.js';
import { installClock, type Clock, T0 } from './scenario.js';
import { closeTestDb, freshDb } from './testDb.js';

afterAll(closeTestDb);

const KEY_HEX = '07'.repeat(32);
const COST = { n: 1024, r: 8, p: 1 }; // fast hashing for tests; production uses 32768
const ORIGIN = 'http://localhost:5173';
const ADMIN = { name: 'Asha Admin', username: 'admin@example.org', password: 'correct-horse-battery-9' };
const GOOD_PW = 'a-long-unusual-passphrase-42';

let db: Db;
let store: Store;
let persist: PersistentStore;
let clock: Clock;
let app: ReturnType<typeof createApp>;
let adminSecret: string | undefined;

async function boot(env: Record<string, string> = {}, opts: { demo?: boolean } = {}) {
  db = await freshDb();
  clock = { ms: T0 };
  store = createEmptyStore();
  installClock(store, clock);
  persist = new PersistentStore(db, store);
  persist.initialise();
  if (opts.demo) {
    seedDemoData(store);
    store.users.length = 0; // keep demo customers/accounts, but real sign-in starts from the bootstrap administrator only
  }
  adminSecret = undefined;
  await persist.commit();
  const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'session', AUTH_ENCRYPTION_KEY: KEY_HEX, CORS_ORIGINS: ORIGIN, ...env });
  const auth = new AuthService(db, store, defaultAuthSettings(config.authEncryptionKey!, { scrypt: COST, sessionIdleMs: config.sessionIdleMs, sessionAbsoluteMs: config.sessionAbsoluteMs }));
  await createInitialAdmin(persist, store, ADMIN, COST);
  app = createApp(store, { persistence: persist, auth, config });
  return config;
}

/** A browser-like client that keeps the session cookie and CSRF token. */
class Client {
  cookie?: string;
  csrf?: string;
  constructor(readonly origin: string | undefined = ORIGIN) {}
  private apply(r: request.Test, unsafe: boolean, csrf = true) {
    if (this.cookie) r.set('Cookie', this.cookie);
    if (this.origin) r.set('Origin', this.origin);
    if (unsafe && csrf && this.csrf) r.set('x-csrf-token', this.csrf);
    return r;
  }
  get = (p: string) => this.apply(request(app).get(`/api/v1${p}`), false);
  post = (p: string, b: object = {}, o: { csrf?: boolean } = {}) => this.apply(request(app).post(`/api/v1${p}`), true, o.csrf).send(b);
  put = (p: string, b: object = {}) => this.apply(request(app).put(`/api/v1${p}`), true).send(b);
  capture(res: request.Response) {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    const c = set?.find((x) => /^(__Host-)?session=/.test(x));
    if (c) this.cookie = c.split(';')[0]!;
    if (res.body?.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }
}

/** Full sign-in for a staff account, including the second factor. Returns the TOTP secret for later logins. */
async function signIn(c: Client, username: string, password: string, secret?: string): Promise<{ res: request.Response; secret?: string }> {
  const first = await c.post('/auth/login', { username, password });
  if (first.body.status === 'AUTHENTICATED') return { res: c.capture(first) };
  if (first.body.status === 'MFA_ENROLLMENT_REQUIRED') {
    const s = first.body.secret as string;
    const res = await c.post('/auth/mfa/enroll', { challengeToken: first.body.challengeToken, code: totp(s, clock.ms) });
    return { res: c.capture(res), secret: s };
  }
  if (first.body.status === 'MFA_REQUIRED') {
    clock.ms += 31_000; // a fresh 30-second step: an authenticator code can be used once
    const res = await c.post('/auth/mfa/verify', { challengeToken: first.body.challengeToken, code: totp(secret!, clock.ms) });
    return { res: c.capture(res), secret };
  }
  return { res: first };
}

async function adminClient() {
  const c = new Client();
  const { res, secret } = await signIn(c, ADMIN.username, ADMIN.password, adminSecret);
  expect(res.status).toBe(200);
  adminSecret = secret ?? adminSecret;
  return { c, secret: adminSecret! };
}

/** Admin creates a staff account; the person activates it with the one-time code and enrols MFA. */
async function staffClient(admin: Client, username: string, roles: string[], branchIds: string[] | 'ALL' = ['CHN']) {
  const created = await admin.post('/users', { name: `Person ${username.split('@')[0]}`, username, roles, branchIds });
  expect(created.status).toBe(201);
  const act = await new Client().post('/auth/activate', { username, code: created.body.activation.code, newPassword: GOOD_PW });
  expect(act.status).toBe(200);
  const c = new Client();
  const { res, secret } = await signIn(c, username, GOOD_PW);
  expect(res.status).toBe(200);
  return { c, secret: secret!, id: created.body.user.id as string };
}

describe('configuration', () => {
  const prod = { NODE_ENV: 'production', AUTH_MODE: 'session', AUTH_ENCRYPTION_KEY: KEY_HEX, DATABASE_URL: 'postgres://u:p@db/x', CORS_ORIGINS: 'https://crm.example.org' };
  it('accepts a complete production configuration', () => {
    const c = loadConfig(prod);
    expect(c.isProduction).toBe(true);
    expect(c.cookieSecure).toBe(true);
    expect(c.authMode).toBe('session');
  });
  it.each([
    [{ AUTH_MODE: 'dev' }, /simulated sign-in.*not allowed in production/],
    [{ DATABASE_URL: '' }, /DATABASE_URL is required/],
    [{ CORS_ORIGINS: '*' }, /not \*/],
    [{ CORS_ORIGINS: 'http://crm.example.org' }, /https/],
    [{ AUTH_ENCRYPTION_KEY: 'short' }, /AUTH_ENCRYPTION_KEY/],
    [{ COOKIE_SECURE: 'false' }, /COOKIE_SECURE/],
  ])('refuses an unsafe production setup %j', (patch, message) => {
    expect(() => loadConfig({ ...prod, ...patch })).toThrow(message);
  });
  it('reports every problem at once', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL[\s\S]*AUTH_ENCRYPTION_KEY|AUTH_ENCRYPTION_KEY[\s\S]*DATABASE_URL/);
  });
  it('defaults to simulated sign-in only outside production', () => {
    expect(loadConfig({}).authMode).toBe('dev');
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'x', CORS_ORIGINS: 'https://a.b', AUTH_ENCRYPTION_KEY: KEY_HEX }).authMode).toBe('session');
  });
});

describe('primitives', () => {
  it('hashes passwords with a unique salt and verifies them', async () => {
    const a = await hashPassword('secret-passphrase-1', COST);
    const b = await hashPassword('secret-passphrase-1', COST);
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(await verifyPassword('secret-passphrase-1', a)).toBe(true);
    expect(await verifyPassword('secret-passphrase-2', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('applies the password policy', () => {
    expect(checkPassword('short')).toContain('Use at least 12 characters');
    expect(checkPassword('password123')).not.toEqual([]);
    expect(checkPassword('aaaaaaaaaaaaaa')).toContain('Do not repeat a single character');
    expect(checkPassword('asha.admin-is-great-1', { username: 'asha.admin@x.org', name: 'Asha Admin' }).join()).toMatch(/username|name/);
    expect(checkPassword('a-long-unusual-passphrase-42', { username: 'x@y.org' })).toEqual([]);
  });
  it('computes RFC 6238 test vectors and base32 correctly', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1_111_111_109_000)).toBe('081804');
    expect(totp(secret, 1_234_567_890_000)).toBe('005924');
  });
  it('accepts one step of clock drift, rejects further drift, and refuses replays', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const at = 1_111_111_109_000;
    const step = Math.floor(at / 30_000);
    expect(verifyTotp(secret, totp(secret, at), at)).toBe(step);
    expect(verifyTotp(secret, totp(secret, at - 30_000), at)).toBe(step - 1);
    expect(verifyTotp(secret, totp(secret, at + 30_000), at)).toBe(step + 1);
    expect(verifyTotp(secret, totp(secret, at - 90_000), at)).toBeNull();
    expect(verifyTotp(secret, totp(secret, at), at, step)).toBeNull(); // already used
    expect(verifyTotp(secret, '12345', at)).toBeNull();
  });
});

describe('sign-in, second factor and sessions', () => {
  beforeEach(async () => { await boot(); });

  it('requires enrolment of a second factor on the first sign-in, and only then issues a session', async () => {
    const c = new Client();
    const first = await c.post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(first.headers['set-cookie']).toBeUndefined(); // password alone is not a session
    expect(first.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect((await c.get('/auth/session')).status).toBe(401);

    expect((await c.post('/auth/mfa/enroll', { challengeToken: first.body.challengeToken, code: '000000' })).status).toBe(401);
    const ok = c.capture(await c.post('/auth/mfa/enroll', { challengeToken: first.body.challengeToken, code: totp(first.body.secret, clock.ms) }));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('AUTHENTICATED');
    expect(ok.body.recoveryCodes).toHaveLength(8);
    const me = await c.get('/auth/session');
    expect(me.body.user.roles).toEqual(['SUPER_ADMIN']);
    expect(me.body.permissions).toContain('user:manage');
  });

  it('then asks for the code at every sign-in, and a code cannot be replayed', async () => {
    const { c, secret } = await adminClient();
    await c.post('/auth/logout');
    const again = new Client();
    const first = await again.post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    expect(first.body.status).toBe('MFA_REQUIRED');
    const code = totp(secret, clock.ms + 31_000);
    clock.ms += 31_000;
    expect((await again.post('/auth/mfa/verify', { challengeToken: first.body.challengeToken, code })).status).toBe(200);
    const second = await new Client().post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    expect((await new Client().post('/auth/mfa/verify', { challengeToken: second.body.challengeToken, code })).status).toBe(401); // same code, same step
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrong = await new Client().post('/auth/login', { username: ADMIN.username, password: 'not-the-password-1' });
    const unknown = await new Client().post('/auth/login', { username: 'nobody@example.org', password: 'not-the-password-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures, records them, and unlocks later', async () => {
    const c = new Client();
    for (let i = 0; i < 5; i += 1) expect((await c.post('/auth/login', { username: ADMIN.username, password: `wrong-password-${i}x` })).status).toBe(401);
    const locked = await c.post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    clock.ms += 16 * 60_000;
    expect((await c.post('/auth/login', { username: ADMIN.username, password: ADMIN.password })).body.status).toBe('MFA_ENROLLMENT_REQUIRED');
    // the failures were persisted, not just counted in memory
    const reloaded = createEmptyStore();
    installClock(reloaded, clock);
    await new PersistentStore(db, reloaded).load();
    expect(reloaded.audit.filter((a) => a.action === 'auth.login_failed').length).toBe(4);
    expect(reloaded.audit.some((a) => a.action === 'auth.locked')).toBe(true);
  });

  it('kills a login challenge after too many wrong codes', async () => {
    const { secret } = await adminClient();
    const first = await new Client().post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    expect(first.body.status).toBe('MFA_REQUIRED');
    for (let i = 0; i < 5; i += 1) expect((await new Client().post('/auth/mfa/verify', { challengeToken: first.body.challengeToken, code: '000000' })).status).toBe(401);
    clock.ms += 31_000;
    expect((await new Client().post('/auth/mfa/verify', { challengeToken: first.body.challengeToken, code: totp(secret, clock.ms) })).status).toBe(401);
  });

  it('lets a single-use recovery code replace the authenticator code', async () => {
    const c = new Client();
    const first = await c.post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    const enrolled = c.capture(await c.post('/auth/mfa/enroll', { challengeToken: first.body.challengeToken, code: totp(first.body.secret, clock.ms) }));
    const recovery = enrolled.body.recoveryCodes[0] as string;
    const login = async () => {
      const l = await new Client().post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
      return new Client().post('/auth/mfa/verify', { challengeToken: l.body.challengeToken, code: recovery });
    };
    expect((await login()).status).toBe(200);
    expect((await login()).status).toBe(401); // already used
  });

  it('sets a safe session cookie and never stores the token itself', async () => {
    const { c } = await adminClient();
    const stored = (await db.query<{ id: string }>('select id from sessions')).rows[0]!.id;
    expect(c.cookie).toMatch(/^session=/);
    expect(c.cookie!.split('=')[1]).not.toBe(stored);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    const res = await new Client().post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('marks the cookie HttpOnly, SameSite=Lax and Secure with the __Host- prefix when secure cookies are on', async () => {
    await boot({ COOKIE_SECURE: 'true' });
    const c = new Client();
    const first = await c.post('/auth/login', { username: ADMIN.username, password: ADMIN.password });
    const res = await c.post('/auth/mfa/enroll', { challengeToken: first.body.challengeToken, code: totp(first.body.secret, clock.ms) });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^__Host-session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
  });

  it('requires the CSRF token and an allowed origin for state-changing requests on cookie sessions', async () => {
    const { c } = await adminClient();
    expect((await c.get('/users')).status).toBe(200); // reads need no token
    const noToken = await c.post('/users', { name: 'x' }, { csrf: false });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF');
    const evil = new Client('https://evil.example');
    evil.cookie = c.cookie;
    evil.csrf = c.csrf;
    const cross = await evil.post('/users', { name: 'x' });
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe('CSRF_ORIGIN');
    const bad = new Client();
    bad.cookie = c.cookie;
    bad.csrf = 'wrong-token';
    expect((await bad.post('/users', { name: 'x' })).body.error.code).toBe('CSRF');
  });

  it('accepts the session as a bearer token (for a future mobile app) without CSRF', async () => {
    const { c } = await adminClient();
    const token = c.cookie!.split('=')[1]!;
    const res = await request(app).get('/api/v1/auth/session').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const post = await request(app).post('/api/v1/users').set('Authorization', `Bearer ${token}`).send({});
    expect(post.status).toBe(400); // validation, not a CSRF refusal
  });

  it('ends the session on logout, and after idle and absolute timeouts', async () => {
    const a = await adminClient();
    expect((await a.c.post('/auth/logout')).status).toBe(200);
    expect((await a.c.get('/auth/session')).status).toBe(401);

    const b = await adminClient();
    clock.ms += 31 * 60_000;
    expect((await b.c.get('/auth/session')).status).toBe(401); // idle for more than 30 minutes

    const d = await adminClient();
    for (let i = 0; i < 30; i += 1) {
      clock.ms += 25 * 60_000; // always inside the 30-minute idle window
      if (clock.ms - T0 < 12 * 3_600_000) expect((await d.c.get('/auth/session')).status).toBe(200); // activity keeps it alive
    }
    expect((await d.c.get('/auth/session')).status).toBe(401); // but never beyond 12 hours
  });

  it('applies rate limiting to sign-in attempts', async () => {
    await boot({ LOGIN_RATE_LIMIT_MAX: '3' });
    const c = new Client();
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await c.post('/auth/login', { username: 'nobody@example.org', password: 'whatever-password-1' })).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it('answers the browser preflight for the real front end only, with credentials and the CSRF header', async () => {
    const ok = await request(app).options('/api/v1/users').set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-allow-headers']).toMatch(/x-csrf-token/i);
    expect(ok.headers['access-control-allow-headers']).not.toMatch(/x-dev-user/i); // simulated sign-in is not even advertised
    const evil = await request(app).options('/api/v1/users').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends defensive headers and forbids caching of responses', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not expose simulated sign-in in session mode', async () => {
    expect((await request(app).get('/api/v1/dev/users')).status).toBe(401);
    expect((await request(app).get('/api/v1/leads').set('x-dev-user', 'u-crm-chn')).status).toBe(401);
  });
});

describe('accounts and access control', () => {
  beforeEach(async () => { await boot({}, { demo: true }); });

  it('creates staff through an activation code that is single-use and expires', async () => {
    const { c: admin } = await adminClient();
    const created = await admin.post('/users', { name: 'Karthik Raman', username: 'Karthik@Example.org', roles: ['CRM_EXEC'], branchIds: ['CHN'] });
    expect(created.status).toBe(201);
    expect(created.body.user.username).toBe('karthik@example.org');
    const code = created.body.activation.code as string;
    expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);

    const weak = await new Client().post('/auth/activate', { username: 'karthik@example.org', code, newPassword: 'password123' });
    expect(weak.status).toBe(400);
    expect((await new Client().post('/auth/activate', { username: 'karthik@example.org', code: 'AAAAA-BBBBB-CCCCC', newPassword: GOOD_PW })).status).toBe(400);
    expect((await new Client().post('/auth/activate', { username: 'karthik@example.org', code, newPassword: GOOD_PW })).status).toBe(200);
    expect((await new Client().post('/auth/activate', { username: 'karthik@example.org', code, newPassword: GOOD_PW })).status).toBe(400); // used once

    const late = await admin.post('/users', { name: 'Late Person', username: 'late@example.org', roles: ['AUDITOR'], branchIds: 'ALL' });
    clock.ms += 73 * 3_600_000;
    expect((await new Client().post('/auth/activate', { username: 'late@example.org', code: late.body.activation.code, newPassword: GOOD_PW })).status).toBe(400);
  });

  it('keeps secrets out of the database in readable form', async () => {
    const { c: admin } = await adminClient();
    const created = await admin.post('/users', { name: 'Secret Check', username: 'secret@example.org', roles: ['AUDITOR'], branchIds: 'ALL' });
    const code = created.body.activation.code as string;
    await new Client().post('/auth/activate', { username: 'secret@example.org', code, newPassword: GOOD_PW });
    const c = new Client();
    const first = await c.post('/auth/login', { username: 'secret@example.org', password: GOOD_PW });
    c.capture(await c.post('/auth/mfa/enroll', { challengeToken: first.body.challengeToken, code: totp(first.body.secret, clock.ms) }));
    const dump = JSON.stringify([
      (await db.query('select * from user_credentials')).rows, (await db.query('select * from sessions')).rows, (await db.query('select * from login_challenges')).rows,
      (await db.query('select data from audit_log')).rows,
    ]);
    for (const secret of [GOOD_PW, ADMIN.password, code, normalise(code), first.body.secret, c.cookie!.split('=')[1]!]) expect(dump).not.toContain(secret);
    const cred = (await db.query<{ password_hash: string; mfa_secret_enc: string }>("select password_hash, mfa_secret_enc from user_credentials where username = 'secret@example.org'")).rows[0]!;
    expect(cred.password_hash.startsWith('scrypt$')).toBe(true);
    expect(cred.mfa_secret_enc.startsWith('v1:')).toBe(true);
  });

  const normalise = (code: string) => code.replace(/-/g, '');

  it('only administrators manage users, and never their own access', async () => {
    const { c: admin, id: _ } = { ...(await adminClient()), id: '' };
    const crm = await staffClient(admin, 'crm@example.org', ['CRM_EXEC']);
    expect((await crm.c.post('/users', { name: 'Evil Person', username: 'evil@example.org', roles: ['SUPER_ADMIN'], branchIds: 'ALL' })).status).toBe(403);
    expect((await crm.c.get('/users')).status).toBe(403);
    const adminId = (await admin.get('/auth/session')).body.user.id;
    const self = await admin.put(`/users/${adminId}/access`, { roles: ['AUDITOR'], branchIds: 'ALL' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_CHANGE');
    expect((await admin.post(`/users/${adminId}/disable`)).status).toBe(403);
  });

  it('refuses role combinations that break separation of duties, and duplicate usernames', async () => {
    const { c: admin } = await adminClient();
    const bad = await admin.post('/users', { name: 'Two Hats', username: 'two@example.org', roles: ['FINANCE_MAKER', 'FINANCE_CHECKER'], branchIds: 'ALL' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.roles).toMatch(/separation of duties/);
    expect((await admin.post('/users', { name: 'Admin Finance', username: 'af@example.org', roles: ['SUPER_ADMIN', 'FINANCE_CHECKER'], branchIds: 'ALL' })).status).toBe(400);
    expect((await admin.post('/users', { name: 'Member Role', username: 'mr@example.org', roles: ['CHIT_MEMBER'], branchIds: 'ALL' })).status).toBe(400);
    expect((await admin.post('/users', { name: 'No Branch', username: 'nb@example.org', roles: ['CRM_EXEC'], branchIds: [] })).status).toBe(400);
    expect((await admin.post('/users', { name: 'Dup Admin', username: ADMIN.username, roles: ['AUDITOR'], branchIds: 'ALL' })).status).toBe(409);
  });

  it('enforces permissions and branch scope for real sessions', async () => {
    const { c: admin } = await adminClient();
    const crm = await staffClient(admin, 'crm.chn@example.org', ['CRM_EXEC'], ['CHN']);
    const cbe = await staffClient(admin, 'crm.cbe@example.org', ['CRM_EXEC'], ['CBE']);
    const mine = await crm.c.get('/leads');
    expect(mine.status).toBe(200);
    expect(mine.body.items.every((l: { branchId: string }) => l.branchId === 'CHN')).toBe(true);
    const cbeLead = (await cbe.c.get('/leads')).body.items[0];
    const cross = await crm.c.get(`/leads/${cbeLead.id}`);
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe('FORBIDDEN_BRANCH');
    expect((await crm.c.get('/accounting/journals')).status).toBe(403);
  });

  it('applies maker-checker to real accounts: a journal maker cannot approve their own entry', async () => {
    const { c: admin } = await adminClient();
    const maker = await staffClient(admin, 'maker@example.org', ['FINANCE_MAKER'], 'ALL');
    const checker = await staffClient(admin, 'checker@example.org', ['FINANCE_CHECKER'], 'ALL');
    const acc = (code: string) => store.accounts.find((a) => a.code === code)!.id;
    const j = (await maker.c.post('/accounting/journals', { date: '2026-12-01', memo: 'Office rent', lines: [{ accountId: acc('5100'), debitPaise: 500000 }, { accountId: acc('1020'), creditPaise: 500000 }] })).body;
    const sub = await maker.c.post(`/accounting/journals/${j.id}/submit`);
    const req = sub.body.approvalRequests[0].id;
    expect((await maker.c.post(`/approvals/${req}/decision`, { decision: 'APPROVED' })).status).toBe(403);
    expect((await checker.c.post(`/approvals/${req}/decision`, { decision: 'APPROVED' })).status).toBe(200);
    const tb = await checker.c.get('/accounting/trial-balance');
    expect(tb.body.balanced).toBe(true);
    // the approval and the posting are durable
    const reloaded = createEmptyStore();
    installClock(reloaded, clock);
    await new PersistentStore(db, reloaded).load();
    expect(reloaded.journals.find((x) => x.id === j.id)!.status).toBe('POSTED');
  });

  it('revokes sessions at once when a user is disabled or their access changes', async () => {
    const { c: admin } = await adminClient();
    const u = await staffClient(admin, 'temp@example.org', ['CRM_EXEC'], ['CHN']);
    expect((await u.c.get('/leads')).status).toBe(200);
    expect((await admin.post(`/users/${u.id}/disable`)).status).toBe(200);
    expect((await u.c.get('/leads')).status).toBe(401);
    expect((await new Client().post('/auth/login', { username: 'temp@example.org', password: GOOD_PW })).status).toBe(401);
    await admin.post(`/users/${u.id}/enable`);
    const again = new Client();
    const { res } = await signIn(again, 'temp@example.org', GOOD_PW, u.secret);
    expect(res.status).toBe(200);
    await admin.put(`/users/${u.id}/access`, { roles: ['AUDITOR'], branchIds: 'ALL' });
    expect((await again.get('/leads')).status).toBe(401); // must sign in again with the new access
  });

  it('changes a password only with the current one, and signs out other devices', async () => {
    const { c: admin } = await adminClient();
    const u = await staffClient(admin, 'pw@example.org', ['AUDITOR'], 'ALL');
    const other = new Client();
    await signIn(other, 'pw@example.org', GOOD_PW, u.secret);
    expect((await u.c.post('/auth/change-password', { currentPassword: 'wrong-current-1', newPassword: 'another-long-passphrase-7' })).status).toBe(403);
    expect((await u.c.post('/auth/change-password', { currentPassword: GOOD_PW, newPassword: 'short' })).status).toBe(400);
    expect((await u.c.post('/auth/change-password', { currentPassword: GOOD_PW, newPassword: 'another-long-passphrase-7' })).status).toBe(200);
    expect((await u.c.get('/auth/session')).status).toBe(200); // this device stays signed in
    expect((await other.get('/auth/session')).status).toBe(401); // the other one does not
    expect((await new Client().post('/auth/login', { username: 'pw@example.org', password: GOOD_PW })).status).toBe(401);
  });

  it('lets an administrator clear a lost authenticator so the user enrols again', async () => {
    const { c: admin } = await adminClient();
    const u = await staffClient(admin, 'lost@example.org', ['AUDITOR'], 'ALL');
    await admin.post(`/users/${u.id}/reset-mfa`);
    expect((await u.c.get('/auth/session')).status).toBe(401);
    const next = await new Client().post('/auth/login', { username: 'lost@example.org', password: GOOD_PW });
    expect(next.body.status).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('gives verified customers portal access without MFA, and keeps members out of staff areas', async () => {
    const { c: admin } = await adminClient();
    const cust = store.customers[0]!; // demo customer, KYC not yet verified
    expect((await admin.post('/users/member-accounts', { customerId: cust.id })).status).toBe(409);
    cust.kycStatus = 'VERIFIED';
    const made = await admin.post('/users/member-accounts', { customerId: cust.id });
    expect(made.status).toBe(201);
    expect(made.body.user.username).toBe(cust.phone);
    expect((await admin.post('/users/member-accounts', { customerId: cust.id })).status).toBe(409);
    expect((await new Client().post('/auth/activate', { username: cust.phone, code: made.body.activation.code, newPassword: GOOD_PW })).status).toBe(200);
    const m = new Client();
    const login = m.capture(await m.post('/auth/login', { username: cust.phone, password: GOOD_PW }));
    expect(login.body.status).toBe('AUTHENTICATED'); // members use a password; an OTP provider is not chosen yet
    expect((await m.get('/portal/profile')).body.id).toBe(cust.id);
    expect((await m.get('/leads')).status).toBe(403);
    expect((await m.get('/users')).status).toBe(403);
    expect((await admin.get('/portal/profile')).status).toBe(403);
  });

  it('records sign-in events in the audit trail for auditors, without secrets', async () => {
    const { c: admin } = await adminClient();
    const aud = await staffClient(admin, 'audit@example.org', ['AUDITOR'], 'ALL');
    await new Client().post('/auth/login', { username: 'audit@example.org', password: 'wrong-password-123' });
    const logs = (await aud.c.get('/audit-logs?pageSize=100')).body.items as { action: string; detail?: unknown }[];
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['user.bootstrap_admin', 'user.create', 'auth.activated', 'auth.mfa_enrolled', 'auth.login_failed']));
    expect(JSON.stringify(logs)).not.toMatch(/wrong-password-123|passphrase/);
  });
});

describe('readiness', () => {
  it('reports ready when the database answers and not ready when it does not', async () => {
    await boot();
    expect((await request(app).get('/api/v1/ready')).body.status).toBe('ready');
    const original = db.ping.bind(db);
    (db as { ping: Db['ping'] }).ping = async () => { throw new Error('connection refused'); };
    try {
      const res = await request(app).get('/api/v1/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
    } finally {
      (db as { ping: Db['ping'] }).ping = original;
    }
  });
});
