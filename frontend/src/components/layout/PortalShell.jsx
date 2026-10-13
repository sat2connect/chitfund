import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { ErrorState, LoadingState } from '../feedback/States.jsx';
import UserMenu from './UserMenu.jsx';

const links = [
  { to: '/portal', label: 'Home', end: true },
  { to: '/portal/instalments', label: 'Dues' },
  { to: '/portal/pay', label: 'Pay' },
  { to: '/portal/payments', label: 'Payments' },
  { to: '/portal/statement', label: 'Statement' },
  { to: '/auctions', label: 'Auctions' },
  { to: '/portal/payouts', label: 'Prize payouts' },
  { to: '/portal/support', label: 'Support' },
  { to: '/portal/profile', label: 'Profile' },
];

/** Customer-facing shell: mobile-first, single column, no staff navigation. */
export default function PortalShell() {
  const { user, loading, error, mode } = useAuth();
  const { pathname } = useLocation();
  // exact prefixes with a trailing slash so '/accounting' (a staff area) is not mistaken for '/account/...'
  const allowed = ['/portal', '/auctions', '/account/'].some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded bg-brand-900 text-sm text-white">CF</span>
            <span>Chit Fund Member Portal</span>
          </div>
          <UserMenu />
        </div>
        <nav aria-label="Portal" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => `whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {mode === 'dev' && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          Simulated sign-in (development mode) and sample data. No payment gateway is connected, and no real money moves.
        </div>
      )}
      <main className="mx-auto max-w-5xl px-4 py-5">
        {error && !user ? <ErrorState error={error} /> : loading && !user ? <LoadingState label="Signing in…" /> : !allowed ? <Navigate to="/portal" replace /> : <Outlet />}
      </main>
    </div>
  );
}
