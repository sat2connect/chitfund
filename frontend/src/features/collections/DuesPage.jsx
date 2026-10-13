import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { PageHeader, StatCard } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { getInstalmentSummary, listInstalments } from './financeService.js';

const STATUSES = ['SCHEDULED', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];

export default function DuesPage() {
  const { can } = useAuth();
  const { params, set, setPage } = useListParams();
  const loader = useCallback((signal) => listInstalments(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  const summary = useApi(getInstalmentSummary);
  return (
    <>
      <PageHeader title="Instalment dues" description="Schedules are generated when a group is activated. Status is calculated from due dates and amounts paid." />
      {summary.loading && <LoadingState />}
      {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
      {summary.data && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Due to date" value={formatPaise(summary.data.dueToDatePaise)} hint={`As of ${summary.data.today}`} />
            <StatCard label="Collected against dues" value={formatPaise(summary.data.collectedAgainstDuePaise)} />
            <StatCard label="Outstanding" value={formatPaise(summary.data.outstandingDuePaise)} />
            <StatCard label="Overdue" value={formatPaise(summary.data.overduePaise)} hint={`${summary.data.overdueCount} instalment(s)`} />
          </div>
          <div className="mb-4"><Banner tone="info">{summary.data.graceNotice} Currently {summary.data.graceDays} grace day(s).</Banner></div>
        </>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search customer, group, ID" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No instalments"
        emptyDescription="Instalments appear after a group is activated."
        columns={[
          { key: 'groupCode', header: 'Group', render: (r) => <Link className="text-brand-700 hover:underline" to={`/schemes/groups/${r.groupId}`}>{r.groupCode}</Link> },
          { key: 'ticketNo', header: 'Ticket', render: (r) => `#${r.ticketNo}` },
          { key: 'customerName', header: 'Member', render: (r) => <Link className="text-brand-700 hover:underline" to={`/crm/customers/${r.customerId}`}>{r.customerName}</Link> },
          { key: 'seq', header: 'No.', render: (r) => `${r.seq}` },
          { key: 'dueDate', header: 'Due date' },
          { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
          { key: 'paidPaise', header: 'Paid', render: (r) => formatPaise(r.paidPaise) },
          { key: 'outstandingPaise', header: 'Outstanding', render: (r) => formatPaise(r.outstandingPaise) },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
          {
            key: 'a', header: '',
            render: (r) => (can('collection:record') && r.outstandingPaise > 0 && r.status !== 'SCHEDULED'
              ? <Link className="text-brand-700 underline" to={`/collections/collect?customerId=${r.customerId}`}>Collect</Link> : null),
          },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
