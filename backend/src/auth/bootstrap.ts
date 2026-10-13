import type { User } from '../domain/types.js';
import { UnitOfWork, type PersistentStore } from '../persistence/persistentStore.js';
import type { Store } from '../repositories/store.js';
import { audit } from '../services/common.js';
import { EMAIL } from '../validators/input.js';
import { hashPassword, type ScryptCost, DEFAULT_SCRYPT } from './crypto.js';
import { checkPassword } from './passwordPolicy.js';

/**
 * Creates the very first administrator on an empty system. The password comes from the operator (environment
 * variable, never a command-line argument) and must meet the same policy as everyone else's. The administrator
 * still enrols a second factor at first sign-in.
 */
export async function createInitialAdmin(
  persist: PersistentStore,
  store: Store,
  input: { name: string; username: string; password: string },
  cost: ScryptCost = DEFAULT_SCRYPT,
): Promise<User> {
  const username = input.username.trim().toLowerCase();
  if (!EMAIL.test(username)) throw new Error('The administrator username must be an email address');
  const problems = checkPassword(input.password, { username, name: input.name });
  if (problems.length) throw new Error(`Password rejected: ${problems.join('; ')}`);
  if (store.users.some((u) => u.roles.includes('SUPER_ADMIN'))) throw new Error('An administrator already exists. Use the application to manage users.');

  const user: User = { id: store.nextId('USR'), name: input.name.trim(), roles: ['SUPER_ADMIN'], branchIds: 'ALL', status: 'ACTIVE' };
  store.users.push(user);
  audit(store, user, 'user.bootstrap_admin', 'user', user.id);
  const uow = new UnitOfWork();
  uow.exec('insert into user_credentials (user_id, username, password_hash, password_changed_at) values ($1, $2, $3, $4)', [
    user.id, username, await hashPassword(input.password, cost), store.now().toISOString(),
  ]);
  try {
    await persist.commit(uow);
  } catch (e) {
    persist.restore();
    throw e;
  }
  return user;
}
