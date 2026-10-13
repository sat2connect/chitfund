import { useCallback } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { Button, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import SubNav from '../../components/navigation/SubNav.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { listJournals } from '../collections/financeService.js';

export function AccountingLayout() {
  return (
    <>
      <SubNav
        items={[
          { to: '/accounting', label: 'Journal entries' },
          { to: '/accounting/ledger', label: 'General ledger' },
          { to: '/accounting/trial-balance', label: 'Trial balance' },
          { to: '/accounting/statements', label: 'Statements' },
          { to: '/accounting/accounts', label: 'Chart of accounts' },
          { to: '/accounting/periods', label: 'Periods' },
        ]}
      />
      <Outlet />
    </>
  );
}

export const SimBadge = () => <StatusBadge tone="warning">Simulated</StatusBadge>;

export default function JournalsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { params, set, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listJournals(params, signal), [params]));
  return (
    <>
      <PageHeader
        title="Journal entries"
        description="Posted entries are immutable. Corrections are made by authorised reversal."
        actions={can('journal:create') && <Button onClick={() => navigate('/accounting/journals/new')}>New manual journal</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search number or memo" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED'].map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Source" value={params.sourceType} onChange={(sourceType) => set({ sourceType })} options={['MANUAL', 'PAYMENT', 'PAYMENT_REVERSAL', 'JOURNAL_REVERSAL'].map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No journal entries"
        columns={[
          { key: 'number', header: 'Number', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/accounting/journals/${r.id}`}>{r.number}</Link> },
          { key: 'date', header: 'Date' },
          { key: 'memo', header: 'Memo' },
          { key: 'source', header: 'Source', render: (r) => <span className="flex items-center gap-2">{humanize(r.source.type)} {r.simulated && <SimBadge />}</span> },
          { key: 'totalPaise', header: 'Amount', render: (r) => formatPaise(r.totalPaise) },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'POSTED' ? 'DONE' : r.status === 'REVERSED' ? 'CANCELLED' : r.status} /> },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
