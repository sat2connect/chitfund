import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { parseRupees } from '../../utils/money.js';
import { cancelMyAttempt, getMyPayment, getProfile, getStatement, getSummary, listMyAttempts, listMyInstalments, listMyPayments, listMyPayouts, startPayment } from './portalService.js';

export function PortalInstalments() {
  const { params, set, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listMyInstalments(params, signal), [params]));
  return (
    <>
      <PageHeader title="My dues" description="Your instalments and what has been paid against each." />
      <div className="mb-3"><FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={['SCHEDULED', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((s) => ({ value: s, label: humanize(s) }))} /></div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No instalments yet"
        emptyDescription="Instalments appear once your group becomes active."
        columns={[
          { key: 'groupCode', header: 'Group', render: (r) => `${r.groupCode} #${r.ticketNo}` },
          { key: 'seq', header: 'Instalment' },
          { key: 'dueDate', header: 'Due date' },
          { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
          { key: 'paidPaise', header: 'Paid', render: (r) => formatPaise(r.paidPaise) },
          { key: 'outstandingPaise', header: 'Outstanding', render: (r) => formatPaise(r.outstandingPaise) },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}

export function PortalPay() {
  const summary = useApi(getSummary);
  const attempts = useApi(listMyAttempts);
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [started, setStarted] = useState(null);
  const [cancel, setCancel] = useState(null);
  const paise = parseRupees(amount);
  if (summary.loading || attempts.loading) return <LoadingState />;
  if (summary.error || attempts.error) return <ErrorState error={summary.error ?? attempts.error} />;
  const payable = summary.data.totals.outstandingDuePaise;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setStarted(await startPayment({ amountPaise: paise }));
      setAmount('');
      setConfirm(false);
      attempts.reload();
      summary.reload();
    } catch (e) {
      setConfirm(false);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Pay your dues" description={`Amount currently payable: ${formatPaise(payable)}`} />
      <div className="mb-4"><Banner tone="warning"><strong>Simulated payment.</strong> No payment provider is connected and no real money moves. Starting a payment only creates a request; it counts as paid only when the provider confirms it, never from this page.</Banner></div>
      {started && <div className="mb-4"><Banner tone="info">Request {started.id} created and awaiting confirmation. Your dues are unchanged until it is confirmed.</Banner></div>}
      {error && <div className="mb-4"><Banner tone="error">{error.message}{error.details?.outstandingPaise !== undefined ? ` (payable ${formatPaise(error.details.outstandingPaise)})` : ''}</Banner></div>}
      {payable === 0 ? <Banner tone="info">You have no dues to pay right now.</Banner> : (
        <Card title="Start a payment" className="max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); setStarted(null); setConfirm(true); }} className="space-y-3">
            <TextField label="Amount (₹)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
              error={amount && paise === null ? 'Enter a valid amount with up to 2 decimals' : amount && paise > payable ? 'More than the amount payable' : undefined} />
            <Button type="submit" disabled={busy || paise === null || paise < 1 || paise > payable}>Review payment</Button>
          </form>
        </Card>
      )}
      <h2 className="mb-2 mt-6 text-sm font-semibold">Your payment requests</h2>
      <DataTable
        rows={attempts.data.items}
        emptyTitle="No online payment requests"
        columns={[
          { key: 'id', header: 'Request', render: (r) => <span className="flex items-center gap-2">{r.id} <StatusBadge tone="warning">Simulated</StatusBadge></span> },
          { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
          { key: 'createdAt', header: 'Created', render: (r) => formatDateTime(r.createdAt) },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'PENDING_CONFIRMATION' ? 'PENDING' : r.status === 'SUCCESSFUL' ? 'DONE' : r.status} label={humanize(r.status)} /> },
          { key: 'a', header: '', render: (r) => (r.status === 'PENDING_CONFIRMATION' ? <Button variant="secondary" onClick={() => setCancel(r)}>Cancel</Button> : r.paymentId ? <Link className="text-brand-700 underline" to={`/portal/payments/${r.paymentId}`}>Receipt</Link> : null) },
        ]}
      />
      {confirm && <ConfirmDialog title="Confirm payment request" message={`Request a simulated online payment of ${formatPaise(paise)}. It is applied to your oldest due instalment first.`} confirmLabel="Start payment" busy={busy} onCancel={() => setConfirm(false)} onConfirm={send} />}
      {cancel && <ConfirmDialog title="Cancel payment request" message={`Cancel ${cancel.id}?`} confirmLabel="Cancel request" onCancel={() => setCancel(null)} onConfirm={async () => { await cancelMyAttempt(cancel.id); setCancel(null); attempts.reload(); summary.reload(); }} />}
    </>
  );
}

export function PortalPayments() {
  const { params, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listMyPayments(params, signal), [params]));
  return (
    <>
      <PageHeader title="Payment history" description="Payments received against your dues." />
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No payments yet"
        columns={[
          { key: 'receiptId', header: 'Receipt', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/portal/payments/${r.id}`}>{r.receiptId}</Link> },
          { key: 'receivedDate', header: 'Date' },
          { key: 'mode', header: 'Mode', render: (r) => <span className="flex items-center gap-2">{humanize(r.mode)} {r.simulated && <StatusBadge tone="warning">Simulated</StatusBadge>}</span> },
          { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'SUCCESSFUL' ? 'DONE' : 'CANCELLED'} label={humanize(r.status)} /> },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}

export function PortalPaymentDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => getMyPayment(id, signal), [id]));
  const profile = useApi(getProfile);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { payment: p, allocations, notice } = data;
  return (
    <>
      <PageHeader title={`Receipt ${p.receiptId}`} description={`${profile.data?.name ?? ''} · ${p.receivedDate}`} actions={<Button variant="secondary" onClick={() => window.print()}>Print</Button>} />
      {notice && <div className="mb-4"><Banner tone="warning">{notice}</Banner></div>}
      {p.status === 'REVERSED' && <div className="mb-4"><Banner tone="warning">This payment was reversed and the receipt is void. See your statement for the adjustment.</Banner></div>}
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Payment">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Amount</dt><dd className="font-medium">{formatPaise(p.amountPaise)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Mode</dt><dd>{humanize(p.mode)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Reference</dt><dd>{p.reference ?? '-'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Receipt status</dt><dd>{p.receiptStatus === 'ISSUED' ? 'Issued' : 'Void'}</dd></div>
          </dl>
        </Card>
        <Card title="Applied to">
          <ul className="space-y-1.5 text-sm">
            {allocations.map((a) => <li key={a.id} className="flex justify-between"><span>{a.groupCode} #{a.ticketNo} · instalment {a.seq} (due {a.dueDate})</span><span>{formatPaise(a.amountPaise)}</span></li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}

export function PortalStatement() {
  const summary = useApi(getSummary);
  const [groupId, setGroupId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error, loading, reload } = useApi(useCallback((signal) => getStatement({ groupId, from, to }, signal), [groupId, from, to]));
  return (
    <>
      <PageHeader title="Statement" description="Instalments due and payments received." actions={<Button variant="secondary" onClick={() => window.print()}>Print</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <SelectField label="Group" placeholder="All groups" value={groupId} onChange={(e) => setGroupId(e.target.value)} options={(summary.data?.memberships ?? []).map((m) => ({ value: m.groupId, label: `${m.groupCode} #${m.ticketNo}` }))} />
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <div className="mb-3"><Banner tone="info">{data.notice}</Banner></div>
          <DataTable
            rows={data.lines}
            emptyTitle="No entries"
            columns={[
              { key: 'date', header: 'Date' },
              { key: 'description', header: 'Description' },
              { key: 'debitPaise', header: 'Due', render: (r) => (r.debitPaise ? formatPaise(r.debitPaise) : '') },
              { key: 'creditPaise', header: 'Paid', render: (r) => (r.creditPaise ? formatPaise(r.creditPaise) : '') },
              { key: 'balancePaise', header: 'Balance', render: (r) => formatPaise(r.balancePaise) },
            ]}
          />
          <p className="mt-3 text-sm">Opening {formatPaise(data.openingPaise)} · Due {formatPaise(data.totalDebitPaise)} · Paid {formatPaise(data.totalCreditPaise)} · <strong>Balance {formatPaise(data.closingPaise)}</strong></p>
          <p className="mt-1 text-xs text-muted">Generated {formatDateTime(data.generatedAt)} (server time).</p>
        </>
      )}
    </>
  );
}

export function PortalPayouts() {
  const { data, error, loading, reload } = useApi(listMyPayouts);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Prize payouts" description="Track any prize payout for your tickets." />
      {data.items.length === 0 ? <Banner tone="info">You have no prize payouts at the moment.</Banner> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((p) => (
            <Card key={p.id} title={`${p.groupCode} · ticket #${p.ticketNo}`} action={<StatusBadge tone={p.status === 'PAID' ? 'success' : p.status === 'ON_HOLD' ? 'danger' : 'info'}>{p.stage}</StatusBadge>}>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Amount</dt><dd>{p.amountPaise !== undefined ? formatPaise(p.amountPaise) : 'Shown once approved'}</dd></div>
                {p.channel && <div className="flex justify-between"><dt className="text-muted">Channel</dt><dd>{humanize(p.channel)}</dd></div>}
                {p.paidDate && <div className="flex justify-between"><dt className="text-muted">Paid on</dt><dd>{p.paidDate}</dd></div>}
                {p.reference && <div className="flex justify-between"><dt className="text-muted">Reference</dt><dd>{p.reference}</dd></div>}
              </dl>
              {p.documents.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-medium">Documents</p>
                  <ul className="text-sm">{p.documents.map((d) => <li key={d.title}>{d.confirmed ? '✓' : '○'} {d.title}</li>)}</ul>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Notifications about payouts are not sent yet. Please check this page for updates.</p>
    </>
  );
}
