import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { PageHeader } from '../../components/common/ui.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDateTime } from '../../utils/labels.js';
import { listFollowUps } from './crmService.js';

export default function FollowUpsPage() {
  const { params, set, setPage } = useListParams({ status: 'OPEN' });
  const loader = useCallback((signal) => listFollowUps(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  return (
    <>
      <PageHeader title="Follow-ups" description="Scheduled follow-up tasks for leads in your branches." />
      <div className="mb-3">
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={[{ value: 'OPEN', label: 'Open' }, { value: 'DONE', label: 'Done' }]} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No follow-ups"
        emptyDescription="Schedule follow-ups from a lead's detail page."
        columns={[
          { key: 'dueAt', header: 'Due', render: (r) => formatDateTime(r.dueAt) },
          { key: 'leadName', header: 'Lead', render: (r) => <Link className="text-brand-700 hover:underline" to={`/crm/leads/${r.leadId}`}>{r.leadName ?? r.leadId}</Link> },
          { key: 'note', header: 'Note' },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
