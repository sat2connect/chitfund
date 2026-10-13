import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest, setCsrfToken, setCurrentUserId, setSessionLostHandler } from '../services/apiClient.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const KEY = 'crm.devUser';
const readStored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/**
 * Two modes, decided by the server:
 *  - session: real accounts. The browser holds an HttpOnly cookie; this context only keeps the signed-in user.
 *  - dev: a SIMULATED sign-in (development only) to switch between seeded users.
 * UI permission checks here are for UX only; the backend enforces every permission and branch rule independently.
 */
export function AuthProvider({ children }) {
  const [mode, setMode] = useState(null); // null while the server is being asked
  const [devUsers, setDevUsers] = useState([]);
  const [devUserId, setDevUserId] = useState(readStored());
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((s) => {
    setCsrfToken(s.csrfToken ?? null);
    setMe({ user: s.user, permissions: s.permissions });
    setError(null);
  }, []);

  // Decide the mode, and in session mode restore an existing session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cfg = null;
      try {
        cfg = await apiRequest('/auth/config', { quiet401: true });
      } catch {
        cfg = null; // not session mode (or the server is down: the dev path reports that below)
      }
      if (cancelled) return;
      if (cfg?.mode === 'session') {
        setMode('session');
        setSessionLostHandler(() => {
          setCsrfToken(null);
          setMe(null);
        });
        try {
          applySession(await apiRequest('/auth/session', { quiet401: true }));
        } catch {
          setMe(null);
        }
        setLoading(false);
        return;
      }
      setMode('dev');
      try {
        const r = await apiRequest('/dev/users');
        if (cancelled) return;
        setDevUsers(r.users);
        setDevUserId((cur) => (cur && r.users.some((u) => u.id === cur) ? cur : r.users[0]?.id ?? null));
      } catch (e) {
        setError(e);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  // Dev mode: load the chosen simulated user.
  useEffect(() => {
    if (mode !== 'dev' || !devUserId) return;
    setCurrentUserId(devUserId);
    try {
      localStorage.setItem(KEY, devUserId);
    } catch {
      /* storage unavailable */
    }
    setLoading(true);
    apiRequest('/me')
      .then((r) => {
        setMe(r);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [mode, devUserId]);

  const login = useCallback((username, password) => apiRequest('/auth/login', { method: 'POST', body: { username, password }, quiet401: true }), []);
  const verifyMfa = useCallback(async (challengeToken, code) => {
    const s = await apiRequest('/auth/mfa/verify', { method: 'POST', body: { challengeToken, code }, quiet401: true });
    applySession(s);
    return s;
  }, [applySession]);
  /** Enrolment signs the user in on the server; the UI keeps the recovery codes on screen until they are acknowledged. */
  const enrollMfa = useCallback((challengeToken, code) => apiRequest('/auth/mfa/enroll', { method: 'POST', body: { challengeToken, code }, quiet401: true }), []);
  const completeSignIn = useCallback((s) => applySession(s), [applySession]);
  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', quiet401: true });
    } finally {
      setCsrfToken(null);
      setMe(null);
    }
  }, []);

  const can = useCallback((p) => Boolean(me?.permissions.includes(p)), [me]);
  const value = useMemo(
    () => ({
      mode, devUsers, user: me?.user ?? null, permissions: me?.permissions ?? [], can, loading, error,
      switchUser: setDevUserId, login, verifyMfa, enrollMfa, completeSignIn, logout,
    }),
    [mode, devUsers, me, can, loading, error, login, verifyMfa, enrollMfa, completeSignIn, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
