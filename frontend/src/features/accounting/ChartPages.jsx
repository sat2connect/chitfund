import { useState } from 'react';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { closePeriod, createAccount, getPostingRules, listAccounts, listPeriods, reopenPeriod, setAccountActive } from '../collections/financeService.js';

export function AccountsPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi(listAccounts);
  const rules = useApi(getPostingRules);
  return (
    <>
      <PageHeader title="Chart of accounts" description="Accounts available for journals and automatic postings." />
      {data?.placeholder && <div className="mb-4"><Banner tone="warning"><strong>Placeholder chart.</strong> The seeded accounts and posting mappings have not been approved by the client's accountant and must be replaced or confirmed before real use.</Banner></div>}
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        columns={[
          { key: 'code', header: 'Code' },
          { key: 'name', header: 'Name' },
          { key: 'type', header: 'Type', render: (r) => humanize(r.type) },
          { key: 'parentCode', header: 'Parent', render: (r) => r.parentCode ?? '—' },
          { key: 'active', header: 'Status', render: (r) => <Status value={r.active ? 'ACTIVE' : 'CANCELLED'} /> },
          { key: 'placeholder', header: 'Approved', render: (r) => (r.placeholder ? 'No (placeholder)' : 'Added by finance') },
          { key: 'a', header: '', render: (r) => (can('account:manage') ? <ToggleButton a={r} onDone={reload} /> : null) },
        ]}
      />
      {can('account:manage') && <div className="mt-5"><AccountForm accounts={data?.items ?? []} onDone={reload} /></div>}
      {rules.data && (
        <Card title="Automatic posting rules (placeholder)" className="mt-5">
          <p className="mb-2 text-sm text-muted">{rules.data.notice}</p>
          <ul className="text-sm">
            {Object.entries(rules.data.debitByMode).map(([mode, acc]) => <li key={mode}>Collection by {humanize(mode)}: debit {acc}, credit {rules.data.credit}</li>)}
          </ul>
        </Card>
      )}
    </>
  );
}

function ToggleButton({ a, onDone }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="secondary" disabled={busy} onClick={async () => { setBusy(true); try { await setAccountActive(a.id, !a.active); onDone(); } finally { setBusy(false); } }}>
      {a.active ? 'Deactivate' : 'Activate'}
    </Button>
  );
}

function AccountForm({ accounts, onDone }) {
  const [f, setF] = useState({ code: '', name: '', type: '', parentCode: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const fe = err?.details ?? {};
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await createAccount({ ...f, parentCode: f.parentCode || undefined });
      setF({ code: '', name: '', type: '', parentCode: '' });
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <Card title="Add account">
      <form onSubmit={submit} className="grid items-start gap-3 sm:grid-cols-5">
        {err && !err.details && <div className="sm:col-span-5"><Banner tone="error">{err.message}</Banner></div>}
        <TextField label="Code" required value={f.code} onChange={set('code')} error={fe.code} />
        <TextField label="Name" required value={f.name} onChange={set('name')} error={fe.name} />
        <SelectField label="Type" required placeholder="Select type" value={f.type} onChange={set('type')} error={fe.type} options={['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].map((t) => ({ value: t, label: humanize(t) }))} />
        <SelectField label="Parent account" placeholder="None" value={f.parentCode} onChange={set('parentCode')} error={fe.parentCode} options={accounts.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }))} />
        <div className="self-end"><Button type="submit" disabled={busy || !f.code || !f.name || !f.type}>Add account</Button></div>
      </form>
    </Card>
  );
}

export function PeriodsPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi(listPeriods);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const close = () => { setDialog(null); setActionError(null); };
  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      close();
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Accounting periods" description="Closed periods reject new entries. Closing needs every journal in the period to be posted." />
      <div className="mb-4"><Banner tone="info">The fiscal calendar shown is a placeholder (April–March, monthly) pending the accountant's confirmation.</Banner></div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        columns={[
          { key: 'name', header: 'Period' },
          { key: 'startDate', header: 'From' },
          { key: 'endDate', header: 'To' },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'OPEN' ? 'ACTIVE' : 'CANCELLED'} /> },
          { key: 'history', header: 'Last change', render: (r) => { const h = r.history[r.history.length - 1]; return h ? `${humanize(h.action)} · ${formatDateTime(h.at)}${h.reason ? ` · “${h.reason}”` : ''}` : '—'; } },
          {
            key: 'a', header: '',
            render: (r) => (can('period:manage')
              ? (r.status === 'OPEN'
                ? <Button variant="secondary" onClick={() => setDialog({ kind: 'close', r })}>Close</Button>
                : <Button variant="secondary" onClick={() => setDialog({ kind: 'reopen', r })}>Reopen</Button>)
              : null),
          },
        ]}
      />
      {dialog?.kind === 'close' && <ConfirmDialog title={`Close ${dialog.r.name}`} message="No new entries can be posted into this period until it is reopened." confirmLabel="Close period" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => closePeriod(dialog.r.id))} />}
      {dialog?.kind === 'reopen' && <ConfirmDialog title={`Reopen ${dialog.r.name}`} commentLabel="Reason" commentRequired confirmLabel="Reopen" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => run(() => reopenPeriod(dialog.r.id, { reason }))} />}
    </>
  );
}
