import { migrate } from '../db/migrate.js';
import { connect, isMain, run } from './common.js';

/** Applies pending SQL migrations. Run this as a deliberate deployment step; the server refuses to start if any are pending. */
export async function main() {
  const { db } = connect();
  try {
    const r = await migrate(db);
    console.log(r.applied.length ? `Applied: ${r.applied.join(', ')}` : 'Database schema is up to date.');
  } finally {
    await db.close();
  }
}
if (isMain(import.meta.url)) await run(main);