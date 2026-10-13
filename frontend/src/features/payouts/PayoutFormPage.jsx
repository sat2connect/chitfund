import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { TextAreaField, TextField, useUnsavedWarning } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatPaise, paiseToRupees } from '../../utils/format.js';
import { parseRupees } from '../../utils/money.js';
import { createPayout, getAuction, getPayout, updatePayout } from '../auctions/auctionService.js';

/** Create a payout from an approved auction (?auctionId=) or edit a draft (/payouts/:id/edit). */
export default function PayoutFormPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const auctionId = sp.get('auctionId') ?? '';
  const payout = useApi(useCallback((signal) => (editing ? getPayout(id, signal) : Promise.resolve(null)), [editing, id]));
  const auction = useApi(useCallback((signal) => (!editing && auctionId ? getAuction(auctionId, signal) : Promise.resolve(null)), [editing, auctionId]));
  const [f, setF] = useState(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useUnsavedWarning(dirty);

  if (!can('payout:create')) return <Banner tone="error">You do not have permission to create payouts.</Banner>;
  if (payout.loading || auction.loading) return <LoadingState />;
  if (payout.error || auction.error) return <ErrorState error={payout.error ?? auction.error} />;
  if (!editing && !auctionId) return <Banner tone="info">Open an approved auction and choose “Create payout”.</Banner>;
  if (editing && !payout.data.actions.canEdit) return <Banner tone="warning">Only the creator can edit a draft payout.</Banner>;

  const form = f ?? { amount: editing ? paiseToRupees(payout.data.amountPaise) : '', basis: editing ? payout.data.amountBasis : '' };
  const paise = parseRupees(form.amount);
  const a = auction.data;
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};
  const set = (k) => (e) => { setDirty(true); setF({ ...form, [k]: e.target.value }); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { amountPaise: paise, amountBasis: form.basis };
      const p = editing ? await updatePayout(id, body) : (await createPayout({ ...body, auctionId, clientRequestId: requestId })).payout;
      setDirty(false);
      navigate(`/payouts/${p.id}`, { replace: true });
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={editing ? `Edit draft ${id}` : 'Create payout'} description={editing ? undefined : `For auction ${auctionId}`} />
      {a && a.result && <div className="mb-4"><Banner tone="info">Winning ticket #{a.result.winnerTicketNo} with a bid of {formatPaise(a.result.winningAmountPaise)}. The prize amount is <strong>not</strong> derived from the bid by this system: enter the amount approved in the company's calculation.</Banner></div>}
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          {error && !error.details && <Banner tone="error">{error.message}</Banner>}
          <TextField label="Payout amount (₹)" required inputMode="decimal" value={form.amount} onChange={set('amount')}
            error={fe.amountPaise ?? (form.amount && paise === null ? 'Enter a valid amount with up to 2 decimals' : undefined)} hint="Entered manually. Cannot exceed the chit value." />
          <TextAreaField label="Basis of amount" required value={form.basis} onChange={set('basis')} error={fe.amountBasis} hint="Reference to the approved calculation document or sheet (min. 10 characters)." />
          <div className="flex justify-end gap-2">
            <Link to="/payouts"><Button type="button" variant="secondary">Cancel</Button></Link>
            <Button type="submit" disabled={busy || paise === null || paise < 1 || form.basis.trim().length < 10}>{busy ? 'Saving…' : editing ? 'Save draft' : 'Create payout'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
