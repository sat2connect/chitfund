import type { RequestHandler } from 'express';
import type { Permission, User } from '../domain/types.js';
import { unauthorized } from '../errors/AppError.js';
import { assertPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';

declare module 'express-serve-static-core' {
  interface Request { user?: User }
}

/**
 * SIMULATED authentication for development: identifies the caller via the `x-dev-user` header.
 * It is NOT secure. The real provider/session strategy is undecided; this is the single seam
 * to replace (everything downstream only reads `req.user`).
 */
export const devAuthenticate = (store: Store): RequestHandler => (req, _res, next) => {
  const id = req.header('x-dev-user');
  const user = id ? store.users.find((u) => u.id === id) : undefined;
  if (!user) return next(unauthorized('Sign in (simulated) to continue'));
  req.user = user;
  next();
};

export const requirePermission = (p: Permission): RequestHandler => (req, _res, next) => {
  try {
    assertPermission(req.user!, p);
    next();
  } catch (e) {
    next(e);
  }
};
