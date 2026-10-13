import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { Button, PageHeader } from '../../components/common/ui.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { humanize } from '../../utils/labels.js';
import { listCustomers } from './crmService.js';

const KYC = ['NOT_STARTED', 'DOCUMENTS_PENDING', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'VERIFIED', 'REJECTED'];

export default function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { params, set, setPage } = useListParams();
  const loader = useCallback((signal) => listCustomers(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  return (
    <>
      <PageHeader
        title="Customers"
        description="Customer directory for your branches."
        actions={can('customer:create') && <Button onClick={() => navigate('/crm/customers/new')}>Register customer</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search name, phone, ID" />
        <FilterSelect label="KYC" value={params.kycStatus} onChange={(kycStatus) => set({ kycStatus })} options={KYC.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No customers found"
        columns={[
          { key: 'id', header: 'ID', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/crm/customers/${r.id}`}>{r.id}</Link> },
          { key: 'name', header: 'Name' },
          { key: 'phone', header: 'Phone' },
          { key: 'branchId', header: 'Branch' },
          { key: 'kycStatus', header: 'KYC', render: (r) => <Status value={r.kycStatus} /> },
          { key: 'membershipStatus', header: 'Membership', render: (r) => <Status value={r.membershipStatus} /> },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
