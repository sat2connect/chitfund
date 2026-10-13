const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

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
