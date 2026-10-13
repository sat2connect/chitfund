import { useCallback } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { PageHeader } from '../../components/common/ui.jsx';
import SubNav from '../../components/navigation/SubNav.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { listPayouts } from '../auctions/auctionService.js';

const STATUSES = ['DRAFT', 'ELIGIBILITY_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'DISBURSEMENT_PENDING', 'PAID', 'ON_HOLD', 'FAILED'];

export function PayoutsLayout() {
  const { can } = useAuth();
  return (
    <>
      <SubNav items={[{ to: '/payouts', label: 'Prize payouts' }, ...(can('payout:view') ? [{ to: '/payouts/reconciliation', label: 'Payout reconciliation' }] : [])]} />
      <Outlet />
    </>
  );
}

export default function PayoutsPage() {
  const { params, set, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listPayouts(params, signal), [params]));
  return (
    <>
      <PageHeader title="Prize payouts" description="Payouts follow approved auction results. Create one from the auction page." />
      <div className="mb-4"><Banner tone="info">Amounts are entered manually by Finance and approved by a different person. The system does not calculate prizes or dividends, and no payout provider is connected: disbursement is recorded after Finance pays outside this system.</Banner></div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search payout, member, group" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No payouts"
        columns={[
          { key: 'id', header: 'Payout', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/payouts/${r.id}`}>{r.id}</Link> },
          { key: 'groupCode', header: 'Group', render: (r) => `${r.groupCode} #${r.ticketNo}` },
          { key: 'customerName', header: 'Winner' },
          { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
          { key: 'channel', header: 'Channel', render: (r) => (r.channel ? humanize(r.channel) : '-') },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'PAID' ? 'DONE' : r.status} /> },
          { key: 'reconciliationStatus', header: 'Reconciliation', render: (r) => (r.status === 'PAID' ? humanize(r.reconciliationStatus) : '-') },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
