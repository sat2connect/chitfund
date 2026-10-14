import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import {
  createSchemeVersion, getScheme, publishSchemeVersion, retireSchemeVersion, submitSchemeVersion, withdrawSchemeVersion,
} from './schemeService.js';

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm">
    <dt className="text-muted">{label}</dt>
    <dd className="text-right">{children || '—'}</dd>
  </div>
);

export function ConfigView({ c }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Terms">
        <dl className="divide-y divide-line">
          <Row label="Scheme type">{c.schemeType}</Row>
          <Row label="Jurisdiction">{humanize(c.jurisdiction)}</Row>
          <Row label="Permitted branches">{c.permittedBranchIds?.length ? c.permittedBranchIds.join(', ') : 'No restriction'}</Row>
          <Row label="Chit value">{formatPaise(c.chitValuePaise)}</Row>
          <Row label="Members / tickets">{c.memberCount}</Row>
          <Row label="Instalment">{formatPaise(c.installmentAmountPaise)} · {humanize(c.frequency)}</Row>
          <Row label="Tenure">{c.tenureMonths} months</Row>
          <Row label="Effective">{c.effectiveFrom} to {c.effectiveTo ?? 'open'}</Row>
          <Row label="Max tickets per member">{c.maxTicketsPerMember}</Row>
          <Row label="Min. tickets to activate">{c.minEnrolmentToActivate}</Row>
        </dl>
      </Card>
      <Card title="Auction">
        <dl className="divide-y divide-line">
          <Row label="Mode">{humanize(c.auction.mode)}</Row>
          <Row label="Minimum bid">{c.auction.minBidPaise !== undefined && formatPaise(c.auction.minBidPaise)}</Row>
          <Row label="Maximum bid">{c.auction.maxBidPaise !== undefined && formatPaise(c.auction.maxBidPaise)}</Row>
          <Row label="Bid increment">{c.auction.bidIncrementPaise !== undefined && formatPaise(c.auction.bidIncrementPaise)}</Row>
          <Row label="Tie-break">{c.auction.tieBreakRule}</Row>
        </dl>
      </Card>
      <Card title="Rules (text as approved; not yet calculated by the system)">
        <p className="text-sm font-medium">Dividend / discount</p>
        <p className="mb-3 whitespace-pre-wrap text-sm text-muted">{c.dividendRuleText || 'Not recorded'}</p>
        <p className="text-sm font-medium">Commission</p>
        <p className="mb-3 whitespace-pre-wrap text-sm text-muted">{c.commissionRuleText || 'Not recorded'}</p>
        <p className="text-sm font-medium">Discount policy</p>
        <p className="mb-3 whitespace-pre-wrap text-sm text-muted">{c.discountPolicyText || 'Not recorded'}</p>
        <p className="text-sm font-medium">Rounding policy</p>
        <p className="whitespace-pre-wrap text-sm text-muted">{c.roundingPolicyText || 'Not recorded'}</p>
      </Card>
      <Card title="Overdue and grace-period rules">
        {c.overdueRules?.policyConfirmationRef
          ? <p className="mb-2 text-sm text-emerald-700">Confirmation reference recorded: {c.overdueRules.policyConfirmationRef}</p>
          : <p className="mb-2 text-sm font-medium text-amber-700">UNAPPROVED: no business / compliance confirmation recorded.</p>}
        <dl className="divide-y divide-line">
          <Row label="Grace period">{c.overdueRules?.graceDays === undefined ? 'System placeholder' : `${c.overdueRules.graceDays} day(s)`}</Row>
          <Row label="Part-payment stops overdue">{c.overdueRules?.partialPaymentStopsOverdue ? 'Yes' : 'No'}</Row>
          <Row label="Cut-off (recorded, not applied)">{c.overdueRules?.cutoffTime && `${c.overdueRules.cutoffTime} ${c.overdueRules.timezone ?? ''}`}</Row>
          <Row label="Non-working dates">{c.overdueRules?.holidayPolicy === 'NEXT_UNLISTED_DAY' ? `${c.overdueRules.nonWorkingDates.length} listed; due date moves on` : 'Do not move due dates'}</Row>
          <Row label="Reminders (days)">{(c.overdueRules?.reminderDaysBefore?.length || c.overdueRules?.reminderDaysAfter?.length) ? `before ${c.overdueRules.reminderDaysBefore.join(', ') || '-'}; after ${c.overdueRules.reminderDaysAfter.join(', ') || '-'}` : ''}</Row>
        </dl>
        {c.overdueRules?.lateFeeText && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">Late fee (not charged): {c.overdueRules.lateFeeText}</p>}
        {c.overdueRules?.escalationText && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">Escalation: {c.overdueRules.escalationText}</p>}
        {c.overdueRules?.disputedPaymentText && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">Disputed / reversed payments: {c.overdueRules.disputedPaymentText}</p>}
      </Card>
      <Card title="Eligibility and compliance">
        {c.description && <p className="mb-3 whitespace-pre-wrap text-sm">{c.description}</p>}
        <p className="mb-3 whitespace-pre-wrap text-sm text-muted">{c.eligibilityRequirements || 'No eligibility requirements recorded'}</p>
        <p className="text-sm font-medium">Required documents</p>
        <ul className="mb-3 list-disc pl-5 text-sm text-muted">{c.requiredDocuments.length ? c.requiredDocuments.map((d) => <li key={d}>{d}</li>) : <li>None</li>}</ul>
        <p className="text-sm font-medium">Group activation prerequisites</p>
        <ul className="list-disc pl-5 text-sm text-muted">{c.complianceChecklist.length ? c.complianceChecklist.map((d) => <li key={d}>{d}</li>) : <li>None</li>}</ul>
      </Card>
    </div>
  );
}

export default function SchemeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const loader = useCallback((signal) => getScheme(id, signal), [id]);
  const { data, error, loading, reload } = useApi(loader);
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const versions = data.versions;
  const v = versions.find((x) => x.id === selected) ?? versions[versions.length - 1];
  const close = () => {
    setDialog(null);
    setActionError(null);
  };
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
      <PageHeader
        title={`${data.scheme.code} · ${v.config.name}`}
        description={`Version ${v.version} of ${versions.length}`}
        actions={
          <>
            {v.actions.canEdit && <Button variant="secondary" onClick={() => navigate(`/schemes/${id}/versions/${v.id}/edit`)}>Edit draft</Button>}
            {v.actions.canSubmit && <Button onClick={() => setDialog({ kind: 'submit' })}>Submit for approval</Button>}
            {v.actions.canWithdraw && <Button variant="secondary" onClick={() => setDialog({ kind: 'withdraw' })}>Withdraw submission</Button>}
            {v.actions.canPublish && <Button onClick={() => setDialog({ kind: 'publish' })}>Publish</Button>}
            {v.actions.canRetire && <Button variant="secondary" onClick={() => setDialog({ kind: 'retire' })}>Retire</Button>}
            {data.canCreateVersion && <Button variant="secondary" onClick={() => run(() => createSchemeVersion(id))}>New version</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {versions.map((x) => (
          <button
            key={x.id}
            onClick={() => setSelected(x.id)}
            className={`rounded-md border px-3 py-1 text-sm ${x.id === v.id ? 'border-brand-600 bg-brand-50 font-medium' : 'border-line bg-white'}`}
          >
            v{x.version} <Status value={x.status} />
          </button>
        ))}
      </div>
      {actionError && !dialog && <Banner tone="error">{actionError.message}</Banner>}
      {v.status === 'DRAFT' ? <Banner tone="info">Draft: editable until submitted. Reviewers see exactly the revision you submit.</Banner>
        : <Banner tone="info">This version is read-only. Changing approved terms requires a new version and approval.</Banner>}
      {data.warnings.length > 0 && v.id === versions[versions.length - 1].id && (
        <div className="mt-3"><Banner tone="warning"><p className="font-medium">Please confirm against the approved terms:</p><ul className="list-disc pl-5">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Banner></div>
      )}
      <div className="mt-4"><ConfigView c={v.config} /></div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Version history">
          {v.history.length === 0 ? <p className="text-sm text-muted">No status changes yet. Created by {v.createdByName}.</p> : (
            <ol className="space-y-3 text-sm">
              {[...v.history].reverse().map((h) => (
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
          {v.approvalRequests.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <ul className="space-y-2 text-sm">
              {[...v.approvalRequests].reverse().map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span>{r.id} · revision {r.submittedRevision}<br /><span className="text-xs text-muted">{formatDateTime(r.submittedAt)}{r.comment ? ` · “${r.comment}”` : ''}</span></span>
                  <Status value={r.status} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Decisions are made in the <Link className="underline" to="/approvals">Approval Centre</Link>.</p>
        </Card>
      </div>

      {dialog?.kind === 'submit' && <ConfirmDialog title="Submit for approval" message={`Version ${v.version} (revision ${v.revision}) will be locked and sent to central review.`} confirmLabel="Submit" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => submitSchemeVersion(v.id))} />}
      {dialog?.kind === 'withdraw' && <ConfirmDialog title="Withdraw submission" message="The version returns to Draft and the open request is cancelled." confirmLabel="Withdraw" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => withdrawSchemeVersion(v.id))} />}
      {dialog?.kind === 'publish' && <ConfirmDialog title="Publish version" message="Published versions can be used to create new chit groups. This cannot be undone, only retired." confirmLabel="Publish" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => publishSchemeVersion(v.id))} />}
      {dialog?.kind === 'retire' && <ConfirmDialog title="Retire version" message="New groups can no longer be created from this version. Existing groups are unaffected." commentLabel="Reason" commentRequired confirmLabel="Retire" busy={busy} error={actionError} onCancel={close} onConfirm={(comment) => run(() => retireSchemeVersion(v.id, { comment }))} />}
    </>
  );
}
