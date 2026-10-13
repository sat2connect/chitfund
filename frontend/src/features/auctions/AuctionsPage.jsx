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
import { humanize } from '../../utils/labels.js';
import { formatTime } from '../../utils/time.js';
import { listAuctions } from './auctionService.js';

const STATUSES = ['SCHEDULED', 'READY', 'OPEN', 'CLOSED', 'VALIDATION', 'APPROVAL_PENDING', 'APPROVED', 'SETTLED', 'CANCELLED'];

export function AuctionsLayout() {
  const { can } = useAuth();
  return (
    <>
      <SubNav items={[{ to: '/auctions', label: 'Auction calendar' }, ...(can('auction:create') ? [{ to: '/auctions/new', label: 'Schedule auction' }] : [])]} />
      <Outlet />
    </>
  );
}

export default function AuctionsPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const { params, set, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listAuctions(params, signal), [params]));
  const member = Boolean(user?.customerId);
  return (
    <>
      <PageHeader
        title={member ? 'My auctions' : 'Auction calendar'}
        description={member ? 'Auctions for groups where you hold a ticket.' : 'Scheduled and past auctions in your branches. Times follow the server clock.'}
        actions={can('auction:create') && <Button onClick={() => navigate('/auctions/new')}>Schedule auction</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search group or auction ID" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No auctions"
        emptyDescription={member ? 'Auctions appear here once your group schedules one.' : 'Schedule an auction for an active group.'}
        columns={[
          { key: 'id', header: 'Auction', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/auctions/${r.id}`}>{r.id}</Link> },
          { key: 'groupCode', header: 'Group' },
          { key: 'cycleNo', header: 'Cycle' },
          { key: 'scheduledOpenAt', header: 'Opens', render: (r) => formatTime(r.scheduledOpenAt) },
          { key: 'scheduledCloseAt', header: 'Closes', render: (r) => formatTime(r.scheduledCloseAt) },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
          ...(member ? [] : [
            { key: 'bidCount', header: 'Bids' },
            { key: 'hasOpenDispute', header: '', render: (r) => (r.hasOpenDispute ? <StatusBadge tone="danger">Dispute open</StatusBadge> : null) },
          ]),
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
