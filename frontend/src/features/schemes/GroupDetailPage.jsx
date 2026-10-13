import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { listCustomers } from '../crm/crmService.js';
import { allocateTicket, confirmChecklistItem, getGroup, groupAction, releaseTicket } from './schemeService.js';

export default function GroupDetailPage() {
  const { id } = useParams();
  const loader = useCallback((signal) => getGroup(id, signal), [id]);
  const { data: g, error, loading, reload } = useApi(loader);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !g) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const close = () => {
    setDialog(null);
    setActionError(null);
  };
  const run = async (fn, closeAfter = true) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      if (closeAfter) close();
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };
  const a = g.actions;
  const cfg = g.scheme.config;

  return (
    <>
      <PageHeader
        title={`${g.code} · ${g.name}`}
        description={`${g.scheme.name} v${g.scheme.version} · Branch ${g.branchId} · Planned start ${g.plannedStartDate}`}
        actions={
          <>
            {a.canSubmit && <Button onClick={() => setDialog({ kind: 'submit' })}>Submit for approval</Button>}
            {a.canWithdrawOpen && <Button variant="secondary" onClick={() => setDialog({ kind: 'withdraw' })}>Withdraw submission</Button>}
            {a.canMarkReady && <Button onClick={() => setDialog({ kind: 'ready' })}>Mark ready to start</Button>}
            {a.canRequestActivation && <Button onClick={() => setDialog({ kind: 'activate' })}>Request activation</Button>}
            {a.canReopen && <Button variant="secondary" onClick={() => setDialog({ kind: 'reopen' })}>Reopen enrolment</Button>}
            {a.canWithdrawActivation && <Button variant="secondary" onClick={() => setDialog({ kind: 'withdrawActivation' })}>Withdraw activation request</Button>}
            {a.canSuspend && <Button variant="secondary" onClick={() => setDialog({ kind: 'suspend' })}>Suspend</Button>}
            {a.canResume && <Button onClick={() => setDialog({ kind: 'resume' })}>Resume</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Status value={g.status} />
        <span>{g.allocatedCount} of {g.tickets.length} tickets allocated</span>
        <span className="text-muted">Chit value {formatPaise(cfg.chitValuePaise)} · Instalment {formatPaise(cfg.installmentAmountPaise)}</span>
        <Link className="text-brand-700 underline" to={`/schemes/${g.scheme.id}`}>Scheme</Link>
      </div>
      {g.status === 'APPROVAL_PENDING' && <Banner tone="info">Waiting for central approval to open enrolment. Track it in the Approval Centre.</Banner>}
      {g.activationRequestId && <Banner tone="info">Activation request {g.activationRequestId} is awaiting independent approval.</Banner>}
      {actionError && !dialog && <Banner tone="error">{actionError.message}</Banner>}

      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Tickets and members">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted">
                  <tr><th className="py-1 pr-3">Ticket</th><th className="py-1 pr-3">Member</th><th className="py-1 pr-3">Allocated</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {g.tickets.map((t) => (
                    <tr key={t.no}>
                      <td className="py-1.5 pr-3 font-medium">#{t.no}</td>
                      <td className="py-1.5 pr-3">{t.customerId ? <Link className="text-brand-700 hover:underline" to={`/crm/customers/${t.customerId}`}>{t.customerName} ({t.customerId})</Link> : <span className="text-muted">Unallocated</span>}</td>
                      <td className="py-1.5 pr-3 text-muted">{formatDateTime(t.allocatedAt)}</td>
                      <td className="py-1.5 text-right">{t.customerId && a.canAllocate && <Button variant="secondary" onClick={() => setDialog({ kind: 'release', no: t.no })}>Release</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {a.canAllocate && <AllocateForm groupId={id} onDone={reload} />}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Activation readiness">
            <ul className="space-y-3 text-sm">
              {g.readiness.items.map((i) => (
                <li key={i.key}>
                  <p className="flex items-start gap-2">
                    <span aria-label={i.met ? 'Met' : 'Not met'} className={i.met ? 'text-emerald-700' : 'text-amber-700'}>{i.met ? '✓' : '○'}</span>
                    <span>{i.label}{!i.automatic && <span className="ml-1 text-xs text-muted">(manual)</span>}</span>
                  </p>
                  <p className="pl-6 text-xs text-muted">{i.detail}</p>
                  {!i.automatic && !i.met && a.canAttest && <ConfirmItem groupId={id} itemId={i.key} onDone={reload} />}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{g.readiness.allMet ? 'All conditions are currently met.' : 'Activation is blocked until every condition is met.'}</p>
          </Card>
          <Card title="Status history">
            {g.history.length === 0 ? <p className="text-sm text-muted">No changes yet.</p> : (
              <ol className="space-y-3 text-sm">
                {[...g.history].reverse().map((h) => (
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
            {g.approvalRequests.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="space-y-2 text-sm">
                {[...g.approvalRequests].reverse().map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <span>{humanize(r.entityType)}<br /><span className="text-xs text-muted">{r.id} · {formatDateTime(r.submittedAt)}{r.comment ? ` · “${r.comment}”` : ''}</span></span>
                    <Status value={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {dialog?.kind === 'submit' && <ConfirmDialog title="Submit for approval" message="The group is locked and sent to central approval to open enrolment." confirmLabel="Submit" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => groupAction(id, 'submit'))} />}
      {dialog?.kind === 'withdraw' && <ConfirmDialog title="Withdraw submission" message="The group returns to Draft." confirmLabel="Withdraw" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => groupAction(id, 'withdraw'))} />}
      {dialog?.kind === 'ready' && <ConfirmDialog title="Mark ready to start" message="The server re-checks every readiness condition." confirmLabel="Mark ready" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => groupAction(id, 'ready'))} />}
      {dialog?.kind === 'activate' && <ConfirmDialog title="Request activation" message="Sends the group for independent approval. On approval it becomes Active and members' memberships become Active." confirmLabel="Request activation" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => groupAction(id, 'activation-request'))} />}
      {dialog?.kind === 'withdrawActivation' && <ConfirmDialog title="Withdraw activation request" confirmLabel="Withdraw" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => groupAction(id, 'activation-request/withdraw'))} />}
      {dialog?.kind === 'reopen' && <ConfirmDialog title="Reopen enrolment" message="The group returns to Enrolment Open." confirmLabel="Reopen" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => groupAction(id, 'reopen'))} />}
      {dialog?.kind === 'suspend' && <ConfirmDialog title="Suspend group" commentLabel="Reason" commentRequired confirmLabel="Suspend" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => run(() => groupAction(id, 'suspend', { reason }))} />}
      {dialog?.kind === 'resume' && <ConfirmDialog title="Resume group" commentLabel="Reason" commentRequired confirmLabel="Resume" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => run(() => groupAction(id, 'resume', { reason }))} />}
      {dialog?.kind === 'release' && <ConfirmDialog title={`Release ticket #${dialog.no}`} message="The ticket becomes available. The release is kept in the ticket history." commentLabel="Reason" commentRequired confirmLabel="Release" busy={busy} error={actionError} onCancel={close} onConfirm={(reason) => run(() => releaseTicket(id, dialog.no, { reason }))} />}
    </>
  );
}

function AllocateForm({ groupId, onDone }) {
  const loader = useCallback((signal) => listCustomers({ kycStatus: 'VERIFIED', pageSize: 100 }, signal), []);
  const { data, loading, error: loadError } = useApi(loader);
  const [customerId, setCustomerId] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const eligible = (data?.items ?? []).filter((c) => c.membershipStatus !== 'NONE');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await allocateTicket(groupId, { customerId });
      setCustomerId('');
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Allocate next free ticket</h3>
      {loadError && <Banner tone="error">{loadError.message}</Banner>}
      {err && <Banner tone="error">{err.message}</Banner>}
      <SelectField
        label="Member"
        required
        placeholder={loading ? 'Loading…' : 'Select an eligible customer'}
        hint="Only customers with verified KYC and an approved membership application are listed."
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        options={eligible.map((c) => ({ value: c.id, label: `${c.name} (${c.id})` }))}
      />
      <Button type="submit" disabled={busy || !customerId}>Allocate ticket</Button>
    </form>
  );
}

function ConfirmItem({ groupId, itemId, onDone }) {
  const [ref, setRef] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await confirmChecklistItem(groupId, itemId, { reference: ref });
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 pl-6">
      <TextField label="Reference / evidence" required value={ref} onChange={(e) => setRef(e.target.value)} error={err?.details?.reference ?? (err && !err.details ? err.message : undefined)} />
      <Button type="submit" variant="secondary" disabled={busy || !ref.trim()}>Confirm item</Button>
    </form>
  );
}
