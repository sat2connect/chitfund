import type { IncomingMessage, ServerResponse } from 'node:http';
import { createInitialAdmin } from './auth/bootstrap.js';
import { initPilot, type PilotConfig } from './cli/initPilot.js';
import type { Db } from './db/Db.js';
import type { PersistentStore } from './persistence/persistentStore.js';
import type { Store } from './repositories/store.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Platforms such as Render start the NEW instance while the OLD one is still running, and stop the old one only after
 * the new one reports healthy. With a single-writer lock the new instance must therefore wait for the old one to let go
 * instead of exiting. Returns false if the lock is still held after the timeout.
 */
export async function acquireWriterLockWithRetry(
  db: Pick<Db, 'acquireWriterLock'>,
  key: number,
  opts: { timeoutMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void } = {},
): Promise<boolean> {
  const { timeoutMs = 5 * 60_000, intervalMs = 2_000, now = Date.now, sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)), log = console.log } = opts;
  const start = now();
  let waited = false;
  for (;;) {
    if (await db.acquireWriterLock(key)) return true;
    if (now() - start >= timeoutMs) return false;
    if (!waited) {
      waited = true;
      log('Another instance holds the writer lock (normal during a rolling deploy). Waiting for it to finish...');
    }
    await sleep(intervalMs);
  }
}

/**
 * Answers immediately while the service finishes starting (waiting for the lock, loading data): the liveness check
 * passes so the platform can retire the old instance, and every other request gets a clear, retryable 503.
 */
export function createStartupGate() {
  let app: Handler | undefined;
  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
  };
  const handler: Handler = (req, res) => {
    if (app) return app(req, res);
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/api/v1/health') return json(res, 200, { status: 'starting' });
    return json(res, 503, { error: { code: 'STARTING', message: 'The service is starting. Please retry in a few seconds.' } }, { 'retry-after': '5' });
  };
  return { handler, ready: (a: Handler) => { app = a; }, isReady: () => app !== undefined };
}

export interface ProvisionResult {
  pilot: boolean;
  admin: boolean;
}

/**
 * One-time setup for hosts without a shell (set PROVISION_ON_START=true for the first start only):
 *  - PILOT_CONFIG_JSON: the accountant-approved reference data (same content as the init-pilot file)
 *  - BOOTSTRAP_ADMIN_NAME / _EMAIL / _PASSWORD: the first administrator
 * Each step runs only on a system that does not have that data yet, so repeated starts change nothing.
 * Remove the variables (especially the password) from the host after the first successful start.
 */
export async function provisionOnStart(persist: PersistentStore, store: Store, env: NodeJS.ProcessEnv, log: (m: string) => void = console.log): Promise<ProvisionResult> {
  const result: ProvisionResult = { pilot: false, admin: false };
  if (env.PROVISION_ON_START !== 'true') return result;

  if (env.PILOT_CONFIG_JSON && store.branches.length === 0 && store.accounts.length === 0 && store.periods.length === 0) {
    let config: PilotConfig;
    try {
      config = JSON.parse(env.PILOT_CONFIG_JSON) as PilotConfig;
    } catch {
      throw new Error('PILOT_CONFIG_JSON is not valid JSON');
    }
    await initPilot(persist, store, config);
    result.pilot = true;
    log(`Provisioned reference data: ${config.branches.length} branch(es), ${config.accounts.length} account(s).`);
  }

  const { BOOTSTRAP_ADMIN_NAME: name, BOOTSTRAP_ADMIN_EMAIL: username, BOOTSTRAP_ADMIN_PASSWORD: password } = env;
  if (name && username && password && !store.users.some((u) => u.roles.includes('SUPER_ADMIN'))) {
    const user = await createInitialAdmin(persist, store, { name, username, password });
    result.admin = true;
    log(`Created the first administrator ${user.id} (${username}). Remove BOOTSTRAP_ADMIN_PASSWORD from the host now.`);
  }
  return result;
}
