import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';

/** Signed-in user control: real account menu in session mode, simulated user switcher in dev mode. */
export default function UserMenu() {
  const { mode, user, devUsers, switchUser, logout } = useAuth();
  if (mode === 'dev') {
    return (
      <label className="flex flex-col text-right text-xs leading-tight text-muted">
        Simulated user
        <select aria-label="Simulated user" className="max-w-[12rem] rounded border border-line bg-white px-1 py-0.5 text-sm text-ink" value={user?.id ?? ''} onChange={(e) => switchUser(e.target.value)}>
          {devUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden text-right leading-tight sm:block">
        <span className="block font-medium">{user?.name}</span>
        <span className="block text-xs text-muted">{(user?.roles ?? []).map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ')}</span>
      </span>
      <Link className="rounded border border-line bg-white px-2 py-1 hover:bg-slate-50" to="/account/password">Password</Link>
      <button className="rounded border border-line bg-white px-2 py-1 hover:bg-slate-50" onClick={() => logout()}>Sign out</button>
    </div>
  );
}
