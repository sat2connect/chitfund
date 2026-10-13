import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog, Modal } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { formatTime } from '../../utils/time.js';
import { getPayout, getPayoutMeta, payoutAction } from '../auctions/auctionService.js';

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="text-right">{children ?? '-'}</dd></div>
);

export default function PayoutDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: p, error, loading, reload } = useApi(useCallback((signal) => getPayout(id, signal), [id]));
  const meta = useApi(getPayoutMeta);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !p) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const a = p.actions;
  const close = () => { setDialog(null); setActionError(null); };
  const run = async (name, body) => {
    setBusy(true);
    setActionError(null);
    try {
      await payoutAction(id, name, body);
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
      <PageHeader
        title={`Payout ${p.id} · ${p.customerName}`}
        description={`${p.groupCode} ticket #${p.ticketNo} · Auction ${p.auctionId}`}
        actions={
          <>
            {a.canEdit && <Button variant="secondary" onClick={() => navigate(`/payouts/${p.id}/edit`)}>Edit draft</Button>}
            {a.canSubmitForReview && <Button onClick={() => setDialog({ kind: 'review' })}>Submit for eligibility review</Button>}
            {a.canRequestApproval && <Button onClick={() => setDialog({ kind: 'approval' })}>Request approval</Button>}
            {a.canSendBack && <Button variant="secondary" onClick={() => setDialog({ kind: 'sendBack' })}>Send back to draft</Button>}
            {a.canWithdraw && <Button variant="secondary" onClick={() => setDialog({ kind: 'withdraw' })}>Withdraw request</Button>}
            {a.canInitiate && <Button onClick={() => setDialog({ kind: 'initiate' })}>{p.status === 'FAILED' ? 'Retry disbursement' : 'Initiate disbursement'}</Button>}
            {a.canRecordDisbursement && <Button onClick={() => setDialog({ kind: 'paid' })}>Record payment made</Button>}
            {a.canRecordDisbursement && <Button variant="secondary" onClick={() => setDialog({ kind: 'failed' })}>Record failure</Button>}
            {a.canHold && <Button variant="secondary" onClick={() => setDialog({ kind: 'hold' })}>Put on hold</Button>}
            {a.canRelease && <Button onClick={() => setDialog({ kind: 'release' })}>Release hold</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Status value={p.status === 'PAID' ? 'DONE' : p.status} /> <span>{humanize(p.status)}</span>
        {p.status === 'PAID' && <span className="text-muted">Reconciliation: {humanize(p.reconciliationStatus)}</span>}
        <Link className="text-brand-700 underline" to={`/auctions/${p.auctionId}`}>Auction</Link>
        <Link className="text-brand-700 underline" to={`/crm/customers/${p.customerId}`}>Customer</Link>
      </div>
      <div className="mb-4 space-y-2"><Banner tone="info">{p.amountNotice}</Banner>{p.status === 'PAID' && <Banner tone="warning">{p.notificationNotice}</Banner>}</div>
      {p.holdReason && p.status === 'ON_HOLD' && <div className="mb-4"><Banner tone="warning">On hold: {p.holdReason}</Banner></div>}
      {p.failureReason && p.status === 'FAILED' && <div className="mb-4"><Banner tone="error">Last disbursement failed: {p.failureReason}</Banner></div>}
      {actionError && !dialog && <div className="mb-4"><Banner tone="error">{actionError.message}</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Payout">
          <dl className="divide-y divide-line">
            <Row label="Amount (manual)">{formatPaise(p.amountPaise)}</Row>
            <Row label="Basis">{p.amountBasis}</Row>
            <Row label="Entered by">{p.createdByName}</Row>
            <Row label="Channel">{p.channel && humanize(p.channel)}</Row>
            <Row label="Disbursement reference">{p.disbursement?.reference}</Row>
            <Row label="Paid date">{p.disbursement?.paidDate}</Row>
            <Row label="Journal">{p.journalId && <Link className="text-brand-700 underline" to={`/accounting/journals/${p.journalId}`}>View entry</Link>}</Row>
          </dl>
        </Card>
        <Card title="Eligibility review">
          <ul className="space-y-3 text-sm">
            {p.eligibility.items.map((i) => (
              <li key={i.key}>
                <p><span className={i.met ? 'text-emerald-700' : 'text-amber-700'}>{i.met ? '✓' : '○'}</span> {i.label}{!i.automatic && <span className="ml-1 text-xs text-muted">(manual)</span>}</p>
                <p className="pl-5 text-xs text-muted">{i.detail}</p>
                {!i.automatic && !i.met && a.canConfirmDocuments && <button className="pl-5 text-xs text-brand-700 underline" onClick={() => setDialog({ kind: 'doc', item: i })}>Confirm with reference</button>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">For information only (not a block): {p.eligibility.info.overdueInstalments} overdue instalment(s) totalling {formatPaise(p.eligibility.info.overduePaise)}.</p>
        </Card>
        <Card title="Status history">
          {p.history.length === 0 ? <p className="text-sm text-muted">No changes yet.</p> : (
            <ol className="space-y-3 text-sm">
              {[...p.history].reverse().map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3">
                  <p>{humanize(h.from)} → <strong>{humanize(h.to)}</strong></p>
                  {h.comment && <p className="text-muted">“{h.comment}”</p>}
                  <p className="text-xs text-muted">{h.actorName} · {formatTime(h.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Approval requests">
          {p.approvalRequests.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <ul className="space-y-2 text-sm">{[...p.approvalRequests].reverse().map((r) => <li key={r.id} className="flex items-center justify-between"><span>{r.id}{r.comment ? ` · “${r.comment}”` : ''}</span><Status value={r.status} /></li>)}</ul>
          )}
          <p className="mt-2 text-xs text-muted">Decisions are made in the <Link className="underline" to="/approvals">Approval Centre</Link> by someone other than the person who entered the amount.</p>
        </Card>
      </div>

      {dialog?.kind === 'review' && <ConfirmDialog title="Submit for eligibility review" confirmLabel="Submit" busy={busy} error={actionError} onCancel={close} onConfirm={() => run('submit-review')} />}
      {dialog?.kind === 'approval' && <ConfirmDialog title="Request approval" message="The server re-checks every eligibility condition." confirmLabel="Request approval" busy={busy} error={actionError} onCancel={close} onConfirm={() => run('request-approval')} />}
      {dialog?.kind === 'withdraw' && <ConfirmDialog title="Withdraw request" confirmLabel="Withdraw" busy={busy} error={actionError} onCancel={close} onConfirm={() => run('withdraw')} />}
      {dialog?.kind === 'sendBack' && <ConfirmDialog title="Send back to draft" commentLabel="Reason" commentRequired confirmLabel="Send back" busy={busy} error={actionError} onCancel={close} onConfirm={(comment) => run('send-back', { comment })} />}
      {dialog?.kind === 'failed' && <ConfirmDialog title="Record disbursement failure" commentLabel="Reason" commentRequired confirmLabel="Record failure" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => run('failure', { reason })} />}
      {dialog?.kind === 'hold' && <ConfirmDialog title="Put payout on hold" message="Any open approval request is cancelled." commentLabel="Reason" commentRequired confirmLabel="Put on hold" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => run('hold', { reason })} />}
      {dialog?.kind === 'release' && <ConfirmDialog title="Release hold" commentLabel="Comment" commentRequired confirmLabel="Release" busy={busy} error={actionError} onCancel={close} onConfirm={(comment) => run('release', { comment })} />}
      {dialog?.kind === 'initiate' && meta.data && <FieldDialog title="Initiate disbursement" message="Choose the channel Finance will use. Nothing is paid by this system." field={{ label: 'Channel', options: meta.data.channels.map((c) => ({ value: c, label: humanize(c) })) }} onClose={close} busy={busy} error={actionError} onSubmit={(v) => run('initiate', { channel: v })} />}
      {dialog?.kind === 'doc' && <FieldDialog title={dialog.item.label} message="Record the reference of the document you have verified." field={{ label: 'Reference', text: true }} onClose={close} busy={busy} error={actionError} onSubmit={(v) => run(`documents/${dialog.item.key}/confirm`, { reference: v })} />}
      {dialog?.kind === 'paid' && <PaidDialog p={p} onClose={close} busy={busy} error={actionError} onSubmit={(b) => run('disbursement', b)} />}
    </>
  );
}

function FieldDialog({ title, message, field, onClose, onSubmit, busy, error }) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-3">
        {message && <p className="text-sm text-muted">{message}</p>}
        {field.options
          ? <SelectField label={field.label} required placeholder="Select" value={v} onChange={(e) => setV(e.target.value)} options={field.options} />
          : <TextField label={field.label} required value={v} onChange={(e) => setV(e.target.value)} />}
        {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !v.trim()}>Confirm</Button></div>
      </form>
    </Modal>
  );
}

function PaidDialog({ p, onClose, onSubmit, busy, error }) {
  const [reference, setReference] = useState('');
  const [paidDate, setPaidDate] = useState('');
  const d = error?.details && !Array.isArray(error.details) ? error.details : {};
  return (
    <Modal title="Record payment made" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit({ reference, paidDate }); }} className="space-y-3">
        <p className="text-sm text-muted">Record that Finance has paid {formatPaise(p.amountPaise)} outside this system via {humanize(p.channel)}. This posts the accounting entry and cannot be undone here.</p>
        <TextField label="Bank / cheque reference" required value={reference} onChange={(e) => setReference(e.target.value)} error={d.reference} />
        <TextField label="Date paid" type="date" required value={paidDate} onChange={(e) => setPaidDate(e.target.value)} error={d.paidDate} />
        {error && !error.details && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || reference.trim().length < 3 || !paidDate}>Record payment</Button></div>
      </form>
    </Modal>
  );
}
