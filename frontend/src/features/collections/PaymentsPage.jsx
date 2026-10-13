import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { PageHeader } from '../../components/common/ui.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { SimulatedBadge } from './CollectionsLayout.jsx';
import { listPayments } from './financeService.js';

export default function PaymentsPage() {
  const { params, set, setPage } = useListParams();
  const loader = useCallback((signal) => listPayments(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  return (
    <>
      <PageHeader title="Payments and receipts" description="Confirmed payments only. Pending online attempts are listed separately." />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search payment, receipt, customer, reference" />
        <FilterSelect label="Mode" value={params.mode} onChange={(mode) => set({ mode })} options={['CASH', 'CHEQUE', 'UPI', 'BANK_TRANSFER', 'ONLINE_SIMULATED'].map((m) => ({ value: m, label: humanize(m) }))} />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={[{ value: 'SUCCESSFUL', label: 'Successful' }, { value: 'REVERSED', label: 'Reversed' }]} />
        <FilterSelect label="Reconciliation" value={params.reconciliationStatus} onChange={(reconciliationStatus) => set({ reconciliationStatus })} options={['PENDING', 'MATCHED', 'EXCEPTION', 'NOT_APPLICABLE'].map((m) => ({ value: m, label: humanize(m) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No payments"
        columns={[
          { key: 'id', header: 'Payment', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/collections/payments/${r.id}`}>{r.id}</Link> },
          { key: 'receiptId', header: 'Receipt' },
          { key: 'customerName', header: 'Customer' },
          { key: 'mode', header: 'Mode', render: (r) => <span className="flex items-center gap-2">{humanize(r.mode)} {r.simulated && <SimulatedBadge />}</span> },
          { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
          { key: 'receivedDate', header: 'Received' },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'SUCCESSFUL' ? 'DONE' : 'CANCELLED'} /> },
          { key: 'reconciliationStatus', header: 'Reconciliation', render: (r) => humanize(r.reconciliationStatus) },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
