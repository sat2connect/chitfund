import { createInitialAdmin } from '../auth/bootstrap.js';
import { connectWithStore, isMain, run } from './common.js';

/**
 * Creates the first administrator. Values come from the environment so the password never appears in shell history
 * or process listings:  BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD
 */
export async function main() {
  const name = process.env.BOOTSTRAP_ADMIN_NAME;
  const username = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!name || !username || !password) throw new Error('Set BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD');
  const { db, store, persist } = await connectWithStore();
  try {
    const user = await createInitialAdmin(persist, store, { name, username, password });
    console.log(`Created administrator ${user.id} (${username}). Sign in, then enrol a second factor when asked.`);
  } finally {
    await db.close();
  }
}
if (isMain(import.meta.url)) await run(main);