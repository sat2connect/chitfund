import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * LOCAL DEVELOPMENT ONLY. Runs a real PostgreSQL engine (embedded, no install needed) on a local port, with its files in
 * ./.pgdata, so the whole stack can be exercised without a database server.  It is a single connection and is NOT
 * a production database.
 *   npm run db:embedded           then use  DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres
 */
const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
const dir = process.env.EMBEDDED_PG_DIR ?? './.pgdata';
const db = await PGlite.create(dir);
// The embedded engine is one connection; the server multiplexes several clients over it (fine for development).
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
await server.start();
console.log(`Embedded PostgreSQL (development only) listening on 127.0.0.1:${port}, data in ${dir}`);
console.log(`DATABASE_URL=postgres://postgres@127.0.0.1:${port}/postgres`);
const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);