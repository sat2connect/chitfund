import { useCallback, useState } from 'react';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog, Modal } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { useApi } from '../../hooks/useApi.js';
import { apiRequest } from '../../services/apiClient.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { getMeta, listCustomers } from '../crm/crmService.js';

const STAFF_ROLES = ['SUPER_ADMIN', 'OPS_HEAD', 'BRANCH_MANAGER', 'CRM_EXEC', 'KYC_OFFICER', 'CHIT_OPS', 'AUDITOR', 'COLLECTION_OFFICER', 'FINANCE_MAKER', 'FINANCE_CHECKER', 'AUCTION_OFFICER'];

const listUsers = (signal) => apiRequest('/users', { signal });
const post = (path, body) => apiRequest(path, { method: 'POST', body });

/** The one-time code is shown once, in the browser only; the server keeps just a hash. */
function CodeDialog({ result, onClose }) {
  return (
    <Modal title="One-time activation code" onClose={onClose}>
      <div className="space-y-3">
        <Banner tone="warning">Give this code to the user now. It is shown only once, works once, and expires {formatDateTime(result.activation.expiresAt)}.</Banner>
        <p className="rounded border border-line bg-slate-50 p-3 text-center font-mono text-xl tracking-wider select-all" data-testid="activation-code">{result.activation.code}</p>
        {result.user && <p className="text-sm text-muted">Sign-in name: <strong>{result.user.username}</strong>. They activate at the sign-in page (“Activate your account”).</p>}
        <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}

function StaffForm({ branches, onCreated }) {
  const [f, setF] = useState({ name: '', username: '', roles: [], all: false, branchIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};
  const toggle = (key, v) => setF((p) => ({ ...p, [key]: p[key].includes(v) ? p[key].filter((x) => x !== v) : [...p[key], v] }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post('/users', { name: f.name, username: f.username, roles: f.roles, branchIds: f.all ? 'ALL' : f.branchIds });
      setF({ name: '', username: '', roles: [], all: false, branchIds: [] });
      onCreated(r);
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add a staff account">
      <form onSubmit={submit} className="space-y-4">
        {error && !error.details && <Banner tone="error">{error.message}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.name} />
          <TextField label="Work email (sign-in name)" type="email" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} error={fe.username} />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Roles <span className="text-red-600">*</span></legend>
          <div className="grid gap-1 sm:grid-cols-3">
            {STAFF_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.roles.includes(r)} onChange={() => toggle('roles', r)} />{humanize(r)}</label>
            ))}
          </div>
          {fe.roles && <p className="mt-1 text-xs text-red-700" role="alert">{fe.roles}</p>}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Branches <span className="text-red-600">*</span></legend>
          <label className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} />All branches (central role)</label>
          {!f.all && (
            <div className="flex flex-wrap gap-3">
              {branches.map((b) => <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.branchIds.includes(b.id)} onChange={() => toggle('branchIds', b.id)} />{b.name}</label>)}
            </div>
          )}
          {fe.branchIds && <p className="mt-1 text-xs text-red-700" role="alert">{fe.branchIds}</p>}
        </fieldset>
        <Button type="submit" disabled={busy || !f.name || !f.username || f.roles.length === 0 || (!f.all && f.branchIds.length === 0)}>{busy ? 'Creating…' : 'Create account'}</Button>
      </form>
    </Card>
  );
}

function MemberForm({ onCreated }) {
  const customers = useApi(useCallback((signal) => listCustomers({ kycStatus: 'VERIFIED', pageSize: 100 }, signal), []));
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post('/users/member-accounts', { customerId });
      setCustomerId('');
      onCreated(r);
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Give a customer portal access">
      <form onSubmit={submit} className="max-w-md space-y-3">
        <p className="text-sm text-muted">Only customers with verified KYC. They sign in with their mobile number and a password they set using a one-time code.</p>
        {error && <Banner tone="error">{error.message}</Banner>}
        <SelectField label="Customer" required placeholder="Select customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} options={(customers.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))} />
        <Button type="submit" disabled={busy || !customerId}>Create portal account</Button>
      </form>
    </Card>
  );
}

export default function UsersPage() {
  const { can, user: me } = useAuth();
  const users = useApi(listUsers);
  const meta = useApi(getMeta);
  const [code, setCode] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const manage = can('user:manage');
  const close = () => { setDialog(null); setActionError(null); };

  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await fn();
      close();
      users.reload();
      return r;
    } catch (e) {
      setActionError(e);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const created = (r) => { setCode(r); users.reload(); };

  return (
    <>
      <PageHeader title="Users and access" description="Accounts, roles and branch access. Everything here is audited." />
      <div className="mb-4"><Banner tone="info">Staff must use an authenticator app at every sign-in. One person cannot hold both sides of a maker-checker pair (for example finance maker and finance checker).</Banner></div>
      <DataTable
        loading={users.loading}
        error={users.error}
        onRetry={users.reload}
        rows={users.data?.items}
        emptyTitle="No users"
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span>{r.name}{r.id === me?.id && <span className="ml-1 text-xs text-muted">(you)</span>}</span> },
          { key: 'username', header: 'Sign-in name', render: (r) => r.username ?? '-' },
          { key: 'roles', header: 'Roles', render: (r) => r.roles.map(humanize).join(', ') },
          { key: 'branchIds', header: 'Branches', render: (r) => (r.branchIds === 'ALL' ? 'All' : r.branchIds.join(', ') || '-') },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'ACTIVE' ? 'ACTIVE' : 'CANCELLED'} label={r.status === 'ACTIVE' ? (r.activated ? 'Active' : 'Awaiting activation') : 'Disabled'} /> },
          { key: 'mfaEnabled', header: 'MFA', render: (r) => (r.roles.includes('CHIT_MEMBER') ? 'n/a' : r.mfaEnabled ? 'Enrolled' : 'Not yet') },
          { key: 'lastLoginAt', header: 'Last sign-in', render: (r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : 'Never') },
          {
            key: 'a', header: '',
            render: (r) => (manage && r.id !== me?.id ? (
              <span className="flex flex-wrap gap-1">
                <Button variant="secondary" onClick={() => setDialog({ kind: 'activation', r })}>{r.activated ? 'Reset password' : 'New code'}</Button>
                {!r.roles.includes('CHIT_MEMBER') && r.mfaEnabled && <Button variant="secondary" onClick={() => setDialog({ kind: 'mfa', r })}>Reset MFA</Button>}
                <Button variant="secondary" onClick={() => setDialog({ kind: r.status === 'ACTIVE' ? 'disable' : 'enable', r })}>{r.status === 'ACTIVE' ? 'Disable' : 'Enable'}</Button>
              </span>
            ) : null),
          },
        ]}
      />
      {manage && meta.data && <div className="mt-5"><StaffForm branches={meta.data.branches} onCreated={created} /></div>}
      {manage && <div className="mt-5"><MemberForm onCreated={created} /></div>}

      {code && <CodeDialog result={code} onClose={() => setCode(null)} />}
      {dialog?.kind === 'activation' && <ConfirmDialog title={`New one-time code for ${dialog.r.name}`} message="Issuing a code lets the user set a new password and signs them out of all devices once they use it." confirmLabel="Issue code" busy={busy} error={actionError} onCancel={close} onConfirm={async () => { const r = await run(() => post(`/users/${dialog.r.id}/activation-code`)); if (r) setCode({ ...r, user: { username: dialog.r.username } }); }} />}
      {dialog?.kind === 'mfa' && <ConfirmDialog title={`Reset MFA for ${dialog.r.name}`} message="They are signed out and must enrol their authenticator again at next sign-in. Do this only after confirming their identity." confirmLabel="Reset MFA" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => post(`/users/${dialog.r.id}/reset-mfa`))} />}
      {dialog?.kind === 'disable' && <ConfirmDialog title={`Disable ${dialog.r.name}`} message="Their sessions end immediately and they cannot sign in until enabled again." confirmLabel="Disable" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => post(`/users/${dialog.r.id}/disable`))} />}
      {dialog?.kind === 'enable' && <ConfirmDialog title={`Enable ${dialog.r.name}`} confirmLabel="Enable" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => post(`/users/${dialog.r.id}/enable`))} />}
    </>
  );
}
