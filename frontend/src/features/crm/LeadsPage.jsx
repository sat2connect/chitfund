import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { Button, PageHeader } from '../../components/common/ui.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate, humanize } from '../../utils/labels.js';
import { listLeads } from './crmService.js';

const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'REGISTRATION_PENDING', 'CONVERTED', 'LOST'];

export default function LeadsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { params, set, setPage } = useListParams();
  const loader = useCallback((signal) => listLeads(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Track prospects from first contact to customer conversion."
        actions={can('lead:create') && <Button onClick={() => navigate('/crm/leads/new')}>Create lead</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search name, phone, ID" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No leads found"
        emptyDescription="Adjust the filters, or create a lead to get started."
        columns={[
          { key: 'id', header: 'ID', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/crm/leads/${r.id}`}>{r.id}</Link> },
          { key: 'name', header: 'Name' },
          { key: 'phone', header: 'Phone' },
          { key: 'source', header: 'Source', render: (r) => humanize(r.source) },
          { key: 'branchId', header: 'Branch' },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
          { key: 'createdAt', header: 'Created', render: (r) => formatDate(r.createdAt) },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
