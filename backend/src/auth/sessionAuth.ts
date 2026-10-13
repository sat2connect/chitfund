import type { Request, RequestHandler } from 'express';
import { forbidden, unauthorized } from '../errors/AppError.js';
import type { AuthService } from './authService.js';

declare module 'express-serve-static-core' {
  interface Request { session?: { id: string; csrfToken: string; expiresAt: string; viaCookie: boolean } }
}

export const sessionCookieName = (secure: boolean) => (secure ? '__Host-session' : 'session');

export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Resolves the caller from a session cookie (web) or a bearer token (future mobile app) and sets `req.user`.
 * Cookie sessions on state-changing requests must also present the CSRF token and come from an allowed origin.
 */
export const sessionAuthenticate = (auth: AuthService, opts: { cookieName: string; allowedOrigins: string[] }): RequestHandler => async (req, _res, next) => {
  try {
    const bearer = /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1];
    const cookie = readCookie(req, opts.cookieName);
    const token = bearer ?? cookie;
    if (!token) return next(unauthorized('Sign in to continue'));
    const s = await auth.authenticate(token);
    if (!s) return next(unauthorized('Your session has expired. Please sign in again.'));

    const viaCookie = !bearer;
    if (viaCookie && !SAFE.has(req.method)) {
      const origin = req.header('origin');
      if (origin && !opts.allowedOrigins.includes(origin)) return next(forbidden('Request origin is not allowed', 'CSRF_ORIGIN'));
      if (req.header('x-csrf-token') !== s.csrfToken) return next(forbidden('Missing or invalid CSRF token', 'CSRF'));
    }
    req.user = s.user;
    req.session = { id: s.sessionId, csrfToken: s.csrfToken, expiresAt: s.expiresAt, viaCookie };
    next();
  } catch (e) {
    next(e);
  }
};
