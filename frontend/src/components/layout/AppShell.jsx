import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { modules } from '../../app/routes.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { ErrorState, LoadingState } from '../feedback/States.jsx';
import UserMenu from './UserMenu.jsx';

function Icon({ d }) {
  return (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Sidebar({ collapsed, open, onClose }) {
  const { can, user } = useAuth();
  // Members (simulated customer sessions) only see the modules meant for them, never the staff dashboard.
  const visible = modules.filter((m) => (user?.customerId ? m.key === 'auctions' : !m.requires || m.requires.some(can)));
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <aside
        aria-label="Primary"
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-brand-900 text-slate-100 transition-all lg:static ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'lg:w-16' : 'lg:w-64'} w-64`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4 font-semibold">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-white/15">CF</span>
          {!collapsed && <span>Chit Fund CRM</span>}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {visible.map((m) => (
            <NavLink
              key={m.key}
              to={m.path}
              end={m.path === '/'}
              onClick={onClose}
              title={m.label}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                  isActive ? 'bg-white/15 font-medium text-white' : 'text-slate-300 hover:bg-white/10'
                }`
              }
            >
              <Icon d={m.icon} />
              {!collapsed && <span className="truncate">{m.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const current = modules.find((m) => (m.path === '/' ? pathname === '/' : pathname.startsWith(m.path)));
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <Link to="/" className="hover:underline">Home</Link>
      {current && current.path !== '/' && (
        <>
          <span className="mx-1.5">/</span>
          <span className="text-ink">{current.label}</span>
        </>
      )}
    </nav>
  );
}

function Topbar({ onToggleSidebar, onOpenMobile }) {
  const { user } = useAuth();
  return (
    <header className="flex h-14 items-center gap-3 border-b border-line bg-white px-4">
      <button aria-label="Open menu" className="rounded p-1.5 hover:bg-slate-100 lg:hidden" onClick={onOpenMobile}>
        <Icon d="M4 6h16M4 12h16M4 18h16" />
      </button>
      <button aria-label="Collapse sidebar" className="hidden rounded p-1.5 hover:bg-slate-100 lg:block" onClick={onToggleSidebar}>
        <Icon d="M4 6h16M4 12h16M4 18h16" />
      </button>
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-3 text-sm">
        <span className="hidden rounded bg-slate-100 px-2 py-1 text-muted sm:inline">
          Branches: {user ? (user.branchIds === 'ALL' ? 'All' : user.branchIds.join(', ')) : '—'}
        </span>
        <UserMenu />
      </div>
    </header>
  );
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading, error, mode } = useAuth();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onToggleSidebar={() => setCollapsed((c) => !c)} onOpenMobile={() => setMobileOpen(true)} />
        {mode === 'dev' && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
            Simulated sign-in (development mode). Anyone can pick any user; this must never be used with real data.
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {error && !user ? <ErrorState error={error} /> : loading && !user ? <LoadingState label="Signing in…" /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}

