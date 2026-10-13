import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, PageHeader } from '../../components/common/ui.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDateTime } from '../../utils/labels.js';
import { decideApplication, listApplications } from './kycService.js';

export default function ApplicationsPage() {
  const { can, user } = useAuth();
  const { params, set, setPage } = useListParams({ status: 'SUBMITTED' });
  const loader = useCallback((signal) => listApplications(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const close = () => {
    setDialog(null);
    setActionError(null);
  };
  const decide = async (comment) => {
    setBusy(true);
    setActionError(null);
    try {
      await decideApplication(dialog.app.id, { decision: dialog.decision, comment });
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
      <PageHeader title="Membership applications" description="Applications from KYC-verified customers awaiting central approval." />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search customer or ID" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={[{ value: 'SUBMITTED', label: 'Awaiting decision' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No applications in this view"
        columns={[
          { key: 'id', header: 'Application' },
          { key: 'customerName', header: 'Customer', render: (r) => <Link className="text-brand-700 hover:underline" to={`/crm/customers/${r.customerId}`}>{r.customerName}</Link> },
          { key: 'preferredScheme', header: 'Preferred scheme' },
          { key: 'submittedBy', header: 'Submitted by', render: (r) => `${r.submittedByName} · ${formatDateTime(r.submittedAt)}` },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
          {
            key: 'actions',
            header: 'Actions',
            render: (r) => {
              if (r.status !== 'SUBMITTED') return r.comment ? <span className="text-xs text-muted">“{r.comment}”</span> : null;
              if (!can('application:approve')) return null;
              if (r.submittedBy === user.id) return <span className="text-xs text-muted">Your submission</span>;
              return (
                <span className="flex gap-2">
                  <Button onClick={() => setDialog({ app: r, decision: 'APPROVED' })}>Approve</Button>
                  <Button variant="secondary" onClick={() => setDialog({ app: r, decision: 'REJECTED' })}>Reject</Button>
                </span>
              );
            },
          },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {dialog && (
        <ConfirmDialog
          title={`${dialog.decision === 'APPROVED' ? 'Approve' : 'Reject'} application ${dialog.app.id}`}
          message={`Customer: ${dialog.app.customerName}. Your decision is recorded with your identity and time.`}
          commentLabel="Comment"
          commentRequired={dialog.decision === 'REJECTED'}
          confirmLabel={dialog.decision === 'APPROVED' ? 'Approve' : 'Reject'}
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={decide}
        />
      )}
    </>
  );
}
