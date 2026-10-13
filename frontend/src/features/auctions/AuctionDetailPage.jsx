import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog, Modal } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { parseRupees } from '../../utils/money.js';
import { formatTime, localToIso } from '../../utils/time.js';
import { auctionAction, getAuction, resolveDispute, submitBid } from './auctionService.js';

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="text-right">{children ?? '-'}</dd></div>
);

export default function AuctionDetailPage() {
  const { id } = useParams();
  const { data: a, error, loading, reload } = useApi(useCallback((signal) => getAuction(id, signal), [id]));
  const live = a && ['SCHEDULED', 'READY', 'OPEN'].includes(a.status);

  // The window is controlled by the server clock, so poll while the auction can still change by itself.
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [live, reload]);

  if (loading && !a) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return a.view === 'MEMBER' ? <MemberView a={a} reload={reload} /> : <StaffView a={a} reload={reload} />;
}

function Rules({ r }) {
  return (
    <Card title="Rules for this auction">
      <dl className="divide-y divide-line">
        <Row label="Winner selection">{humanize(r.winnerSelection)}</Row>
        <Row label="Tie-break">{r.tieBreak === 'EARLIEST_BID' ? 'Earliest bid (server time)' : 'Manual decision'}</Row>
        <Row label="Bids per ticket">{r.bidPolicy === 'SINGLE' ? 'One bid only' : 'Multiple (best counts)'}</Row>
        <Row label="Exclude prior winners">{r.excludePriorWinners ? 'Yes' : 'No'}</Row>
        <Row label="Require no overdue">{r.requireNoOverdue ? 'Yes' : 'No'}</Row>
        <Row label="Minimum bid">{r.minBidPaise !== undefined && formatPaise(r.minBidPaise)}</Row>
        <Row label="Maximum bid">{r.maxBidPaise !== undefined && formatPaise(r.maxBidPaise)}</Row>
        <Row label="Bid increment">{r.bidIncrementPaise !== undefined && formatPaise(r.bidIncrementPaise)}</Row>
      </dl>
    </Card>
  );
}

function Window({ a }) {
  return (
    <p className="text-sm text-muted">
      Opens {formatTime(a.scheduledOpenAt)} · Closes {formatTime(a.scheduledCloseAt)} · Server time {formatTime(a.serverTime)}
    </p>
  );
}

function MemberView({ a, reload }) {
  const [ticketNo, setTicketNo] = useState('');
  const [amount, setAmount] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [accepted, setAccepted] = useState(null);
  const [dispute, setDispute] = useState(false);
  const paise = parseRupees(amount);
  const eligible = a.myTickets.filter((t) => t.eligible);
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await submitBid(a.id, { ticketNo: Number(ticketNo), amountPaise: paise, clientRequestId: requestId });
      setAccepted(r); // acceptance is only ever shown from the server's reply
      setRequestId(crypto.randomUUID());
      setAmount('');
      setConfirm(false);
      reload();
    } catch (e) {
      setConfirm(false);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={`Auction ${a.id} · ${a.groupCode} cycle ${a.cycleNo}`} description="Member view" />
      <div className="mb-4 space-y-2"><Status value={a.status} /><Window a={a} /></div>
      {a.outcome && (
        <div className="mb-4"><Banner tone={a.outcome.youWon ? 'success' : 'info'}>
          {a.outcome.outcome === 'NO_VALID_BID' ? 'No valid bid was received this cycle.' : a.outcome.youWon ? `Your ticket ${a.outcome.winnerTicketNo} won this auction.` : `Ticket ${a.outcome.winnerTicketNo} won this auction.`}
        </Banner></div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Your tickets">
          <ul className="space-y-2 text-sm">
            {a.myTickets.map((t) => (
              <li key={t.ticketNo} className="flex items-start justify-between gap-2">
                <span>Ticket #{t.ticketNo}</span>
                {t.eligible ? <StatusBadge tone="success">Eligible</StatusBadge> : <span className="text-right text-xs text-amber-800">Not eligible: {t.reasons.join('; ')}</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Rules r={a.rules} />
        {a.actions.canBid && (
          <Card title="Place a bid">
            {accepted && <div className="mb-3"><Banner tone="success">The server accepted your bid at {formatTime(accepted.bid.serverTimestamp)} (reference {accepted.bid.id}).</Banner></div>}
            {error && !error.details && <div className="mb-3"><Banner tone="error">{error.message}</Banner></div>}
            {eligible.length === 0 ? <Banner tone="warning">None of your tickets is eligible to bid.</Banner> : (
              <form onSubmit={(e) => { e.preventDefault(); setAccepted(null); setConfirm(true); }} className="space-y-3">
                <SelectField label="Ticket" required placeholder="Select ticket" value={ticketNo} onChange={(e) => setTicketNo(e.target.value)} options={eligible.map((t) => ({ value: t.ticketNo, label: `Ticket #${t.ticketNo}` }))} />
                <TextField label="Bid amount (₹)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                  error={fe.amountPaise ?? (amount && paise === null ? 'Enter a valid amount with up to 2 decimals' : undefined)} />
                <Button type="submit" disabled={busy || !ticketNo || paise === null || paise < 1}>Review bid</Button>
              </form>
            )}
          </Card>
        )}
        <Card title="Your bids">
          {a.myBids.length === 0 ? <p className="text-sm text-muted">You have not placed a bid.</p> : (
            <ul className="space-y-2 text-sm">
              {a.myBids.map((b) => <li key={b.id}>Ticket #{b.ticketNo}: <strong>{formatPaise(b.amountPaise)}</strong><br /><span className="text-xs text-muted">Accepted by server {formatTime(b.serverTimestamp)} · {b.id}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
      {a.actions.canRaiseDispute && <div className="mt-4"><Button variant="secondary" onClick={() => setDispute(true)}>Raise a dispute</Button></div>}
      {a.myDisputes.length > 0 && <Card title="Your disputes" className="mt-4"><ul className="text-sm">{a.myDisputes.map((d) => <li key={d.id}>{d.reason} - <Status value={d.status === 'OPEN' ? 'PENDING' : 'DONE'} /> {d.resolution && <span className="text-muted">“{d.resolution}”</span>}</li>)}</ul></Card>}
      {confirm && (
        <ConfirmDialog
          title="Confirm your bid"
          message={`Bid ${formatPaise(paise)} for ticket #${ticketNo}. Bids cannot be edited or withdrawn. Your bid counts only once the server confirms it.`}
          confirmLabel="Submit bid"
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={send}
        />
      )}
      {dispute && <DisputeDialog auctionId={a.id} onClose={() => setDispute(false)} onDone={() => { setDispute(false); reload(); }} />}
    </>
  );
}

function DisputeDialog({ auctionId, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <ConfirmDialog
      title="Raise a dispute"
      message="Describe what you believe is wrong. An open dispute pauses approval of the result until it is resolved."
      commentLabel="Reason (min. 5 characters)"
      commentRequired
      confirmLabel="Raise dispute"
      busy={busy}
      error={err}
      onCancel={onClose}
      onConfirm={async (reason) => {
        setBusy(true);
        setErr(null);
        try {
          await auctionAction(auctionId, 'disputes', { reason });
          onDone();
        } catch (e) {
          setErr(e);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

function StaffView({ a, reload }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const act = a.actions;
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
  const doAction = (name, body) => run(() => auctionAction(a.id, name, body));
  const openDisputes = a.disputes.filter((d) => d.status === 'OPEN');

  return (
    <>
      <PageHeader
        title={`Auction ${a.id} · ${a.groupCode} cycle ${a.cycleNo}`}
        description="Auction console"
        actions={
          <>
            {act.canMarkReady && <Button onClick={() => setDialog({ kind: 'ready' })}>Mark ready</Button>}
            {act.canReschedule && <Button variant="secondary" onClick={() => setDialog({ kind: 'reschedule' })}>Reschedule</Button>}
            {act.canCloseEarly && <Button variant="secondary" onClick={() => setDialog({ kind: 'close' })}>Close early</Button>}
            {act.canCompute && <Button onClick={() => setDialog({ kind: 'compute' })}>{a.result ? 'Recompute result' : 'Compute result'}</Button>}
            {act.canValidate && <Button onClick={() => setDialog({ kind: 'validate' })}>Validate result</Button>}
            {act.canSubmit && <Button onClick={() => setDialog({ kind: 'submit' })}>Submit for approval</Button>}
            {act.canWithdraw && <Button variant="secondary" onClick={() => setDialog({ kind: 'withdraw' })}>Withdraw submission</Button>}
            {act.canCreatePayout && <Button onClick={() => navigate(`/payouts/new?auctionId=${a.id}`)}>Create payout</Button>}
            {act.canCancel && <Button variant="secondary" onClick={() => setDialog({ kind: 'cancel' })}>Cancel auction</Button>}
          </>
        }
      />
      <div className="mb-4 space-y-2"><div className="flex items-center gap-3"><Status value={a.status} />{a.cancelReason && <span className="text-sm text-muted">Reason: {a.cancelReason}</span>}{a.payoutId && <Link className="text-sm text-brand-700 underline" to={`/payouts/${a.payoutId}`}>Payout {a.payoutId}</Link>}</div><Window a={a} /></div>
      {openDisputes.length > 0 && <div className="mb-4"><Banner tone="warning">{openDisputes.length} open dispute(s). Validation, submission and approval are blocked until resolved.</Banner></div>}
      {actionError && !dialog && <div className="mb-4"><Banner tone="error">{actionError.message}</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {['SCHEDULED', 'READY'].includes(a.status) && (
            <Card title="Preparation checklist">
              <ul className="space-y-2 text-sm">
                {a.readiness.items.map((i) => <li key={i.key}><span className={i.met ? 'text-emerald-700' : 'text-amber-700'}>{i.met ? '✓' : '○'}</span> {i.label} <span className="text-xs text-muted">({i.detail})</span></li>)}
              </ul>
              {a.status === 'SCHEDULED' && <p className="mt-3 text-xs text-muted">The auction opens automatically at the scheduled time only if it has been marked ready.</p>}
            </Card>
          )}
          <Card title={`Bid history (${a.bidCount})`}>
            <DataTable
              rows={a.bids}
              emptyTitle="No bids"
              columns={[
                { key: 'sequence', header: '#' },
                { key: 'ticketNo', header: 'Ticket', render: (r) => `#${r.ticketNo}` },
                { key: 'customerName', header: 'Member' },
                { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
                { key: 'serverTimestamp', header: 'Server time', render: (r) => formatTime(r.serverTimestamp) },
              ]}
            />
            <p className="mt-2 text-xs text-muted">Bids are append-only. They cannot be edited or removed.</p>
          </Card>
          {a.result && (
            <Card title="Result">
              <dl className="divide-y divide-line">
                <Row label="Outcome">{humanize(a.result.outcome)}</Row>
                <Row label="Winning ticket">{a.result.winnerTicketNo ? `#${a.result.winnerTicketNo}` : a.result.needsManualDecision ? 'Pending manual tie decision' : '-'}</Row>
                <Row label="Winning bid">{a.result.winningAmountPaise !== undefined && formatPaise(a.result.winningAmountPaise)}</Row>
                {a.result.tiedTicketNos.length > 1 && <Row label="Tied tickets">{a.result.tiedTicketNos.map((n) => `#${n}`).join(', ')}</Row>}
                {a.result.tieBreakApplied && <Row label="Tie-break applied">{humanize(a.result.tieBreakApplied)}{a.result.manualReason ? ` - “${a.result.manualReason}”` : ''}</Row>}
                <Row label="Validated">{a.result.validatedAt ? `${a.result.validatedByName} · ${formatTime(a.result.validatedAt)}` : 'Not yet'}</Row>
              </dl>
              <p className="mt-3 text-xs text-muted">The prize, dividends and commission are not calculated by the system. Finance enters the payout amount manually, with approval.</p>
              {act.canDecideTie && (
                <div className="mt-3"><Button onClick={() => setDialog({ kind: 'tie' })}>Record manual tie decision</Button></div>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Rules r={a.rules} />
          <Card title="Eligible tickets">
            <ul className="space-y-1.5 text-sm">
              {a.eligibility.map((e) => (
                <li key={e.ticketNo} className="flex justify-between gap-2"><span>#{e.ticketNo} {e.customerName}</span>{e.eligible ? <StatusBadge tone="success">Eligible</StatusBadge> : <span className="text-xs text-amber-800">{e.reasons.join('; ')}</span>}</li>
              ))}
            </ul>
          </Card>
          <Card title="Disputes" action={act.canRaiseDispute && <Button variant="secondary" onClick={() => setDialog({ kind: 'dispute' })}>Raise</Button>}>
            {a.disputes.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="space-y-3 text-sm">
                {a.disputes.map((d) => (
                  <li key={d.id}>
                    <p>{d.reason}</p>
                    <p className="text-xs text-muted">{d.raisedByName} · {formatTime(d.raisedAt)} · <Status value={d.status === 'OPEN' ? 'PENDING' : d.status === 'UPHELD' ? 'REJECTED' : 'DONE'} /> {d.resolution && `“${d.resolution}”`}</p>
                    {d.status === 'OPEN' && act.canResolveDispute && <div className="mt-1 flex gap-2"><Button variant="secondary" onClick={() => setDialog({ kind: 'resolve', d, resolution: 'DISMISSED' })}>Dismiss</Button><Button variant="secondary" onClick={() => setDialog({ kind: 'resolve', d, resolution: 'UPHELD' })}>Uphold</Button></div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="History">
            <ol className="space-y-3 text-sm">
              {[...a.history].reverse().map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3">
                  <p>{humanize(h.from)} → <strong>{humanize(h.to)}</strong></p>
                  {h.comment && <p className="text-muted">“{h.comment}”</p>}
                  <p className="text-xs text-muted">{h.actorName} · {formatTime(h.at)}</p>
                </li>
              ))}
              {a.history.length === 0 && <li className="text-muted">No changes yet.</li>}
            </ol>
          </Card>
          {a.approvalRequests.length > 0 && <Card title="Approval requests"><ul className="space-y-2 text-sm">{[...a.approvalRequests].reverse().map((r) => <li key={r.id} className="flex items-center justify-between"><span>{r.id}</span><Status value={r.status} /></li>)}</ul><p className="mt-2 text-xs text-muted">Decide in the <Link className="underline" to="/approvals">Approval Centre</Link>.</p></Card>}
        </div>
      </div>

      {dialog?.kind === 'ready' && <ConfirmDialog title="Mark ready" message="The server re-checks the preparation conditions. The auction then opens by itself at the scheduled time." confirmLabel="Mark ready" busy={busy} error={actionError} onCancel={close} onConfirm={() => doAction('ready')} />}
      {dialog?.kind === 'compute' && <ConfirmDialog title="Compute result" message="Selects the winner from the recorded bids using this auction's rules. No money amounts are calculated." confirmLabel="Compute" busy={busy} error={actionError} onCancel={close} onConfirm={() => doAction('compute')} />}
      {dialog?.kind === 'validate' && <ConfirmDialog title="Validate result" message="Confirm you have checked the bid history and result. The server verifies the bid log is intact and no dispute is open." confirmLabel="Validate" busy={busy} error={actionError} onCancel={close} onConfirm={() => doAction('validate')} />}
      {dialog?.kind === 'submit' && <ConfirmDialog title="Submit for approval" message="The result is locked and sent for central approval." confirmLabel="Submit" busy={busy} error={actionError} onCancel={close} onConfirm={() => doAction('submit')} />}
      {dialog?.kind === 'withdraw' && <ConfirmDialog title="Withdraw submission" confirmLabel="Withdraw" busy={busy} error={actionError} onCancel={close} onConfirm={() => doAction('withdraw')} />}
      {dialog?.kind === 'close' && <ConfirmDialog title="Close bidding early" message="No further bids will be accepted." commentLabel="Reason" commentRequired confirmLabel="Close bidding" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => doAction('close', { reason })} />}
      {dialog?.kind === 'cancel' && <ConfirmDialog title="Cancel auction" message="Cancelling is permanent; a new auction must be scheduled." commentLabel="Reason" commentRequired confirmLabel="Cancel auction" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => doAction('cancel', { reason })} />}
      {dialog?.kind === 'dispute' && <DisputeDialog auctionId={a.id} onClose={close} onDone={() => { close(); reload(); }} />}
      {dialog?.kind === 'resolve' && <ConfirmDialog title={`${humanize(dialog.resolution)} dispute`} message={dialog.resolution === 'UPHELD' ? 'Upholding a dispute cancels this auction and any pending approval.' : 'The auction can continue.'} commentLabel="Resolution" commentRequired confirmLabel={humanize(dialog.resolution)} busy={busy} error={actionError} onCancel={close} onConfirm={(comment) => run(() => resolveDispute(a.id, dialog.d.id, { resolution: dialog.resolution, comment }))} />}
      {dialog?.kind === 'reschedule' && <RescheduleDialog a={a} onClose={close} onDone={() => { close(); reload(); }} />}
      {dialog?.kind === 'tie' && <TieDialog a={a} onClose={close} onDone={() => { close(); reload(); }} />}
    </>
  );
}

function RescheduleDialog({ a, onClose, onDone }) {
  const [open, setOpen] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await auctionAction(a.id, 'reschedule', { scheduledOpenAt: localToIso(open), scheduledCloseAt: localToIso(closeAt) });
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const d = err?.details ?? {};
  return (
    <Modal title="Reschedule auction" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">The auction returns to Scheduled and must be marked ready again.</p>
        {err && !err.details && <Banner tone="error">{err.message}</Banner>}
        <TextField label="Opens at" type="datetime-local" required value={open} onChange={(e) => setOpen(e.target.value)} error={d.scheduledOpenAt} />
        <TextField label="Closes at" type="datetime-local" required value={closeAt} onChange={(e) => setCloseAt(e.target.value)} error={d.scheduledCloseAt} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !open || !closeAt}>Reschedule</Button></div>
      </form>
    </Modal>
  );
}

function TieDialog({ a, onClose, onDone }) {
  const [ticketNo, setTicketNo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await auctionAction(a.id, 'tie-decision', { ticketNo: Number(ticketNo), reason });
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Manual tie decision" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">Choose the winning ticket among the tied tickets, as the scheme terms direct. The reason is kept in the record.</p>
        {err && <Banner tone="error">{err.details?.ticketNo ?? err.message}</Banner>}
        <SelectField label="Winning ticket" required placeholder="Select" value={ticketNo} onChange={(e) => setTicketNo(e.target.value)} options={a.result.tiedTicketNos.map((n) => ({ value: n, label: `Ticket #${n}` }))} />
        <TextField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !ticketNo || reason.trim().length < 5}>Record decision</Button></div>
      </form>
    </Modal>
  );
}
