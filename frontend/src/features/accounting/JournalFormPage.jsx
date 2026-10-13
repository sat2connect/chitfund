import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { TextField, useUnsavedWarning } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise, paiseToRupees } from '../../utils/format.js';
import { parseRupees } from '../../utils/money.js';
import { createJournal, getJournal, listAccounts, listPeriods, updateJournal } from '../collections/financeService.js';

const blank = () => ({ accountId: '', debit: '', credit: '', memo: '' });

export default function JournalFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { can } = useAuth();
  const navigate = useNavigate();
  const accounts = useApi(listAccounts);
  const periods = useApi(listPeriods);
  const existing = useApi(useCallback((signal) => (editing ? getJournal(id, signal) : Promise.resolve(null)), [editing, id]));
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useUnsavedWarning(dirty);

  const state = useMemo(() => {
    if (form) return form;
    if (existing.data) {
      const j = existing.data;
      return { date: j.date, memo: j.memo, lines: j.lines.map((l) => ({ accountId: l.accountId, debit: l.debitPaise ? paiseToRupees(l.debitPaise) : '', credit: l.creditPaise ? paiseToRupees(l.creditPaise) : '', memo: l.memo ?? '' })) };
    }
    return { date: '', memo: '', lines: [blank(), blank()] };
  }, [form, existing.data]);

  if (!can('journal:create')) return <Banner tone="error">You do not have permission to create journals.</Banner>;
  if (accounts.loading || periods.loading || existing.loading) return <LoadingState />;
  if (accounts.error || existing.error) return <ErrorState error={accounts.error ?? existing.error} />;
  if (editing && existing.data && !existing.data.actions.canEdit) return <Banner tone="warning">This journal is read-only. Posted entries are corrected by reversal.</Banner>;

  const update = (patch) => { setDirty(true); setForm({ ...state, ...patch }); };
  const setLine = (i, k, v) => update({ lines: state.lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)) });
  const debit = state.lines.reduce((a, l) => a + (parseRupees(l.debit) ?? 0), 0);
  const credit = state.lines.reduce((a, l) => a + (parseRupees(l.credit) ?? 0), 0);
  const balanced = debit === credit && debit > 0;
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        date: state.date, memo: state.memo,
        lines: state.lines.filter((l) => l.accountId || l.debit || l.credit).map((l) => ({
          accountId: l.accountId, debitPaise: parseRupees(l.debit) ?? 0, creditPaise: parseRupees(l.credit) ?? 0, memo: l.memo || undefined,
        })),
      };
      const j = editing ? await updateJournal(id, body) : await createJournal(body);
      setDirty(false);
      navigate(`/accounting/journals/${j.id}`, { replace: true });
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={editing ? `Edit draft ${existing.data.number}` : 'New manual journal'} description="Saved as a draft first. Submitting sends it for independent approval; it posts only after approval." />
      <form onSubmit={submit} className="space-y-5">
        {error && <Banner tone="error">{error.message}{fe.lines ? `: ${fe.lines}` : ''}</Banner>}
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Journal date" type="date" required value={state.date} onChange={(e) => update({ date: e.target.value })} error={fe.date} />
            <TextField label="Memo" required value={state.memo} onChange={(e) => update({ memo: e.target.value })} error={fe.memo} />
          </div>
        </Card>
        <Card title="Lines">
          <div className="space-y-3">
            {state.lines.map((l, i) => (
              <div key={i} className="grid items-start gap-2 sm:grid-cols-12">
                <select aria-label={`Account line ${i + 1}`} className="rounded-md border border-line bg-white px-2 py-2 text-sm sm:col-span-5" value={l.accountId} onChange={(e) => setLine(i, 'accountId', e.target.value)}>
                  <option value="">Select account</option>
                  {accounts.data.items.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </select>
                <input aria-label={`Debit line ${i + 1}`} placeholder="Debit ₹" inputMode="decimal" className="rounded-md border border-line px-2 py-2 text-sm sm:col-span-2" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} />
                <input aria-label={`Credit line ${i + 1}`} placeholder="Credit ₹" inputMode="decimal" className="rounded-md border border-line px-2 py-2 text-sm sm:col-span-2" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} />
                <input aria-label={`Memo line ${i + 1}`} placeholder="Line memo" className="rounded-md border border-line px-2 py-2 text-sm sm:col-span-2" value={l.memo} onChange={(e) => setLine(i, 'memo', e.target.value)} />
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={state.lines.length <= 2} className="rounded border border-line px-2 py-2 text-sm disabled:opacity-40 sm:col-span-1" onClick={() => update({ lines: state.lines.filter((_, idx) => idx !== i) })}>×</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button type="button" variant="secondary" onClick={() => update({ lines: [...state.lines, blank()] })}>Add line</Button>
            <p>
              Debits {formatPaise(debit)} · Credits {formatPaise(credit)} ·{' '}
              <strong className={balanced ? 'text-emerald-700' : 'text-amber-700'}>{balanced ? 'Balanced' : `Out of balance by ${formatPaise(Math.abs(debit - credit))}`}</strong>
            </p>
          </div>
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/accounting')}>Cancel</Button>
          <Button type="submit" disabled={busy || !balanced}>{busy ? 'Saving…' : 'Save draft'}</Button>
        </div>
      </form>
    </>
  );
}
