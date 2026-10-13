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
import { listGroups } from './schemeService.js';

const STATUSES = ['DRAFT', 'APPROVAL_PENDING', 'ENROLMENT_OPEN', 'READY_TO_START', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'CLOSED'];

export default function GroupsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { params, set, setPage } = useListParams();
  const loader = useCallback((signal) => listGroups(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  return (
    <>
      <PageHeader
        title="Chit groups"
        description="Groups in your branches, from draft to active."
        actions={can('group:create') && <Button onClick={() => navigate('/schemes/groups/new')}>Create group</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search code or name" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No groups found"
        emptyDescription="Groups are created from a published scheme version."
        columns={[
          { key: 'code', header: 'Code', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/schemes/groups/${r.id}`}>{r.code}</Link> },
          { key: 'name', header: 'Name' },
          { key: 'schemeLabel', header: 'Scheme' },
          { key: 'branchId', header: 'Branch' },
          { key: 'allocated', header: 'Tickets', render: (r) => `${r.allocated} / ${r.tickets}` },
          { key: 'plannedStartDate', header: 'Planned start' },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
