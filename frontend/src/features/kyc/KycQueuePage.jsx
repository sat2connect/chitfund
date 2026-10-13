import { useCallback } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { PageHeader } from '../../components/common/ui.jsx';
import SubNav from '../../components/navigation/SubNav.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { listKyc } from './kycService.js';

const STATUSES = ['NOT_STARTED', 'DOCUMENTS_PENDING', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'VERIFIED', 'REJECTED'];

export function KycLayout() {
  return (
    <>
      <SubNav items={[{ to: '/kyc', label: 'Verification queue' }, { to: '/kyc/applications', label: 'Membership applications' }]} />
      <Outlet />
    </>
  );
}

export default function KycQueuePage() {
  const { params, set, setPage } = useListParams({ status: 'UNDER_REVIEW' });
  const loader = useCallback((signal) => listKyc(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  return (
    <>
      <PageHeader title="KYC verification queue" description="Manual review of customer KYC cases. Cases awaiting review are shown first." />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search customer or case ID" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No KYC cases in this view"
        emptyDescription="Change the status filter to see other cases."
        columns={[
          { key: 'id', header: 'Case', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/kyc/cases/${r.id}`}>{r.id}</Link> },
          { key: 'customerName', header: 'Customer', render: (r) => <Link className="hover:underline" to={`/crm/customers/${r.customerId}`}>{r.customerName}</Link> },
          { key: 'branchId', header: 'Branch' },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
          { key: 'documentCount', header: 'Docs' },
          { key: 'submittedAt', header: 'Submitted', render: (r) => formatDateTime(r.submittedAt) },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
