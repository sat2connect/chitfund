import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, PageHeader } from '../../components/common/ui.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { decideApproval, listApprovals, startApprovalReview } from '../schemes/schemeService.js';

const SCOPES = [
  { value: 'queue', label: 'Awaiting my action' },
  { value: 'mine', label: 'My submissions' },
  { value: 'returned', label: 'Returned / rejected' },
  { value: 'history', label: 'Decision history' },
  { value: 'all', label: 'All requests' },
];
const TYPES = ['SCHEME_VERSION', 'GROUP_OPEN', 'GROUP_ACTIVATION', 'JOURNAL', 'JOURNAL_REVERSAL', 'PAYMENT_REVERSAL', 'AUCTION_RESULT', 'PAYOUT'];

export default function ApprovalsPage() {
  const { params, set, setPage } = useListParams({ scope: 'queue' });
  const loader = useCallback((signal) => listApprovals(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

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
      <PageHeader title="Approval Centre" description="Maker-checker requests. You can never decide your own submission." />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            onClick={() => set({ scope: s.value })}
            className={`border-b-2 px-3 py-2 text-sm ${params.scope === s.value ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search request or item" />
        <FilterSelect label="Type" value={params.type} onChange={(type) => set({ type })} options={TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="Nothing here"
        emptyDescription="No requests match this view."
        columns={[
          { key: 'id', header: 'Request' },
          { key: 'entityType', header: 'Type', render: (r) => humanize(r.entityType) },
          { key: 'entityLabel', header: 'Item', render: (r) => <Link className="text-brand-700 hover:underline" to={r.subjectPath}>{r.entityLabel}</Link> },
          { key: 'makerName', header: 'Submitted by', render: (r) => `${r.makerName} · ${formatDateTime(r.submittedAt)}` },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
          {
            key: 'actions',
            header: 'Actions',
            render: (r) => {
              if (r.actions.canStartReview) return <Button onClick={() => setDialog({ kind: 'review', r })}>Start review</Button>;
              if (r.actions.canDecide) {
                return (
                  <span className="flex gap-2">
                    <Button onClick={() => setDialog({ kind: 'decide', r, decision: 'APPROVED' })}>Approve</Button>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'decide', r, decision: 'RETURNED' })}>Return</Button>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'decide', r, decision: 'REJECTED' })}>Reject</Button>
                  </span>
                );
              }
              if (r.actions.isOwnSubmission && ['PENDING', 'IN_REVIEW'].includes(r.status)) return <span className="text-xs text-muted">Your submission</span>;
              return r.comment ? <span className="text-xs text-muted">“{r.comment}” — {r.checkerName}</span> : null;
            },
          },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {dialog?.kind === 'review' && (
        <ConfirmDialog title={`Start review of ${dialog.r.id}`} message={`${dialog.r.entityLabel}. Reviewing moves the item to Under Review.`} confirmLabel="Start review" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => startApprovalReview(dialog.r.id))} />
      )}
      {dialog?.kind === 'decide' && (
        <ConfirmDialog
          title={`${humanize(dialog.decision)}: ${dialog.r.id}`}
          message={`${dialog.r.entityLabel}. Your decision is recorded with your identity and time.`}
          commentLabel="Comment"
          commentRequired={dialog.decision !== 'APPROVED'}
          confirmLabel={humanize(dialog.decision)}
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={(comment) => run(() => decideApproval(dialog.r.id, { decision: dialog.decision, comment }))}
        />
      )}
    </>
  );
}
