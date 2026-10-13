import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { pgErrorCode } from '../db/Db.js';
import { UnitOfWork, type PersistentStore } from './persistentStore.js';

/** First-in-first-out gate: one request touches the working state at a time. */
export class RequestGate {
  private tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const prev = this.tail;
    this.tail = new Promise<void>((r) => { release = r; });
    return prev.then(() => release);
  }
}

declare module 'express-serve-static-core' {
  interface Request { uow?: UnitOfWork }
  interface Locals { keepChanges?: boolean; errorCode?: string; requestId?: string }
}

/** Failed requests whose recorded state is intentional and must still be kept. */
const KEEP_ON_ERROR = new Set(['ATTEMPT_FINALIZED']);

const send = (res: Response, end: (...a: unknown[]) => Response, status: number, code: string, message: string) => {
  res.status(status);
  // the handler's body is being replaced: its length and validators no longer apply
  res.removeHeader('content-length');
  res.removeHeader('etag');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  end(JSON.stringify({ error: { code, message, requestId: res.locals.requestId } }));
};

/**
 * Wraps every API request:
 *  1. waits its turn (reads never see a half-applied change);
 *  2. lets the handler change the in-memory state;
 *  3. BEFORE the response is sent, commits those changes to PostgreSQL in one transaction;
 *  4. if the request failed (or the commit is rejected) puts memory back, so memory and database never disagree.
 * If memory cannot be put back, the process marks itself unhealthy and refuses further requests until restarted.
 */
export const unitOfWork = (persist: PersistentStore, gate: RequestGate): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
  const release = await gate.acquire();
  if (persist.poisoned) {
    release();
    res.status(503).json({ error: { code: 'SERVICE_UNHEALTHY', message: 'The service is restarting its data. Please retry shortly.', requestId: res.locals.requestId } });
    return;
  }
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  if (!mutating) {
    res.once('close', release);
    next();
    return;
  }

  const uow = new UnitOfWork();
  req.uow = uow;
  const originalEnd = res.end.bind(res) as (...a: unknown[]) => Response;
  let sent = false;

  // Hold the response until the change is durable.
  (res as unknown as { end: (...a: unknown[]) => Response }).end = (...args: unknown[]) => {
    if (sent) return originalEnd(...args);
    sent = true;
    const keep = res.statusCode < 400 || res.locals.keepChanges === true || KEEP_ON_ERROR.has(res.locals.errorCode ?? '');
    const finish = async () => {
      let failure: unknown;
      try {
        if (keep) await persist.commit(uow);
        else persist.restore();
      } catch (e) {
        failure = e;
        try {
          persist.restore();
        } catch (restoreError) {
          persist.poisoned = true; // memory may now disagree with the database: stop serving until restarted
          console.error(`[${res.locals.requestId}] FATAL: could not restore in-memory state:`, (restoreError as Error).message);
        }
      }
      try {
        if (failure === undefined) {
          originalEnd(...args);
        } else {
          const integrity = String(pgErrorCode(failure) ?? '').startsWith('23');
          console.error(`[${res.locals.requestId}] commit failed:`, (failure as Error).message);
          if (integrity) send(res, originalEnd, 409, 'INTEGRITY_VIOLATION', 'The database refused this change to protect data integrity. Nothing was saved.');
          else send(res, originalEnd, 500, 'PERSISTENCE_ERROR', 'Your change could not be saved. Nothing was changed; please try again.');
        }
      } finally {
        release();
      }
    };
    void finish();
    return res;
  };
  next();
};
