import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { getJournal, journalAction } from '../collections/financeService.js';
import { SimBadge } from './JournalsPage.jsx';

export default function JournalDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: j, error, loading, reload } = useApi(useCallback((signal) => getJournal(id, signal), [id]));
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !j) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
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
  const totalDebit = j.lines.reduce((a, l) => a + l.debitPaise, 0);
  const totalCredit = j.lines.reduce((a, l) => a + l.creditPaise, 0);
  const a = j.actions;
  const sourceLink = j.source.type === 'PAYMENT' ? `/collections/payments/${j.source.id}` : j.source.type === 'PAYMENT_REVERSAL' ? `/collections/payments/${j.source.id}` : null;

  return (
    <>
      <PageHeader
        title={`${j.number} · ${j.memo}`}
        description={`Dated ${j.date} · Source: ${humanize(j.source.type)} · Created by ${j.createdByName}`}
        actions={
          <>
            {a.canEdit && <Button variant="secondary" onClick={() => navigate(`/accounting/journals/${j.id}/edit`)}>Edit draft</Button>}
            {a.canSubmit && <Button onClick={() => setDialog({ kind: 'submit' })}>Submit for approval</Button>}
            {a.canWithdraw && <Button variant="secondary" onClick={() => setDialog({ kind: 'withdraw' })}>Withdraw</Button>}
            {a.canRequestReversal && <Button variant="secondary" onClick={() => setDialog({ kind: 'reverse' })}>Request reversal</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Status value={j.status === 'POSTED' ? 'DONE' : j.status === 'REVERSED' ? 'CANCELLED' : j.status} /> <span>{humanize(j.status)}</span>
        {j.simulated && <SimBadge />}
        {sourceLink && <Link className="text-brand-700 underline" to={sourceLink}>Source payment</Link>}
        {j.reversedBy && <Link className="text-brand-700 underline" to={`/accounting/journals/${j.reversedBy}`}>Reversed by {j.reversedBy}</Link>}
        {j.reversalOf && <Link className="text-brand-700 underline" to={`/accounting/journals/${j.reversalOf}`}>Reversal of {j.reversalOf}</Link>}
      </div>
      {j.simulated && <div className="mb-4"><Banner tone="warning">Simulated entry from the test gateway. No real money moved.</Banner></div>}
      {['POSTED', 'REVERSED'].includes(j.status) && <div className="mb-4"><Banner tone="info">Posted entries cannot be edited or deleted. Corrections are made by an approved reversal.</Banner></div>}
      {actionError && !dialog && <Banner tone="error">{actionError.message}</Banner>}

      <Card title="Lines">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Memo</th></tr></thead>
          <tbody className="divide-y divide-line">
            {j.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5">{l.accountCode} · {l.accountName}</td>
                <td className="text-right tabular-nums">{l.debitPaise ? formatPaise(l.debitPaise) : ''}</td>
                <td className="text-right tabular-nums">{l.creditPaise ? formatPaise(l.creditPaise) : ''}</td>
                <td className="text-muted">{l.memo}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line font-medium"><td className="py-1.5">Total</td><td className="text-right tabular-nums">{formatPaise(totalDebit)}</td><td className="text-right tabular-nums">{formatPaise(totalCredit)}</td><td /></tr></tfoot>
        </table>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Status history">
          {j.history.length === 0 ? <p className="text-sm text-muted">No status changes yet.</p> : (
            <ol className="space-y-3 text-sm">
              {[...j.history].reverse().map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3">
                  <p>{humanize(h.from)} → <strong>{humanize(h.to)}</strong></p>
                  {h.comment && <p className="text-muted">“{h.comment}”</p>}
                  <p className="text-xs text-muted">{h.actorName} · {formatDateTime(h.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Approval requests">
          {j.approvalRequests.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="space-y-2 text-sm">
              {[...j.approvalRequests].reverse().map((r) => (
                <li key={r.id} className="flex items-center justify-between"><span>{humanize(r.entityType)} · {r.id}<br /><span className="text-xs text-muted">{formatDateTime(r.submittedAt)}{r.comment ? ` · “${r.comment}”` : ''}</span></span><Status value={r.status} /></li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Decisions are made in the <Link className="underline" to="/approvals">Approval Centre</Link>.</p>
        </Card>
      </div>

      {dialog?.kind === 'submit' && <ConfirmDialog title="Submit for approval" message="The journal is locked and sent for independent approval. It posts to the ledger only after approval." confirmLabel="Submit" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => journalAction(j.id, 'submit'))} />}
      {dialog?.kind === 'withdraw' && <ConfirmDialog title="Withdraw submission" confirmLabel="Withdraw" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => journalAction(j.id, 'withdraw'))} />}
      {dialog?.kind === 'reverse' && <ConfirmDialog title="Request reversal" message="A different finance user must approve. A new journal with debits and credits swapped is posted; this entry is kept and marked reversed." commentLabel="Reason" commentRequired confirmLabel="Request reversal" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => run(() => journalAction(j.id, 'reversal-request', { reason }))} />}
    </>
  );
}
