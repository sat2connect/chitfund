import { Navigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Card, PageHeader, StatCard, StatusBadge } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatINR, formatNumber } from '../../utils/format.js';
import { fetchDashboardSummary } from './dashboardService.js';

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi(fetchDashboardSummary);
  const { user } = useAuth();
  if (user?.customerId) return <Navigate to="/portal" replace />;

  return (
    <>
      <PageHeader title="Dashboard" description="Operational overview across the organisation." />
      {loading && <LoadingState label="Loading dashboard…" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && <DashboardBody payload={data} />}
    </>
  );
}

function DashboardBody({ payload }) {
  const d = payload.data;
  const isDemo = payload.dataSource === 'demo';
  const conversion = d.leads.total ? Math.round((d.leads.converted / d.leads.total) * 100) : 0;
  const outstanding = d.collections.dueAmount - d.collections.receivedAmount;

  return (
    <div className="space-y-5">
      {isDemo && <Banner tone="warning"><strong>Demo data.</strong> {payload.notice}</Banner>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total leads" value={formatNumber(d.leads.total)} hint={`${d.leads.converted} converted (${conversion}%)`} />
        <StatCard label="Pending KYC" value={formatNumber(d.kyc.pending)} hint={`${d.kyc.underReview} under review`} />
        <StatCard label="Active groups" value={formatNumber(d.groups.active)} hint={`${d.schemes.active} active schemes`} />
        <StatCard label="Active memberships" value={formatNumber(d.memberships.active)} />
        <StatCard label="Instalments due" value={formatINR(d.collections.dueAmount)} />
        <StatCard label="Collected" value={formatINR(d.collections.receivedAmount)} hint={`Outstanding ${formatINR(outstanding)}`} />
        <StatCard label="Overdue" value={formatINR(d.collections.overdueAmount)} />
        <StatCard label="Reconciliation exceptions" value={formatNumber(d.reconciliationExceptions)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Upcoming auctions">
          <DataTable
            columns={[
              { key: 'group', header: 'Group' },
              { key: 'date', header: 'Date' },
            ]}
            rows={d.upcomingAuctions}
            emptyTitle="No upcoming auctions"
          />
        </Card>
        <Card title="Pending approvals">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Auction approvals</span><StatusBadge tone="warning">{d.approvals.auctionsPending}</StatusBadge></li>
            <li className="flex justify-between"><span>Payout approvals</span><StatusBadge tone="warning">{d.approvals.payoutsPending}</StatusBadge></li>
          </ul>
        </Card>
      </div>

      <Card title="Alerts">
        {d.alerts.length ? (
          <ul className="space-y-2 text-sm">
            {d.alerts.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <StatusBadge tone={a.level === 'warning' ? 'warning' : 'info'}>{a.level}</StatusBadge>
                {a.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No alerts.</p>
        )}
      </Card>
    </div>
  );
}
