import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';

/**
 * Fixed-window rate limiter held in this process's memory.
 * That is correct while ONE backend process serves traffic (the supported deployment); with several processes
 * the limit would apply per process and a shared store would be needed.
 */
export const rateLimit = (opts: { windowMs: number; max: number; key?: (req: Parameters<RequestHandler>[0]) => string; now?: () => number }): RequestHandler => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  return (req, res, next) => {
    const t = now();
    const key = opts.key ? opts.key(req) : (req.ip ?? 'unknown');
    let h = hits.get(key);
    if (!h || h.resetAt <= t) {
      h = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, h);
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k); // bound memory
    }
    h.count += 1;
    if (h.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((h.resetAt - t) / 1000)));
      next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.'));
      return;
    }
    next();
  };
};
