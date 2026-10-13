import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { Modal } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { SelectField, TextAreaField, TextField } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { Pagination } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { parseRupees } from '../../utils/money.js';
import { getReconQueue, importBankLines, listBankLines, matchPayment } from './financeService.js';

export default function ReconciliationPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('queue');
  const { params, setPage } = useListParams();
  const queue = useApi(useCallback((signal) => getReconQueue(params, signal), [params]));
  const lines = useApi(useCallback((signal) => listBankLines({ pageSize: 100 }, signal), []));
  const [match, setMatch] = useState(null);
  const reloadAll = () => { queue.reload(); lines.reload(); };

  return (
    <>
      <PageHeader title="Payment reconciliation" description="Match non-cash payments to bank statement lines. Differences are kept as visible exceptions." />
      <div className="mb-4"><Banner tone="info">No bank integration is connected. Statement lines are entered or pasted manually. Cash and simulated payments are not matched here.</Banner></div>
      <div className="mb-3 flex gap-1 border-b border-line">
        {[['queue', 'Reconciliation queue'], ['lines', 'Bank statement lines']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-muted'}`}>{label}</button>
        ))}
      </div>

      {tab === 'queue' && (
        <>
          <DataTable
            loading={queue.loading}
            error={queue.error}
            onRetry={queue.reload}
            rows={queue.data?.items}
            emptyTitle="Nothing to reconcile"
            emptyDescription="Non-cash payments appear here until matched to a bank statement line."
            columns={[
              { key: 'id', header: 'Payment', render: (r) => <Link className="text-brand-700 hover:underline" to={`/collections/payments/${r.id}`}>{r.id}</Link> },
              { key: 'customerName', header: 'Customer' },
              { key: 'mode', header: 'Mode', render: (r) => humanize(r.mode) },
              { key: 'reference', header: 'Reference' },
              { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
              { key: 'reconciliationStatus', header: 'State', render: (r) => <Status value={r.reconciliationStatus === 'PENDING' ? 'PENDING' : 'REJECTED'} /> },
              {
                key: 'a', header: '',
                render: (r) => (r.reconciliationStatus === 'PENDING' && can('reconcile:manage')
                  ? <Button onClick={() => setMatch(r)}>Match</Button>
                  : r.results[0] ? <span className="text-xs text-muted">Difference {formatPaise(r.results[0].differencePaise)}: {r.results[0].comment}</span> : null),
              },
            ]}
          />
          {queue.data && <Pagination page={queue.data.page} pageSize={queue.data.pageSize} total={queue.data.total} onPage={setPage} />}
        </>
      )}

      {tab === 'lines' && (
        <div className="space-y-5">
          {can('reconcile:manage') && <ImportForm onDone={reloadAll} />}
          <DataTable
            loading={lines.loading}
            error={lines.error}
            onRetry={lines.reload}
            rows={lines.data?.items}
            emptyTitle="No statement lines"
            columns={[
              { key: 'date', header: 'Date' },
              { key: 'reference', header: 'Reference' },
              { key: 'description', header: 'Description' },
              { key: 'amountPaise', header: 'Amount', render: (r) => formatPaise(r.amountPaise) },
              { key: 'status', header: 'Status', render: (r) => (r.paymentId ? `Matched to ${r.paymentId}` : 'Unmatched') },
            ]}
          />
        </div>
      )}

      {match && <MatchDialog payment={match} lines={(lines.data?.items ?? []).filter((l) => l.status === 'UNMATCHED')} onClose={() => setMatch(null)} onDone={() => { setMatch(null); reloadAll(); }} />}
    </>
  );
}

function ImportForm({ onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
      const [date, amount, reference, ...rest] = l.split(',').map((x) => x.trim());
      return { i, date, amountPaise: parseRupees(amount), reference, description: rest.join(', ') || undefined };
    });
    const bad = rows.find((r) => r.amountPaise === null || !r.date || !r.reference);
    if (bad) {
      setErr({ message: `Line ${bad.i + 1} is invalid. Use: date (YYYY-MM-DD), amount in rupees, reference, optional description.` });
      return;
    }
    setBusy(true);
    try {
      const r = await importBankLines({ lines: rows.map(({ i, ...x }) => x) });
      setMsg(`Added ${r.added} line(s).${r.skipped.length ? ` Skipped duplicates: ${r.skipped.join(', ')}.` : ''}`);
      setText('');
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Add statement lines">
      <form onSubmit={submit} className="space-y-3">
        {msg && <Banner tone="success">{msg}</Banner>}
        {err && <Banner tone="error">{err.message}</Banner>}
        <TextAreaField label="One line per entry: date, amount (₹), reference, description" value={text} onChange={(e) => setText(e.target.value)} placeholder="2026-12-01, 20000, UTR-77, Customer transfer" />
        <Button type="submit" disabled={busy || !text.trim()}>Add lines</Button>
      </form>
    </Card>
  );
}

function MatchDialog({ payment, lines, onClose, onDone }) {
  const [lineId, setLineId] = useState(payment.suggestion?.bankLineId ?? '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const line = lines.find((l) => l.id === lineId);
  const diff = line ? line.amountPaise - payment.amountPaise : 0;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await matchPayment({ paymentId: payment.id, bankLineId: lineId, comment: comment || undefined });
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Match ${payment.id} (${formatPaise(payment.amountPaise)})`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Banner tone="error">{err.details?.comment ?? err.message}</Banner>}
        <SelectField
          label="Bank statement line"
          required
          placeholder="Select a line"
          value={lineId}
          onChange={(e) => setLineId(e.target.value)}
          options={lines.map((l) => ({ value: l.id, label: `${l.date} · ${l.reference} · ${formatPaise(l.amountPaise)}` }))}
        />
        {line && diff !== 0 && <Banner tone="warning">Amounts differ by {formatPaise(diff)}. This will be recorded as an exception and needs a comment.</Banner>}
        {line && diff !== 0 && <TextField label="Comment" required value={comment} onChange={(e) => setComment(e.target.value)} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !lineId || (diff !== 0 && !comment.trim())}>{diff !== 0 ? 'Record exception' : 'Confirm match'}</Button>
        </div>
      </form>
    </Modal>
  );
}
