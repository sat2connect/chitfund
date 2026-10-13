import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/common/ui.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { listArrears } from './financeService.js';

export default function ArrearsPage() {
  const { params, set, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listArrears(params, signal), [params]));
  return (
    <>
      <PageHeader title="Arrears follow-up" description="Customers with overdue instalments, oldest first." />
      <div className="mb-3"><SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search name, phone, ID" /></div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No arrears"
        emptyDescription="No instalments are overdue."
        columns={[
          { key: 'customerName', header: 'Customer', render: (r) => <Link className="text-brand-700 hover:underline" to={`/crm/customers/${r.customerId}`}>{r.customerName}</Link> },
          { key: 'phone', header: 'Phone' },
          { key: 'branchId', header: 'Branch' },
          { key: 'count', header: 'Overdue instalments' },
          { key: 'oldestDueDate', header: 'Oldest due' },
          { key: 'overduePaise', header: 'Overdue amount', render: (r) => formatPaise(r.overduePaise) },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
