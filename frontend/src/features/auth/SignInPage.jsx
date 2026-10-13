import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Button, Card } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { TextField } from '../../components/forms/controls.jsx';

export function AuthFrame({ title, children }) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded bg-brand-900 text-sm text-white">CF</span>
          Chit Fund CRM
        </div>
        <Card title={title}>{children}</Card>
      </div>
    </div>
  );
}

/** Password step, then the second factor. Staff must enrol an authenticator app on first sign-in. */
export default function SignInPage() {
  const { login, verifyMfa, enrollMfa, completeSignIn } = useAuth();
  const [step, setStep] = useState({ name: 'password' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fail = (e) => setError(e);
  const reset = () => {
    setStep({ name: 'password' });
    setPassword('');
    setCode('');
    setError(null);
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(username, password);
      if (r.status === 'AUTHENTICATED') completeSignIn(r);
      else if (r.status === 'MFA_REQUIRED') setStep({ name: 'mfa', challengeToken: r.challengeToken });
      else if (r.status === 'MFA_ENROLLMENT_REQUIRED') setStep({ name: 'enroll', challengeToken: r.challengeToken, secret: r.secret, uri: r.otpauthUri });
    } catch (x) {
      fail(x);
    } finally {
      setPassword(''); // never keep a typed password around, whether or not it worked
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step.name === 'mfa') {
        await verifyMfa(step.challengeToken, code);
      } else {
        const s = await enrollMfa(step.challengeToken, code);
        setStep({ name: 'recovery', session: s });
      }
      setCode('');
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };

  if (step.name === 'recovery') {
    return (
      <AuthFrame title="Save your recovery codes">
        <div className="space-y-4">
          <Banner tone="warning">{step.session.recoveryNotice}</Banner>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm" aria-label="Recovery codes">
            {step.session.recoveryCodes.map((c) => <li key={c} className="rounded border border-line bg-white px-2 py-1">{c}</li>)}
          </ul>
          <Button className="w-full" onClick={() => completeSignIn(step.session)}>I have saved these codes</Button>
        </div>
      </AuthFrame>
    );
  }

  if (step.name === 'enroll') {
    return (
      <AuthFrame title="Set up your authenticator app">
        <form onSubmit={submitCode} className="space-y-4">
          <p className="text-sm text-muted">Staff accounts need a second step at every sign-in. In an authenticator app, add an account using this key, then enter the 6-digit code it shows.</p>
          <div className="rounded border border-line bg-slate-50 p-3 text-center">
            <p className="text-xs text-muted">Setup key</p>
            <p className="select-all break-all font-mono text-base" data-testid="mfa-secret">{step.secret}</p>
          </div>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Use a link instead</summary>
            <p className="mt-1 select-all break-all font-mono">{step.uri}</p>
          </details>
          {error && <Banner tone="error">{error.message}</Banner>}
          <TextField label="6-digit code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <div className="flex justify-between gap-2">
            <Button type="button" variant="secondary" onClick={reset}>Cancel</Button>
            <Button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm and sign in'}</Button>
          </div>
        </form>
      </AuthFrame>
    );
  }

  if (step.name === 'mfa') {
    return (
      <AuthFrame title="Enter your verification code">
        <form onSubmit={submitCode} className="space-y-4">
          <p className="text-sm text-muted">Open your authenticator app and enter the current 6-digit code. Lost your device? Enter one of your recovery codes instead.</p>
          {error && <Banner tone="error">{error.message}</Banner>}
          <TextField label="Code" required autoComplete="one-time-code" maxLength={14} value={code} onChange={(e) => setCode(e.target.value.trim())} />
          <div className="flex justify-between gap-2">
            <Button type="button" variant="secondary" onClick={reset}>Back</Button>
            <Button type="submit" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Verify'}</Button>
          </div>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Sign in">
      <form onSubmit={submitPassword} className="space-y-4">
        {error && <Banner tone="error">{error.code === 'RATE_LIMITED' || error.code === 'ACCOUNT_LOCKED' ? error.message : 'Invalid username or password.'}</Banner>}
        <TextField label="Email or mobile number" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <TextField label="Password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" className="w-full" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        <p className="text-center text-xs text-muted">First time? <Link className="underline" to="/activate">Activate your account</Link> with the one-time code from your administrator.</p>
      </form>
    </AuthFrame>
  );
}
