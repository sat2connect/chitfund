import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { parseRupees } from '../../utils/money.js';
import { listCustomers } from '../crm/crmService.js';
import { SimulatedBadge } from './CollectionsLayout.jsx';
import { getPaymentMeta, initiateOnline, listInstalments, recordOffline } from './financeService.js';

export default function CollectPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const customerId = sp.get('customerId') ?? '';
  const customers = useApi(useCallback((signal) => listCustomers({ pageSize: 100 }, signal), []));
  const meta = useApi(getPaymentMeta);
  const dues = useApi(useCallback((signal) => (customerId ? listInstalments({ customerId, pageSize: 100 }, signal) : Promise.resolve(null)), [customerId]));

  if (customers.loading || meta.loading) return <LoadingState />;
  if (customers.error || meta.error) return <ErrorState error={customers.error ?? meta.error} />;

  const payable = (dues.data?.items ?? []).filter((i) => i.status !== 'SCHEDULED' && i.outstandingPaise > 0);
  return (
    <>
      <PageHeader title="Collect payment" description="Record a payment received by staff, or start a simulated online payment. Only instalments that have fallen due can be paid." />
      <Card className="mb-5">
        <div className="max-w-md">
          <SelectField
            label="Customer"
            required
            placeholder="Select customer"
            value={customerId}
            onChange={(e) => setSp(e.target.value ? { customerId: e.target.value } : {})}
            options={customers.data.items.map((c) => ({ value: c.id, label: `${c.name} (${c.id})` }))}
          />
        </div>
      </Card>
      {customerId && dues.loading && <LoadingState />}
      {dues.error && <ErrorState error={dues.error} onRetry={dues.reload} />}
      {customerId && dues.data && (
        payable.length === 0
          ? <Banner tone="info">This customer has no instalments due for payment.</Banner>
          : (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Payable dues">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1">Group</th><th>Due</th><th>Outstanding</th><th>Status</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {payable.map((i) => (
                      <tr key={i.id}><td className="py-1.5">{i.groupCode} #{i.ticketNo} · {i.seq}</td><td>{i.dueDate}</td><td>{formatPaise(i.outstandingPaise)}</td><td><Status value={i.status} /></td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-sm">Total outstanding: <strong>{formatPaise(payable.reduce((a, i) => a + i.outstandingPaise, 0))}</strong></p>
                <p className="mt-1 text-xs text-muted">Payments are applied to the oldest due instalment first (placeholder policy pending approved rules).</p>
              </Card>
              <div className="space-y-5">
                {can('collection:record') && <OfflineForm customerId={customerId} modes={meta.data.modes} today={meta.data.today} onDone={dues.reload} />}
                {can('payment:initiate') && <OnlineForm customerId={customerId} onDone={dues.reload} />}
              </div>
            </div>
          )
      )}
    </>
  );
}

function OfflineForm({ customerId, modes, today, onDone }) {
  const [f, setF] = useState({ mode: 'CASH', amount: '', reference: '', receivedDate: today });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dups, setDups] = useState(null);
  const [done, setDone] = useState(null);
  const paise = useMemo(() => parseRupees(f.amount), [f.amount]);
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (confirmDuplicate = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await recordOffline({ customerId, mode: f.mode, amountPaise: paise, reference: f.reference || undefined, receivedDate: f.receivedDate, clientRequestId: requestId, confirmDuplicate });
      setDone(r);
      setRequestId(crypto.randomUUID());
      setF((p) => ({ ...p, amount: '', reference: '' }));
      setDups(null);
      setConfirm(false);
      onDone();
    } catch (e) {
      setConfirm(false);
      if (e.code === 'DUPLICATE_WARNING') setDups(e.details);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Record payment received by staff">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setDone(null); setDups(null); setConfirm(true); }}>
        {done && <Banner tone="success">{done.duplicate ? 'Already recorded: ' : 'Recorded: '}receipt {done.payment.receiptId} · <Link className="underline" to={`/collections/payments/${done.payment.id}`}>view payment</Link></Banner>}
        {error && !error.details && <Banner tone="error">{error.message}{error.details?.outstandingPaise !== undefined && ` (outstanding ${formatPaise(error.details.outstandingPaise)})`}</Banner>}
        {dups && <Banner tone="warning"><p>Possible duplicate: a similar cash payment already exists ({dups.map((d) => d.receiptId).join(', ')}).</p><Button className="mt-2" variant="secondary" disabled={busy} onClick={() => submit(true)}>Record anyway</Button></Banner>}
        <SelectField label="Payment mode" required value={f.mode} onChange={set('mode')} error={fe.mode} options={modes.map((m) => ({ value: m, label: humanize(m) }))} />
        <TextField label="Amount (₹)" required inputMode="decimal" value={f.amount} onChange={set('amount')} error={fe.amountPaise ?? (f.amount && paise === null ? 'Enter a valid amount with up to 2 decimals' : undefined)} />
        <TextField label={f.mode === 'CASH' ? 'Reference (optional)' : 'Reference (UTR / cheque no.)'} required={f.mode !== 'CASH'} value={f.reference} onChange={set('reference')} error={fe.reference} />
        <TextField label="Received date" type="date" required value={f.receivedDate} max={today} onChange={set('receivedDate')} error={fe.receivedDate} />
        <Button type="submit" disabled={busy || paise === null || paise < 1}>Review and record</Button>
      </form>
      {confirm && (
        <ConfirmDialog
          title="Confirm collection"
          message={`Record ${formatPaise(paise)} via ${humanize(f.mode)}${f.reference ? ` (ref ${f.reference})` : ''}. A receipt is issued and the amount posts to accounts immediately.`}
          confirmLabel="Record payment"
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => submit(false)}
        />
      )}
    </Card>
  );
}

function OnlineForm({ customerId, onDone }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const paise = parseRupees(amount);
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await initiateOnline({ customerId, amountPaise: paise }));
      setAmount('');
      onDone();
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={<span className="flex items-center gap-2">Online payment <SimulatedBadge /></span>}>
      <p className="mb-3 text-sm text-muted">No payment gateway is connected. This creates a simulated attempt; no money moves. It only becomes a payment when the (simulated) provider callback arrives, never from this page.</p>
      <form onSubmit={start} className="space-y-3">
        {created && <Banner tone="info">Attempt {created.id} is awaiting confirmation. <Link className="underline" to="/collections/attempts">Open online attempts</Link></Banner>}
        {error && <Banner tone="error">{error.message}</Banner>}
        <TextField label="Amount (₹)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={busy || paise === null || paise < 1}>Start simulated online payment</Button>
      </form>
    </Card>
  );
}
