import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageHeader, StatusBadge } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { getLedger, getStatements, getTrialBalance, listAccounts } from '../collections/financeService.js';
import { SimBadge } from './JournalsPage.jsx';

function SimulatedToggle({ value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Include simulated entries
    </label>
  );
}

export function LedgerPage() {
  const accounts = useApi(listAccounts);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sim, setSim] = useState(false);
  const loader = useCallback((signal) => (accountId ? getLedger({ accountId, from, to, includeSimulated: sim || undefined }, signal) : Promise.resolve(null)), [accountId, from, to, sim]);
  const ledger = useApi(loader);
  if (accounts.loading) return <LoadingState />;
  if (accounts.error) return <ErrorState error={accounts.error} />;
  return (
    <>
      <PageHeader title="General ledger" description="Built only from posted journals." />
      <div className="mb-4 grid items-end gap-3 sm:grid-cols-4">
        <SelectField label="Account" placeholder="Select account" value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts.data.items.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <SimulatedToggle value={sim} onChange={setSim} />
      </div>
      {!accountId && <Banner tone="info">Choose an account to view its ledger.</Banner>}
      {accountId && ledger.loading && <LoadingState />}
      {ledger.error && <ErrorState error={ledger.error} onRetry={ledger.reload} />}
      {ledger.data && (
        <>
          <p className="mb-2 text-sm text-muted">Opening {formatPaise(ledger.data.openingPaise)} · Closing <strong className="text-ink">{formatPaise(ledger.data.closingPaise)}</strong></p>
          <DataTable
            rows={ledger.data.items}
            emptyTitle="No posted entries"
            columns={[
              { key: 'date', header: 'Date' },
              { key: 'journalNumber', header: 'Journal', render: (r) => <Link className="text-brand-700 hover:underline" to={`/accounting/journals/${r.journalId}`}>{r.journalNumber}</Link> },
              { key: 'memo', header: 'Memo', render: (r) => <span className="flex items-center gap-2">{r.memo} {r.simulated && <SimBadge />}</span> },
              { key: 'debitPaise', header: 'Debit', render: (r) => (r.debitPaise ? formatPaise(r.debitPaise) : '') },
              { key: 'creditPaise', header: 'Credit', render: (r) => (r.creditPaise ? formatPaise(r.creditPaise) : '') },
              { key: 'balancePaise', header: 'Balance', render: (r) => formatPaise(r.balancePaise) },
            ]}
          />
        </>
      )}
    </>
  );
}

export function TrialBalancePage() {
  const [asOf, setAsOf] = useState('');
  const [sim, setSim] = useState(false);
  const { data, error, loading, reload } = useApi(useCallback((signal) => getTrialBalance({ asOf, includeSimulated: sim || undefined }, signal), [asOf, sim]));
  return (
    <>
      <PageHeader title="Trial balance" description="Totals of posted journals by account." />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-48"><TextField label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        <SimulatedToggle value={sim} onChange={setSim} />
      </div>
      {data && !sim && <div className="mb-3"><Banner tone="info">Simulated gateway entries are excluded. Tick the box to include them.</Banner></div>}
      {data && <p className="mb-2 text-sm">{data.balanced ? <StatusBadge tone="success">Debits equal credits</StatusBadge> : <StatusBadge tone="danger">Out of balance</StatusBadge>}</p>}
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        columns={[
          { key: 'code', header: 'Code' },
          { key: 'name', header: 'Account' },
          { key: 'type', header: 'Type', render: (r) => humanize(r.type) },
          { key: 'debitPaise', header: 'Debit', render: (r) => formatPaise(r.debitPaise) },
          { key: 'creditPaise', header: 'Credit', render: (r) => formatPaise(r.creditPaise) },
          { key: 'balancePaise', header: 'Balance', render: (r) => formatPaise(r.balancePaise) },
        ]}
      />
      {data && <p className="mt-3 text-sm font-medium">Total debits {formatPaise(data.totalDebitPaise)} · Total credits {formatPaise(data.totalCreditPaise)}</p>}
    </>
  );
}

const Section = ({ title, rows, total, totalLabel }) => (
  <Card title={title}>
    <table className="min-w-full text-sm">
      <tbody className="divide-y divide-line">
        {rows.map((r) => <tr key={r.code}><td className="py-1.5">{r.code} · {r.name}</td><td className="text-right tabular-nums">{formatPaise(r.amountPaise)}</td></tr>)}
      </tbody>
      <tfoot><tr className="border-t border-line font-medium"><td className="py-1.5">{totalLabel}</td><td className="text-right tabular-nums">{formatPaise(total)}</td></tr></tfoot>
    </table>
  </Card>
);

export function StatementsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sim, setSim] = useState(false);
  const { data, error, loading, reload } = useApi(useCallback((signal) => getStatements({ from, to, includeSimulated: sim || undefined }, signal), [from, to, sim]));
  return (
    <>
      <PageHeader title="Financial statements (provisional)" description="Profit and loss for the period; balance sheet as of the end date." />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-44"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-44"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <SimulatedToggle value={sim} onChange={setSim} />
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <div className="space-y-5">
          <Banner tone="warning">{data.notice}</Banner>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <Section title="Income" rows={data.profitAndLoss.income} total={data.profitAndLoss.totalIncomePaise} totalLabel="Total income" />
              <Section title="Expenses" rows={data.profitAndLoss.expense} total={data.profitAndLoss.totalExpensePaise} totalLabel="Total expenses" />
              <p className="text-sm font-medium">Net result: {formatPaise(data.profitAndLoss.netPaise)}</p>
            </div>
            <div className="space-y-5">
              <Section title="Assets" rows={data.balanceSheet.assets} total={data.balanceSheet.totalAssetsPaise} totalLabel="Total assets" />
              <Section title="Liabilities" rows={data.balanceSheet.liabilities} total={data.balanceSheet.liabilities.reduce((a, r) => a + r.amountPaise, 0)} totalLabel="Total liabilities" />
              <Section title="Equity" rows={[...data.balanceSheet.equity, { code: '-', name: 'Cumulative earnings', amountPaise: data.balanceSheet.cumulativeEarningsPaise }]} total={data.balanceSheet.equity.reduce((a, r) => a + r.amountPaise, 0) + data.balanceSheet.cumulativeEarningsPaise} totalLabel="Total equity" />
              <p className="text-sm">{data.balanceSheet.balanced ? <StatusBadge tone="success">Assets equal liabilities plus equity</StatusBadge> : <StatusBadge tone="danger">Balance sheet does not balance</StatusBadge>}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
