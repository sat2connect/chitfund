import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { TextAreaField } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { Thread } from '../portal/PortalSupport.jsx';
import { assignCase, getCase, listCases, setCaseStatus, staffReply } from '../portal/portalService.js';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const CATEGORIES = ['PAYMENT', 'AUCTION', 'PAYOUT', 'KYC', 'ACCOUNT', 'COMPLAINT', 'OTHER'];
const tone = (s) => (s === 'RESOLVED' ? 'DONE' : s === 'CLOSED' ? 'CANCELLED' : s === 'IN_PROGRESS' ? 'PENDING' : 'NEW');

export function SupportCasesPage() {
  const { params, set, setPage } = useListParams({ status: 'OPEN' });
  const { data, error, loading, reload } = useApi(useCallback((signal) => listCases(params, signal), [params]));
  return (
    <>
      <PageHeader title="Customer support" description="Member requests and complaints for your branches, oldest activity first." />
      <div className="mb-3"><Banner tone="info">Notification templates and delivery logs are not built yet: no email, SMS or WhatsApp provider has been selected.</Banner></div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search case, subject, customer" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Type" value={params.category} onChange={(category) => set({ category })} options={CATEGORIES.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Assigned" value={params.assignedTo} onChange={(assignedTo) => set({ assignedTo })} options={[{ value: 'me', label: 'To me' }]} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No cases in this view"
        columns={[
          { key: 'id', header: 'Case', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/support/${r.id}`}>{r.id}</Link> },
          { key: 'customerName', header: 'Customer' },
          { key: 'subject', header: 'Subject' },
          { key: 'category', header: 'Type', render: (r) => humanize(r.category) },
          { key: 'assignedToName', header: 'Assigned', render: (r) => r.assignedToName ?? 'Unassigned' },
          { key: 'status', header: 'Status', render: (r) => <Status value={tone(r.status)} label={humanize(r.status)} /> },
          { key: 'updatedAt', header: 'Updated', render: (r) => formatDateTime(r.updatedAt) },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}

export function SupportCasePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: c, error, loading, reload } = useApi(useCallback((signal) => getCase(id, signal), [id]));
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (loading && !c) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const manage = can('support:manage') && c.status !== 'CLOSED';
  const run = async (fn, after) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      after?.();
      reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={c.subject}
        description={`${c.id} · ${humanize(c.category)} · ${c.customerName} (${c.customerId}) · Branch ${c.branchId}`}
        actions={manage && (
          <>
            <Button variant="secondary" onClick={() => run(() => assignCase(id))} disabled={busy}>Assign to me</Button>
            {c.status !== 'RESOLVED' && <Button onClick={() => setDialog({ to: 'RESOLVED' })}>Mark resolved</Button>}
            <Button variant="secondary" onClick={() => setDialog({ to: 'CLOSED' })}>Close</Button>
          </>
        )}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><Status value={tone(c.status)} label={humanize(c.status)} /> · Assigned: {c.assignedToName ?? 'nobody'} · <Link className="text-brand-700 underline" to={`/crm/customers/${c.customerId}`}>Customer profile</Link></div>
      {err && !dialog && <div className="mb-3"><Banner tone="error">{err.message}</Banner></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Thread messages={c.messages} staff />
          {manage && (
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => staffReply(id, { body: text, internal }), () => setText('')); }}>
              <TextAreaField label={internal ? 'Internal note (member cannot see this)' : 'Reply to member'} value={text} onChange={(e) => setText(e.target.value)} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note only</label>
              <Button type="submit" disabled={busy || !text.trim()}>{internal ? 'Add note' : 'Send reply'}</Button>
            </form>
          )}
        </div>
        <Card title="History">
          <ol className="space-y-2 text-sm">
            {[...c.history].reverse().map((h, i) => <li key={i} className="border-l-2 border-line pl-3">{humanize(h.from)} → <strong>{humanize(h.to)}</strong>{h.comment && <span className="text-muted"> “{h.comment}”</span>}<br /><span className="text-xs text-muted">{h.actorName} · {formatDateTime(h.at)}</span></li>)}
            {c.history.length === 0 && <li className="text-muted">No status changes yet.</li>}
          </ol>
        </Card>
      </div>
      {dialog && (
        <ConfirmDialog
          title={dialog.to === 'RESOLVED' ? 'Mark resolved' : 'Close case'}
          message={dialog.to === 'RESOLVED' ? 'The member can reopen it by replying. A reply to the member is required first.' : 'Closed cases cannot be reopened; the member would need a new request.'}
          commentLabel="Comment (min. 5 characters)"
          commentRequired
          confirmLabel={dialog.to === 'RESOLVED' ? 'Mark resolved' : 'Close case'}
          busy={busy}
          error={err}
          onCancel={() => { setDialog(null); setErr(null); }}
          onConfirm={(comment) => run(() => setCaseStatus(id, { status: dialog.to, comment }), () => setDialog(null))}
        />
      )}
    </>
  );
}
