import { Router, type Request, type RequestHandler, type Response } from 'express';
import { AppError, badRequest } from '../errors/AppError.js';
import { permissionsOf } from '../policies/access.js';
import { rateLimit } from '../security/rateLimit.js';
import { Check } from '../validators/input.js';
import type { AuthService, Ctx, SessionInfo } from './authService.js';
import { PASSWORD_MIN } from './passwordPolicy.js';
import { sessionCookieName } from './sessionAuth.js';
import type { User } from '../domain/types.js';

export interface AuthRouteOptions {
  cookieSecure: boolean;
  sessionAbsoluteMs: number;
  loginRateLimit: { windowMs: number; max: number };
  authenticate: RequestHandler;
}

const publicUser = (u: User) => ({ id: u.id, name: u.name, roles: u.roles, branchIds: u.branchIds, customerId: u.customerId });
const body = (r: Request) => (r.body ?? {}) as Record<string, unknown>;

/** Authentication endpoints. Everything that changes data goes through the request's unit of work. */
export const createAuthRouter = (auth: AuthService, opts: AuthRouteOptions) => {
  const r = Router();
  const limiter = rateLimit(opts.loginRateLimit);
  const cookieName = sessionCookieName(opts.cookieSecure);

  const ctxOf = (req: Request): Ctx => {
    if (!req.uow) throw new Error('Authentication requires persistence (no unit of work on this request)');
    return { uow: req.uow, ip: req.ip, userAgent: req.header('user-agent') };
  };
  const fail = (res: Response, status: number, code: string, message: string, extra?: Record<string, unknown>) => {
    res.locals.keepChanges = true; // failed sign-ins must still be recorded (counters, audit trail)
    return new AppError(status, code, message, extra);
  };
  const startSession = (res: Response, s: SessionInfo, user: User, extra: Record<string, unknown> = {}) => {
    res.cookie(cookieName, s.token, { httpOnly: true, secure: opts.cookieSecure, sameSite: 'lax', path: '/', maxAge: opts.sessionAbsoluteMs });
    res.status(200).json({ status: 'AUTHENTICATED', user: publicUser(user), permissions: permissionsOf(user), csrfToken: s.csrfToken, expiresAt: s.expiresAt, ...extra });
  };

  r.get('/config', (_req, res) => {
    res.json({ mode: 'session', passwordMinLength: PASSWORD_MIN, mfa: 'Required for staff accounts' });
  });

  r.post('/login', limiter, async (req, res) => {
    const c = new Check(body(req));
    const username = c.str('username', { required: true, max: 120 });
    const password = typeof body(req).password === 'string' ? (body(req).password as string) : '';
    if (!password) c.errors.password = 'Required';
    c.done();
    const result = await auth.login(ctxOf(req), { username: username!, password });
    switch (result.kind) {
      case 'invalid': throw fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');
      case 'locked': throw fail(res, 429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { until: result.until });
      case 'session': return startSession(res, result.session, result.user);
      case 'mfa_required': return void res.json({ status: 'MFA_REQUIRED', challengeToken: result.challengeToken });
      case 'mfa_enrollment_required':
        return void res.json({ status: 'MFA_ENROLLMENT_REQUIRED', challengeToken: result.challengeToken, secret: result.secret, otpauthUri: result.otpauthUri });
    }
  });

  r.post('/mfa/verify', limiter, async (req, res) => {
    const c = new Check(body(req));
    const challengeToken = c.str('challengeToken', { required: true, max: 200 });
    const code = c.str('code', { required: true, max: 40 });
    c.done();
    const result = await auth.verifyMfa(ctxOf(req), { challengeToken: challengeToken!, code: code! });
    if (result.kind === 'invalid') throw fail(res, 401, 'INVALID_CODE', 'That code is not valid or has expired');
    startSession(res, result.session, result.user);
  });

  r.post('/mfa/enroll', limiter, async (req, res) => {
    const c = new Check(body(req));
    const challengeToken = c.str('challengeToken', { required: true, max: 200 });
    const code = c.str('code', { required: true, max: 40 });
    c.done();
    const result = await auth.enrollMfa(ctxOf(req), { challengeToken: challengeToken!, code: code! });
    if (result.kind === 'invalid') throw fail(res, 401, 'INVALID_CODE', 'That code is not valid or has expired');
    startSession(res, result.session, result.user, { recoveryCodes: result.recoveryCodes, recoveryNotice: 'Store these recovery codes safely. They are shown only once and each works once.' });
  });

  r.post('/activate', limiter, async (req, res) => {
    const c = new Check(body(req));
    const username = c.str('username', { required: true, max: 120 });
    const code = c.str('code', { required: true, max: 60 });
    const newPassword = typeof body(req).newPassword === 'string' ? (body(req).newPassword as string) : '';
    if (!newPassword) c.errors.newPassword = 'Required';
    c.done();
    const result = await auth.activate(ctxOf(req), { username: username!, code: code!, newPassword });
    if (!result.ok && result.problems) throw badRequest('Choose a stronger password', { newPassword: result.problems.join('. ') });
    if (!result.ok) throw fail(res, 400, 'INVALID_ACTIVATION', 'This activation code is not valid or has expired');
    res.json({ status: 'ACTIVATED' });
  });

  // ---- below here a session is required
  r.get('/session', opts.authenticate, (req, res) => {
    res.json({ user: publicUser(req.user!), permissions: permissionsOf(req.user!), csrfToken: req.session!.csrfToken, expiresAt: req.session!.expiresAt });
  });

  r.post('/logout', opts.authenticate, (req, res) => {
    auth.logout(ctxOf(req), req.session!.id, req.user!);
    res.clearCookie(cookieName, { httpOnly: true, secure: opts.cookieSecure, sameSite: 'lax', path: '/' });
    res.json({ status: 'SIGNED_OUT' });
  });

  r.post('/change-password', opts.authenticate, limiter, async (req, res) => {
    const currentPassword = typeof body(req).currentPassword === 'string' ? (body(req).currentPassword as string) : '';
    const newPassword = typeof body(req).newPassword === 'string' ? (body(req).newPassword as string) : '';
    if (!currentPassword || !newPassword) throw badRequest('Validation failed', { currentPassword: currentPassword ? undefined : 'Required', newPassword: newPassword ? undefined : 'Required' });
    const result = await auth.changePassword(ctxOf(req), req.user!, req.session!.id, { currentPassword, newPassword });
    if (!result.ok && result.reason === 'weak') throw badRequest('Choose a stronger password', { newPassword: result.problems!.join('. ') });
    if (!result.ok) throw fail(res, 403, 'WRONG_PASSWORD', 'Your current password is not correct');
    res.json({ status: 'PASSWORD_CHANGED' });
  });

  return r;
};
