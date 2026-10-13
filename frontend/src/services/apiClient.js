const DEV_DEFAULT = 'http://localhost:4000/api/v1';
const PROD_DEFAULT = '/api/v1'; // same-origin: Vercel proxies /api/* to the backend, so the session cookie stays first-party

/**
 * Where the API lives.
 *  - Development: the VITE variable (or the older VITE_API_BASE_URL), or the local backend.
 *  - Production: always same-origin (/api/v1). A value pointing at another origin is ignored, because the browser would
 *    block it (content-security policy) and would not send the sign-in cookie anyway.
 */
export const resolveBaseUrl = (configured, { prod, origin }) => {
  const value = (configured ?? '').trim();
  if (!prod) return value || DEV_DEFAULT;
  if (!value) return PROD_DEFAULT;
  try {
    if (new URL(value, origin).origin === origin) return value;
  } catch {
    /* unparseable: fall through */
  }
  console.warn(`Ignoring the API address (VITE)="${value}" in production: it must be same-origin. Using ${PROD_DEFAULT}.`);
  return PROD_DEFAULT;
};

const BASE_URL = resolveBaseUrl(import.meta.env.VITE ?? import.meta.env.VITE_API_BASE_URL, {
  prod: import.meta.env.PROD,
  origin: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
});

export class ApiError extends Error {
  constructor(message, { status, code, requestId, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

// DEVELOPMENT ONLY: the simulated sign-in sends the chosen dev user id. The server ignores this header in session mode.
let currentUserId = null;
export const setCurrentUserId = (id) => {
  currentUserId = id;
};

// Session mode: the browser holds an HttpOnly session cookie; state-changing requests also carry the CSRF token.
let csrfToken = null;
export const setCsrfToken = (t) => {
  csrfToken = t;
};

// Called when the server says the session is gone, so the app can return to the sign-in screen.
let onSessionLost = null;
export const setSessionLostHandler = (fn) => {
  onSessionLost = fn;
};

export const toQuery = (params = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
};

// Central request helper: every feature service goes through here for consistent error handling.
export async function apiRequest(path, { method = 'GET', body, signal, quiet401 = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (currentUserId) headers['x-dev-user'] = currentUserId;
  if (csrfToken && method !== 'GET') headers['x-csrf-token'] = csrfToken;
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Cannot reach the server. Check that the backend is running.', { code: 'NETWORK_ERROR' });
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = payload?.error;
    if (res.status === 401 && err?.code === 'UNAUTHENTICATED' && !quiet401) onSessionLost?.();
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, {
      status: res.status,
      code: err?.code,
      requestId: err?.requestId,
      details: err?.details,
    });
  }
  return payload;
}
