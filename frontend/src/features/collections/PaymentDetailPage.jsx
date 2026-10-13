import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { SimulatedBadge } from './CollectionsLayout.jsx';
import { getPayment, requestPaymentReversal } from './financeService.js';

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="text-right">{children ?? '—'}</dd></div>
);

export default function PaymentDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi(useCallback((signal) => getPayment(id, signal), [id]));
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { payment: p, receipt, allocations, journal, reconciliation, reversalRequests, notice } = data;
  const canReverse = can('payment:reverse-request') && p.status === 'SUCCESSFUL' && !p.reversalPending;

  const reverse = async (reason) => {
    setBusy(true);
    setActionError(null);
    try {
      await requestPaymentReversal(id, { reason });
      setDialog(false);
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`Payment ${p.id} · Receipt ${p.receiptId}`}
        description={`${p.customerName} (${p.customerId}) · ${humanize(p.mode)} · ${formatPaise(p.amountPaise)}`}
        actions={canReverse && <Button variant="secondary" onClick={() => setDialog(true)}>Request reversal</Button>}
      />
      {notice && <div className="mb-4"><Banner tone="warning">{notice}</Banner></div>}
      {p.reversalPending && <div className="mb-4"><Banner tone="info">A reversal request is awaiting independent approval in the Approval Centre.</Banner></div>}
      {p.status === 'REVERSED' && <div className="mb-4"><Banner tone="warning">This payment was reversed on {formatDateTime(p.reversedAt)}. The original and reversing entries are both kept.</Banner></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Payment">
          <dl className="divide-y divide-line">
            <Row label="Status">{p.status === 'SUCCESSFUL' ? 'Successful' : 'Reversed'} {p.simulated && <SimulatedBadge />}</Row>
            <Row label="Amount">{formatPaise(p.amountPaise)}</Row>
            <Row label="Reference">{p.reference}</Row>
            <Row label="Received">{p.receivedDate}</Row>
            <Row label="Recorded by">{p.recordedByName} · {formatDateTime(p.createdAt)}</Row>
            <Row label="Reconciliation"><Status value={p.reconciliationStatus === 'NOT_APPLICABLE' ? 'NONE' : p.reconciliationStatus} /> {humanize(p.reconciliationStatus)}</Row>
            <Row label="Receipt">{receipt && <>{receipt.id} · {receipt.status === 'ISSUED' ? 'Issued' : 'Void'}</>}</Row>
          </dl>
        </Card>
        <Card title="Allocation to dues">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1">Instalment</th><th>Due</th><th>Allocated</th><th>State</th></tr></thead>
            <tbody className="divide-y divide-line">
              {allocations.map((a) => (
                <tr key={a.id}><td className="py-1.5">{a.groupCode} #{a.ticketNo} · {a.seq}</td><td>{a.dueDate}</td><td>{formatPaise(a.amountPaise)}</td><td>{a.status === 'ACTIVE' ? 'Active' : 'Reversed'}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Accounting entry">
          {journal ? (
            <p className="text-sm">
              <Link className="text-brand-700 underline" to={`/accounting/journals/${journal.id}`}>{journal.number}</Link> · {humanize(journal.status)} {journal.simulated && <SimulatedBadge />}
              {journal.reversedBy && <span className="block text-muted">Reversed by journal {journal.reversedBy}</span>}
            </p>
          ) : <p className="text-sm text-muted">No journal.</p>}
        </Card>
        <Card title="Reconciliation and reversal history">
          {reconciliation.length === 0 && reversalRequests.length === 0 && <p className="text-sm text-muted">Nothing recorded.</p>}
          <ul className="space-y-2 text-sm">
            {reconciliation.map((r) => <li key={r.id}>{humanize(r.result)} against {r.bankLineId}{r.differencePaise ? ` (difference ${formatPaise(r.differencePaise)})` : ''}{r.comment ? ` · “${r.comment}”` : ''}</li>)}
            {reversalRequests.map((r) => <li key={r.id}>Reversal {r.id}: <Status value={r.status} /></li>)}
          </ul>
        </Card>
      </div>
      {dialog && (
        <ConfirmDialog
          title="Request payment reversal"
          message="A different finance user must approve. On approval the receipt is voided, the allocation is undone, and a reversing journal is posted. Nothing is deleted."
          commentLabel="Reason (min. 5 characters)"
          commentRequired
          confirmLabel="Submit request"
          busy={busy}
          error={actionError}
          onCancel={() => { setDialog(false); setActionError(null); }}
          onConfirm={reverse}
        />
      )}
    </>
  );
}
