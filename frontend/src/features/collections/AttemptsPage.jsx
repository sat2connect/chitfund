import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, PageHeader } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { SimulatedBadge } from './CollectionsLayout.jsx';
import { cancelAttempt, listAttempts, simulateCallback } from './financeService.js';

export default function AttemptsPage() {
  const { can } = useAuth();
  const { params, set, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listAttempts(params, signal), [params]));
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const close = () => { setDialog(null); setActionError(null); };
  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      close();
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Online payment attempts" description="A browser success page never proves payment. Only a provider callback confirms an attempt." />
      <div className="mb-4"><Banner tone="warning"><strong>Simulated gateway.</strong> No payment provider is connected, so no real money moves. The buttons below stand in for the provider's callback so the workflow can be tested.</Banner></div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search attempt, customer, provider ref" />
        <FilterSelect label="Status" value={params.status} onChange={(status) => set({ status })} options={['PENDING_CONFIRMATION', 'SUCCESSFUL', 'FAILED', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No online attempts"
        columns={[
          { key: 'id', header: 'Attempt', render: (r) => <span className="flex items-center gap-2">{r.id} <SimulatedBadge /></span> },
          { key: 'customerName', header: 'Customer' },
          { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
          { key: 'providerRef', header: 'Provider ref' },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'PENDING_CONFIRMATION' ? 'PENDING' : r.status === 'SUCCESSFUL' ? 'DONE' : r.status} /> },
          {
            key: 'actions', header: 'Actions',
            render: (r) => {
              if (r.status === 'SUCCESSFUL' && r.paymentId) return <Link className="text-brand-700 underline" to={`/collections/payments/${r.paymentId}`}>View payment</Link>;
              if (r.status !== 'PENDING_CONFIRMATION') return null;
              return (
                <span className="flex gap-2">
                  {can('payment:simulate') && <Button onClick={() => setDialog({ r, outcome: 'SUCCESS' })}>Simulate success</Button>}
                  {can('payment:simulate') && <Button variant="secondary" onClick={() => setDialog({ r, outcome: 'FAILURE' })}>Simulate failure</Button>}
                  {can('payment:initiate') && <Button variant="secondary" onClick={() => setDialog({ r, cancel: true })}>Cancel</Button>}
                </span>
              );
            },
          },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {dialog && !dialog.cancel && (
        <ConfirmDialog
          title={`Simulate provider callback: ${humanize(dialog.outcome)}`}
          message={`Attempt ${dialog.r.id} for ${formatPaise(dialog.r.amountPaise)}. This is SIMULATED; it will ${dialog.outcome === 'SUCCESS' ? 'create a simulated payment, receipt and journal' : 'mark the attempt failed'}. No real money moves.`}
          confirmLabel="Send simulated callback"
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={() => run(() => simulateCallback(dialog.r.id, { eventId: `evt-${crypto.randomUUID()}`, outcome: dialog.outcome }))}
        />
      )}
      {dialog?.cancel && <ConfirmDialog title="Cancel attempt" message={`Cancel ${dialog.r.id}? Later callbacks will not be applied.`} confirmLabel="Cancel attempt" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => cancelAttempt(dialog.r.id))} />}
    </>
  );
}
