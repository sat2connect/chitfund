import type { Db } from '../db/Db.js';
import type { User } from '../domain/types.js';
import type { UnitOfWork } from '../persistence/persistentStore.js';
import type { Store } from '../repositories/store.js';
import { audit } from '../services/common.js';
import { DEFAULT_SCRYPT, decryptSecret, dummyHash, encryptSecret, hashPassword, newOneTimeCode, normaliseCode, randomToken, sha256, verifyPassword } from './crypto.js';
import { checkPassword } from './passwordPolicy.js';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp.js';

export interface AuthSettings {
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  challengeTtlMs: number;
  maxFailedAttempts: number;
  lockoutMs: number;
  activationTtlMs: number;
  maxChallengeAttempts: number;
  issuer: string;
  encryptionKey: Buffer;
  scrypt: { n: number; r: number; p: number };
}

export const defaultAuthSettings = (key: Buffer, overrides: Partial<AuthSettings> = {}): AuthSettings => ({
  sessionIdleMs: 30 * 60_000,
  sessionAbsoluteMs: 12 * 3_600_000,
  challengeTtlMs: 5 * 60_000,
  maxFailedAttempts: 5,
  lockoutMs: 15 * 60_000,
  activationTtlMs: 72 * 3_600_000,
  maxChallengeAttempts: 5,
  issuer: 'Chit Fund CRM',
  encryptionKey: key,
  scrypt: DEFAULT_SCRYPT,
  ...overrides,
});

interface CredRow {
  user_id: string;
  username: string;
  password_hash: string | null;
  failed_attempts: number;
  locked_until: string | null;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_last_step: string | null;
  recovery_codes: string[];
  status: string;
}

export interface Ctx {
  uow: UnitOfWork;
  ip?: string;
  userAgent?: string;
}

export interface SessionInfo {
  token: string;
  csrfToken: string;
  expiresAt: string;
}

export type LoginResult =
  | { kind: 'invalid' }
  | { kind: 'locked'; until: string }
  | { kind: 'session'; session: SessionInfo; user: User }
  | { kind: 'mfa_required'; challengeToken: string }
  | { kind: 'mfa_enrollment_required'; challengeToken: string; secret: string; otpauthUri: string };

export type MfaResult = { kind: 'invalid' } | { kind: 'session'; session: SessionInfo; user: User; recoveryCodes?: string[] };

const ANON = (id = 'anonymous'): User => ({ id, name: id, roles: [], branchIds: 'ALL' });

/**
 * Self-managed authentication. Reads go straight to the database; every WRITE is queued on the request's unit of
 * work so it commits (or rolls back) together with the audit entries it produces.
 */
export class AuthService {
  constructor(private readonly db: Db, private readonly store: Store, private readonly cfg: AuthSettings) {}

  private now() {
    return this.store.now();
  }
  private iso(ms = 0) {
    return new Date(this.now().getTime() + ms).toISOString();
  }
  private userOf(id: string): User | undefined {
    return this.store.users.find((u) => u.id === id);
  }
  /** Staff must use a second factor; members sign in with their password until an OTP provider is chosen. */
  mfaRequired(u: User) {
    return u.roles.some((r) => r !== 'CHIT_MEMBER');
  }

  private async credentials(username: string): Promise<CredRow | undefined> {
    const r = await this.db.query<CredRow>(
      `select c.user_id, c.username, c.password_hash, c.failed_attempts, c.locked_until, c.mfa_enabled, c.mfa_secret_enc, c.mfa_last_step, c.recovery_codes, u.status
         from user_credentials c join users u on u.id = c.user_id where c.username = $1`,
      [username],
    );
    return r.rows[0];
  }
  private async credentialsById(userId: string): Promise<CredRow | undefined> {
    const r = await this.db.query<CredRow>(
      `select c.user_id, c.username, c.password_hash, c.failed_attempts, c.locked_until, c.mfa_enabled, c.mfa_secret_enc, c.mfa_last_step, c.recovery_codes, u.status
         from user_credentials c join users u on u.id = c.user_id where c.user_id = $1`,
      [userId],
    );
    return r.rows[0];
  }

  // ------------------------------------------------------------------ login
  async login(ctx: Ctx, input: { username: string; password: string }): Promise<LoginResult> {
    const username = input.username.trim().toLowerCase();
    const cred = await this.credentials(username);
    const user = cred ? this.userOf(cred.user_id) : undefined;

    if (!cred || !user || !cred.password_hash || cred.status !== 'ACTIVE') {
      await verifyPassword(input.password, await dummyHash(this.cfg.scrypt)); // same cost whether or not the account exists
      audit(this.store, ANON(), 'auth.login_failed', 'auth', username, { reason: 'unknown_or_inactive' });
      return { kind: 'invalid' };
    }
    if (cred.locked_until && new Date(cred.locked_until) > this.now()) {
      audit(this.store, ANON(user.id), 'auth.login_blocked', 'auth', user.id, { reason: 'locked' });
      return { kind: 'locked', until: new Date(cred.locked_until).toISOString() };
    }
    if (!(await verifyPassword(input.password, cred.password_hash))) {
      const failed = cred.failed_attempts + 1;
      const lock = failed >= this.cfg.maxFailedAttempts;
      ctx.uow.exec('update user_credentials set failed_attempts = $2, locked_until = $3, updated_at = $4 where user_id = $1', [user.id, lock ? 0 : failed, lock ? this.iso(this.cfg.lockoutMs) : null, this.iso()]);
      audit(this.store, ANON(user.id), lock ? 'auth.locked' : 'auth.login_failed', 'auth', user.id, { failedAttempts: failed });
      return { kind: 'invalid' };
    }

    ctx.uow.exec('update user_credentials set failed_attempts = 0, locked_until = null, last_login_at = $2, updated_at = $2 where user_id = $1', [user.id, this.iso()]);

    if (this.mfaRequired(user)) {
      if (cred.mfa_enabled) {
        const challengeToken = this.newChallenge(ctx, user.id, 'MFA_VERIFY');
        return { kind: 'mfa_required', challengeToken };
      }
      const secret = newTotpSecret();
      const challengeToken = this.newChallenge(ctx, user.id, 'MFA_ENROLL', encryptSecret(secret, this.cfg.encryptionKey));
      return { kind: 'mfa_enrollment_required', challengeToken, secret, otpauthUri: otpauthUri(this.cfg.issuer, username, secret) };
    }
    return { kind: 'session', session: this.newSession(ctx, user.id), user };
  }

  private newChallenge(ctx: Ctx, userId: string, purpose: 'MFA_VERIFY' | 'MFA_ENROLL', pendingSecretEnc?: string) {
    const token = randomToken(32);
    ctx.uow.exec('insert into login_challenges (id, user_id, purpose, pending_secret_enc, created_at, expires_at) values ($1,$2,$3,$4,$5,$6)', [
      sha256(token), userId, purpose, pendingSecretEnc ?? null, this.iso(), this.iso(this.cfg.challengeTtlMs),
    ]);
    return token;
  }

  private async challenge(token: string, purpose: 'MFA_VERIFY' | 'MFA_ENROLL') {
    const r = await this.db.query<{ id: string; user_id: string; pending_secret_enc: string | null; attempts: number }>(
      'select id, user_id, pending_secret_enc, attempts from login_challenges where id = $1 and purpose = $2 and consumed = false and expires_at > $3',
      [sha256(token), purpose, this.iso()],
    );
    return r.rows[0];
  }

  // ------------------------------------------------------------------ MFA
  async verifyMfa(ctx: Ctx, input: { challengeToken: string; code: string }): Promise<MfaResult> {
    const ch = await this.challenge(input.challengeToken, 'MFA_VERIFY');
    const user = ch ? this.userOf(ch.user_id) : undefined;
    const cred = ch ? await this.credentialsById(ch.user_id) : undefined;
    if (!ch || !user || !cred || !cred.mfa_enabled || !cred.mfa_secret_enc || cred.status !== 'ACTIVE') return { kind: 'invalid' };

    const code = input.code.trim();
    const secret = decryptSecret(cred.mfa_secret_enc, this.cfg.encryptionKey);
    const step = verifyTotp(secret, code, this.now().getTime(), cred.mfa_last_step === null ? null : Number(cred.mfa_last_step));
    if (step !== null) {
      ctx.uow.exec('update login_challenges set consumed = true where id = $1', [ch.id]);
      ctx.uow.exec('update user_credentials set mfa_last_step = $2, updated_at = $3 where user_id = $1', [user.id, step, this.iso()]);
      audit(this.store, user, 'auth.login', 'auth', user.id, { mfa: 'totp' });
      return { kind: 'session', session: this.newSession(ctx, user.id), user };
    }

    // A recovery code is single-use and works instead of an authenticator code.
    const hash = sha256(normaliseCode(code));
    if (/[A-Za-z]/.test(code) && cred.recovery_codes.includes(hash)) {
      ctx.uow.exec('update login_challenges set consumed = true where id = $1', [ch.id]);
      ctx.uow.exec('update user_credentials set recovery_codes = $2::jsonb, updated_at = $3 where user_id = $1', [user.id, JSON.stringify(cred.recovery_codes.filter((h) => h !== hash)), this.iso()]);
      audit(this.store, user, 'auth.login', 'auth', user.id, { mfa: 'recovery_code' });
      return { kind: 'session', session: this.newSession(ctx, user.id), user };
    }

    const attempts = ch.attempts + 1;
    ctx.uow.exec('update login_challenges set attempts = $2, consumed = $3 where id = $1', [ch.id, attempts, attempts >= this.cfg.maxChallengeAttempts]);
    audit(this.store, ANON(user.id), 'auth.mfa_failed', 'auth', user.id, { attempts });
    return { kind: 'invalid' };
  }

  async enrollMfa(ctx: Ctx, input: { challengeToken: string; code: string }): Promise<MfaResult> {
    const ch = await this.challenge(input.challengeToken, 'MFA_ENROLL');
    const user = ch ? this.userOf(ch.user_id) : undefined;
    if (!ch || !user || !ch.pending_secret_enc) return { kind: 'invalid' };
    const secret = decryptSecret(ch.pending_secret_enc, this.cfg.encryptionKey);
    const step = verifyTotp(secret, input.code.trim(), this.now().getTime(), null);
    if (step === null) {
      const attempts = ch.attempts + 1;
      ctx.uow.exec('update login_challenges set attempts = $2, consumed = $3 where id = $1', [ch.id, attempts, attempts >= this.cfg.maxChallengeAttempts]);
      audit(this.store, ANON(user.id), 'auth.mfa_enroll_failed', 'auth', user.id, { attempts });
      return { kind: 'invalid' };
    }
    const recoveryCodes = Array.from({ length: 8 }, () => newOneTimeCode(2, 5));
    ctx.uow.exec('update login_challenges set consumed = true where id = $1', [ch.id]);
    ctx.uow.exec(
      'update user_credentials set mfa_enabled = true, mfa_secret_enc = $2, mfa_last_step = $3, recovery_codes = $4::jsonb, updated_at = $5 where user_id = $1',
      [user.id, ch.pending_secret_enc, step, JSON.stringify(recoveryCodes.map((c) => sha256(normaliseCode(c)))), this.iso()],
    );
    audit(this.store, user, 'auth.mfa_enrolled', 'auth', user.id);
    return { kind: 'session', session: this.newSession(ctx, user.id), user, recoveryCodes };
  }

  // ------------------------------------------------------------------ sessions
  newSession(ctx: Ctx, userId: string): SessionInfo {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = this.iso(this.cfg.sessionAbsoluteMs);
    ctx.uow.exec('insert into sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent) values ($1,$2,$3,$4,$4,$5,$6,$7)', [
      sha256(token), userId, csrfToken, this.iso(), expiresAt, ctx.ip ?? null, (ctx.userAgent ?? '').slice(0, 300) || null,
    ]);
    return { token, csrfToken, expiresAt };
  }

  /** Looks up a session token. Returns null if it is unknown, revoked, expired (absolute or idle), or its user is disabled. */
  async authenticate(token: string): Promise<{ user: User; sessionId: string; csrfToken: string; expiresAt: string } | null> {
    if (!token || token.length > 200) return null;
    const id = sha256(token);
    const r = await this.db.query<{ user_id: string; csrf_token: string; last_seen_at: string; expires_at: string; revoked_at: string | null; status: string }>(
      'select s.user_id, s.csrf_token, s.last_seen_at, s.expires_at, s.revoked_at, u.status from sessions s join users u on u.id = s.user_id where s.id = $1', [id]);
    const row = r.rows[0];
    if (!row || row.revoked_at || row.status !== 'ACTIVE') return null;
    const now = this.now().getTime();
    if (new Date(row.expires_at).getTime() <= now) return null;
    if (now - new Date(row.last_seen_at).getTime() > this.cfg.sessionIdleMs) return null;
    const user = this.userOf(row.user_id);
    if (!user || user.status === 'DISABLED') return null;
    if (now - new Date(row.last_seen_at).getTime() > 60_000) {
      // sliding idle window, written at most once a minute and outside the business transaction
      await this.db.query('update sessions set last_seen_at = $2 where id = $1', [id, this.iso()]).catch(() => undefined);
    }
    return { user, sessionId: id, csrfToken: row.csrf_token, expiresAt: new Date(row.expires_at).toISOString() };
  }

  logout(ctx: Ctx, sessionId: string, user: User) {
    ctx.uow.exec('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [sessionId, this.iso()]);
    audit(this.store, user, 'auth.logout', 'auth', user.id);
  }

  revokeAllSessions(ctx: Ctx, userId: string, exceptSessionId?: string) {
    ctx.uow.exec('update sessions set revoked_at = $2 where user_id = $1 and revoked_at is null and id <> $3', [userId, this.iso(), exceptSessionId ?? '']);
  }

  // ------------------------------------------------------------------ passwords and activation
  /** Issues a one-time activation code for a first password or a reset. The plain code is returned once and never stored. */
  issueActivation(ctx: Ctx, userId: string): { code: string; expiresAt: string } {
    const code = newOneTimeCode();
    const expiresAt = this.iso(this.cfg.activationTtlMs);
    ctx.uow.exec('update user_credentials set activation_hash = $2, activation_expires_at = $3, updated_at = $4 where user_id = $1', [userId, sha256(normaliseCode(code)), expiresAt, this.iso()]);
    return { code, expiresAt };
  }

  async activate(ctx: Ctx, input: { username: string; code: string; newPassword: string }): Promise<{ ok: true } | { ok: false; problems?: string[] }> {
    const username = input.username.trim().toLowerCase();
    const r = await this.db.query<{ user_id: string; activation_expires_at: string | null }>(
      'select user_id, activation_expires_at from user_credentials where username = $1 and activation_hash = $2', [username, sha256(normaliseCode(input.code))]);
    const row = r.rows[0];
    const user = row ? this.userOf(row.user_id) : undefined;
    if (!row || !user || user.status === 'DISABLED' || !row.activation_expires_at || new Date(row.activation_expires_at) <= this.now()) {
      audit(this.store, ANON(), 'auth.activation_failed', 'auth', username);
      return { ok: false };
    }
    const problems = checkPassword(input.newPassword, { username, name: user.name });
    if (problems.length) return { ok: false, problems };
    ctx.uow.exec(
      'update user_credentials set password_hash = $2, password_changed_at = $3, activation_hash = null, activation_expires_at = null, failed_attempts = 0, locked_until = null, updated_at = $3 where user_id = $1',
      [user.id, await hashPassword(input.newPassword, this.cfg.scrypt), this.iso()],
    );
    this.revokeAllSessions(ctx, user.id);
    audit(this.store, user, 'auth.activated', 'auth', user.id);
    return { ok: true };
  }

  async changePassword(ctx: Ctx, user: User, sessionId: string, input: { currentPassword: string; newPassword: string }): Promise<{ ok: true } | { ok: false; reason: 'wrong_password' | 'weak'; problems?: string[] }> {
    const cred = await this.credentialsById(user.id);
    if (!cred?.password_hash || !(await verifyPassword(input.currentPassword, cred.password_hash))) {
      audit(this.store, user, 'auth.password_change_failed', 'auth', user.id);
      return { ok: false, reason: 'wrong_password' };
    }
    const problems = checkPassword(input.newPassword, { username: cred.username, name: user.name });
    if (problems.length) return { ok: false, reason: 'weak', problems };
    ctx.uow.exec('update user_credentials set password_hash = $2, password_changed_at = $3, updated_at = $3 where user_id = $1', [user.id, await hashPassword(input.newPassword, this.cfg.scrypt), this.iso()]);
    this.revokeAllSessions(ctx, user.id, sessionId); // other devices are signed out
    audit(this.store, user, 'auth.password_changed', 'auth', user.id);
    return { ok: true };
  }

  /** Clears a lost authenticator: the user must enrol again at next sign-in. */
  resetMfa(ctx: Ctx, userId: string) {
    ctx.uow.exec("update user_credentials set mfa_enabled = false, mfa_secret_enc = null, mfa_last_step = null, recovery_codes = '[]'::jsonb, updated_at = $2 where user_id = $1", [userId, this.iso()]);
    this.revokeAllSessions(ctx, userId);
  }
}
