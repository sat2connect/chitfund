import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { TextField } from '../../components/forms/controls.jsx';
import { apiRequest } from '../../services/apiClient.js';
import { AuthFrame } from './SignInPage.jsx';

const MIN = 12;
const lengthProblem = (pw) => (pw && pw.length < MIN ? `Use at least ${MIN} characters` : undefined);
const mismatch = (pw, confirm) => Boolean(confirm) && pw !== confirm;

/** First-time activation (or reset) with the one-time code an administrator issued. */
export function ActivatePage() {
  const [f, setF] = useState({ username: '', code: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const tooShort = lengthProblem(f.newPassword);
  const blocked = Boolean(tooShort) || mismatch(f.newPassword, f.confirm);
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/auth/activate', { method: 'POST', body: { username: f.username, code: f.code, newPassword: f.newPassword }, quiet401: true });
      setDone(true);
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthFrame title="Account activated">
        <p className="mb-4 text-sm">Your password is set. You can sign in now{' '}and, if you are staff, set up your authenticator app.</p>
        <Link to="/"><Button className="w-full">Go to sign in</Button></Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Activate your account">
      <form onSubmit={submit} className="space-y-4">
        {error && !error.details && <Banner tone="error">{error.message}</Banner>}
        <TextField label="Email or mobile number" required autoComplete="username" value={f.username} onChange={set('username')} />
        <TextField label="One-time activation code" required hint="Like K7M2P-9XQ4T-HB3RV. Valid for 72 hours and works once." value={f.code} onChange={set('code')} />
        <TextField label="New password" type="password" required autoComplete="new-password" hint={`At least ${MIN} characters. A passphrase works well.`} value={f.newPassword} onChange={set('newPassword')} error={fe.newPassword ?? tooShort} />
        <TextField label="Confirm new password" type="password" required autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={mismatch(f.newPassword, f.confirm) ? 'The two passwords do not match' : undefined} />
        <Button type="submit" className="w-full" disabled={busy || !f.username || !f.code || !f.newPassword || blocked}>{busy ? 'Activating…' : 'Activate account'}</Button>
        <p className="text-center text-xs text-muted"><Link className="underline" to="/">Back to sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

/** Signed-in password change. Other devices are signed out. */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const tooShort = lengthProblem(f.newPassword);
  const blocked = Boolean(tooShort) || mismatch(f.newPassword, f.confirm);
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/auth/change-password', { method: 'POST', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      setDone(true);
      setF({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Change password" description="Other devices are signed out when you change your password." />
      <Card className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          {done && <Banner tone="success">Password changed. This device stays signed in; others were signed out.</Banner>}
          {error && !error.details && <Banner tone="error">{error.message}</Banner>}
          <TextField label="Current password" type="password" required autoComplete="current-password" value={f.currentPassword} onChange={set('currentPassword')} />
          <TextField label="New password" type="password" required autoComplete="new-password" hint={`At least ${MIN} characters.`} value={f.newPassword} onChange={set('newPassword')} error={fe.newPassword ?? tooShort} />
          <TextField label="Confirm new password" type="password" required autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={mismatch(f.newPassword, f.confirm) ? 'The two passwords do not match' : undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Back</Button>
            <Button type="submit" disabled={busy || !f.currentPassword || !f.newPassword || blocked}>{busy ? 'Saving…' : 'Change password'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
