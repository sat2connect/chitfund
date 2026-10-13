import type { Db } from '../db/Db.js';
import type { Role, User } from '../domain/types.js';
import { badRequest, conflict, forbidden, notFound } from '../errors/AppError.js';
import type { Store } from '../repositories/store.js';
import { audit } from '../services/common.js';
import { Check, EMAIL } from '../validators/input.js';
import type { AuthService, Ctx } from './authService.js';

export const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'OPS_HEAD', 'BRANCH_MANAGER', 'CRM_EXEC', 'KYC_OFFICER', 'CHIT_OPS', 'AUDITOR', 'COLLECTION_OFFICER', 'FINANCE_MAKER', 'FINANCE_CHECKER', 'AUCTION_OFFICER'];

/**
 * Separation of duties: one person must not hold both sides of a maker-checker pair, and an administrator
 * must not also hold financial or approval roles. (The workflows enforce this per transaction as well.)
 */
export const FORBIDDEN_ROLE_PAIRS: [Role, Role][] = [
  ['FINANCE_MAKER', 'FINANCE_CHECKER'],
  ['CHIT_OPS', 'OPS_HEAD'],
  ['AUCTION_OFFICER', 'OPS_HEAD'],
  ['SUPER_ADMIN', 'FINANCE_MAKER'],
  ['SUPER_ADMIN', 'FINANCE_CHECKER'],
  ['SUPER_ADMIN', 'OPS_HEAD'],
  ['COLLECTION_OFFICER', 'FINANCE_CHECKER'],
];

type Body = Record<string, unknown>;

export const createUserAdminService = (db: Db, store: Store, auth: AuthService) => {
  const find = (id: string) => {
    const u = store.users.find((x) => x.id === id);
    if (!u) throw notFound('User');
    return u;
  };

  const parseAccess = (c: Check, body: Body) => {
    const roles = c.list('roles', { max: 6 }) as Role[];
    if (roles.length === 0) c.errors.roles = 'Choose at least one role';
    for (const r of roles) if (!STAFF_ROLES.includes(r)) c.errors.roles = `Unknown or unassignable role: ${r}`;
    for (const [a, b] of FORBIDDEN_ROLE_PAIRS) {
      if (roles.includes(a) && roles.includes(b)) c.errors.roles = `${a} and ${b} cannot be held by the same person (separation of duties)`;
    }
    let branchIds: string[] | 'ALL';
    if (body.branchIds === 'ALL') branchIds = 'ALL';
    else {
      const list = Array.isArray(body.branchIds) ? (body.branchIds as unknown[]).map(String) : [];
      if (list.length === 0) c.errors.branchIds = 'Choose ALL or at least one branch';
      for (const b of list) if (!store.branches.some((x) => x.id === b)) c.errors.branchIds = `Unknown branch: ${b}`;
      branchIds = list;
    }
    return { roles, branchIds };
  };

  return {
    async list() {
      const creds = await db.query<{ user_id: string; username: string; activated: boolean; mfa_enabled: boolean; locked_until: string | null; last_login_at: string | null }>(
        'select user_id, username, (password_hash is not null) as activated, mfa_enabled, locked_until, last_login_at from user_credentials');
      const byUser = new Map(creds.rows.map((c) => [c.user_id, c]));
      return {
        items: store.users.map((u) => {
          const c = byUser.get(u.id);
          return {
            id: u.id, name: u.name, roles: u.roles, branchIds: u.branchIds, customerId: u.customerId, status: u.status ?? 'ACTIVE',
            username: c?.username, activated: c?.activated ?? false, mfaEnabled: c?.mfa_enabled ?? false,
            lockedUntil: c?.locked_until && new Date(c.locked_until) > store.now() ? c.locked_until : undefined, lastLoginAt: c?.last_login_at ?? undefined,
          };
        }),
      };
    },

    async createStaff(ctx: Ctx, actor: User, body: Body) {
      const c = new Check(body);
      const name = c.str('name', { required: true, min: 3, max: 100 });
      const username = c.str('username', { required: true, pattern: EMAIL, msg: 'Use the person\'s work email address' })?.toLowerCase();
      const access = parseAccess(c, body);
      c.done();
      if (store.users.length && (await db.query('select 1 from user_credentials where username = $1', [username])).rowCount > 0) {
        throw conflict('USERNAME_TAKEN', 'An account with this email already exists');
      }
      const user: User = { id: store.nextId('USR'), name: name!, roles: access.roles, branchIds: access.branchIds, status: 'ACTIVE' };
      store.users.push(user);
      ctx.uow.exec('insert into user_credentials (user_id, username) values ($1, $2)', [user.id, username]);
      const activation = auth.issueActivation(ctx, user.id);
      audit(store, actor, 'user.create', 'user', user.id, { roles: user.roles, branchIds: user.branchIds });
      return { user: { id: user.id, name: user.name, username }, activation };
    },

    async createMemberAccount(ctx: Ctx, actor: User, body: Body) {
      const c = new Check(body);
      const customerId = c.str('customerId', { required: true });
      c.done();
      const customer = store.customers.find((x) => x.id === customerId);
      if (!customer) throw notFound('Customer');
      if (customer.kycStatus !== 'VERIFIED') throw conflict('KYC_NOT_VERIFIED', 'Portal access needs verified KYC');
      if (store.users.some((u) => u.customerId === customer.id)) throw conflict('ACCOUNT_EXISTS', 'This customer already has a portal account');
      const username = customer.phone;
      if ((await db.query('select 1 from user_credentials where username = $1', [username])).rowCount > 0) {
        throw conflict('USERNAME_TAKEN', 'Another account already uses this mobile number');
      }
      const user: User = { id: `u-member-${customer.id}`, name: customer.name, roles: ['CHIT_MEMBER'], branchIds: [], customerId: customer.id, status: 'ACTIVE' };
      store.users.push(user);
      ctx.uow.exec('insert into user_credentials (user_id, username) values ($1, $2)', [user.id, username]);
      const activation = auth.issueActivation(ctx, user.id);
      audit(store, actor, 'user.create_member', 'user', user.id, { customerId: customer.id });
      return { user: { id: user.id, name: user.name, username }, activation };
    },

    updateAccess(ctx: Ctx, actor: User, id: string, body: Body) {
      const u = find(id);
      if (u.id === actor.id) throw forbidden('You cannot change your own access', 'SELF_CHANGE');
      if (u.customerId) throw badRequest('Member accounts have no staff roles');
      const c = new Check(body);
      const access = parseAccess(c, body);
      c.done();
      const before = { roles: u.roles, branchIds: u.branchIds };
      u.roles = access.roles;
      u.branchIds = access.branchIds;
      auth.revokeAllSessions(ctx, u.id); // permissions changed: sign the user in again
      audit(store, actor, 'user.access_change', 'user', u.id, { before, after: { roles: u.roles, branchIds: u.branchIds } });
      return { id: u.id };
    },

    setDisabled(ctx: Ctx, actor: User, id: string, disabled: boolean) {
      const u = find(id);
      if (u.id === actor.id) throw forbidden('You cannot disable your own account', 'SELF_CHANGE');
      u.status = disabled ? 'DISABLED' : 'ACTIVE';
      if (disabled) auth.revokeAllSessions(ctx, u.id);
      audit(store, actor, disabled ? 'user.disable' : 'user.enable', 'user', u.id);
      return { id: u.id, status: u.status };
    },

    async issueActivation(ctx: Ctx, actor: User, id: string) {
      const u = find(id);
      if (u.status === 'DISABLED') throw conflict('USER_DISABLED', 'Enable the account first');
      if (!((await db.query('select 1 from user_credentials where user_id = $1', [u.id])).rowCount > 0)) throw conflict('NO_CREDENTIALS', 'This user has no sign-in account');
      const activation = auth.issueActivation(ctx, u.id);
      audit(store, actor, 'user.activation_issued', 'user', u.id);
      return { activation };
    },

    resetMfa(ctx: Ctx, actor: User, id: string) {
      const u = find(id);
      auth.resetMfa(ctx, u.id);
      audit(store, actor, 'user.mfa_reset', 'user', u.id);
      return { id: u.id };
    },
  };
};

export type UserAdminService = ReturnType<typeof createUserAdminService>;
