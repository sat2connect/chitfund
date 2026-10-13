import { Link } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { Card, PageHeader, StatCard, StatusBadge } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { getSummary } from './portalService.js';

export default function PortalHome() {
  const { data, error, loading, reload } = useApi(getSummary);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { customer, totals, memberships } = data;
  return (
    <>
      <PageHeader title={`Welcome, ${customer.name}`} description={`As of ${data.today}`} />
      {customer.kycStatus !== 'VERIFIED' && <div className="mb-4"><Banner tone="warning">Your KYC status is {humanize(customer.kycStatus)}. Contact your branch to complete verification.</Banner></div>}
      {data.pendingPaymentAttempts > 0 && <div className="mb-4"><Banner tone="info">You have {data.pendingPaymentAttempts} online payment(s) awaiting confirmation. <Link className="underline" to="/portal/pay">View</Link></Banner></div>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Outstanding dues" value={formatPaise(totals.outstandingDuePaise)} hint="Instalments already due" />
        <StatCard label="Overdue" value={formatPaise(totals.overduePaise)} />
        <StatCard label="Paid so far" value={formatPaise(totals.paidPaise)} />
      </div>
      <h2 className="mb-2 text-sm font-semibold">Your memberships</h2>
      {memberships.length === 0 ? (
        <Banner tone="info">You are not yet in an active chit group. {humanize(customer.membershipStatus)}.</Banner>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {memberships.map((m) => (
            <Card key={`${m.groupId}-${m.ticketNo}`} title={`${m.groupName} · ticket #${m.ticketNo}`} action={<StatusBadge tone={m.groupStatus === 'ACTIVE' ? 'success' : 'neutral'}>{humanize(m.groupStatus)}</StatusBadge>}>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Scheme</dt><dd>{m.schemeName}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Chit value</dt><dd>{formatPaise(m.chitValuePaise)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Instalment</dt><dd>{formatPaise(m.installmentAmountPaise)} / month</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Outstanding</dt><dd>{formatPaise(m.outstandingDuePaise)}</dd></div>
                {m.nextDue && (
                  <div className="flex items-center justify-between"><dt className="text-muted">Next due</dt><dd>{m.nextDue.dueDate} · {formatPaise(m.nextDue.outstandingPaise)} <Status value={m.nextDue.status} /></dd></div>
                )}
              </dl>
            </Card>
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-4 text-sm">
        <Link className="text-brand-700 underline" to="/portal/pay">Pay dues</Link>
        <Link className="text-brand-700 underline" to="/portal/statement">View statement</Link>
        <Link className="text-brand-700 underline" to="/auctions">Auctions</Link>
        <Link className="text-brand-700 underline" to="/portal/support">Support{data.openSupportCases ? ` (${data.openSupportCases} open)` : ''}</Link>
      </div>
    </>
  );
}
