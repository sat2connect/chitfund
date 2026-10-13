import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, EmptyState, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField, useUnsavedWarning } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { humanize } from '../../utils/labels.js';
import { localToIso } from '../../utils/time.js';
import { listGroups } from '../schemes/schemeService.js';
import { createAuction } from './auctionService.js';

const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const toBool = (v) => (v === 'yes' ? true : v === 'no' ? false : undefined);

export default function AuctionFormPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const groups = useApi(useCallback((signal) => listGroups({ status: 'ACTIVE', pageSize: 100 }, signal), []));
  const [f, setF] = useState({ groupId: '', cycleNo: '', open: '', close: '', winnerSelection: '', tieBreak: '', bidPolicy: '', excludePriorWinners: '', requireNoOverdue: '' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useUnsavedWarning(dirty);

  if (!can('auction:create')) return <Banner tone="error">You do not have permission to schedule auctions.</Banner>;
  if (groups.loading) return <LoadingState />;
  if (groups.error) return <ErrorState error={groups.error} />;
  if (groups.data.items.length === 0) return <EmptyState title="No active groups" description="An auction can only be scheduled for an active group." />;

  const set = (k) => (e) => { setDirty(true); setF((p) => ({ ...p, [k]: e.target.value })); };
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await createAuction({
        groupId: f.groupId, cycleNo: f.cycleNo === '' ? undefined : Number(f.cycleNo), scheduledOpenAt: localToIso(f.open), scheduledCloseAt: localToIso(f.close),
        winnerSelection: f.winnerSelection, tieBreak: f.tieBreak, bidPolicy: f.bidPolicy,
        excludePriorWinners: toBool(f.excludePriorWinners), requireNoOverdue: toBool(f.requireNoOverdue),
      });
      setDirty(false);
      navigate(`/auctions/${a.id}`, { replace: true });
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Schedule auction" description="Every rule below must be chosen explicitly, as set by the approved scheme terms. Nothing is assumed by the system." />
      <form onSubmit={submit} className="space-y-5">
        {error && !error.details && <Banner tone="error">{error.message}</Banner>}
        <Card title="Schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Group" required placeholder="Select active group" value={f.groupId} onChange={set('groupId')} error={fe.groupId} options={groups.data.items.map((g) => ({ value: g.id, label: `${g.code} - ${g.name}` }))} />
            <TextField label="Cycle number" required inputMode="numeric" value={f.cycleNo} onChange={set('cycleNo')} error={fe.cycleNo} />
            <TextField label="Opens at" type="datetime-local" required value={f.open} onChange={set('open')} error={fe.scheduledOpenAt} hint="Your local time; the server clock decides when bidding actually opens." />
            <TextField label="Closes at" type="datetime-local" required value={f.close} onChange={set('close')} error={fe.scheduledCloseAt} />
          </div>
        </Card>
        <Card title="Bidding rules">
          <p className="mb-3 text-sm text-muted">Bid limits and increments come from the scheme version. Winner selection, tie-breaking and the bid policy are not defined by the system and must be set here.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Winner selection" required placeholder="Select" value={f.winnerSelection} onChange={set('winnerSelection')} error={fe.winnerSelection} options={['HIGHEST_BID', 'LOWEST_BID'].map((v) => ({ value: v, label: humanize(v) }))} />
            <SelectField label="Tie-break" required placeholder="Select" value={f.tieBreak} onChange={set('tieBreak')} error={fe.tieBreak} options={[{ value: 'EARLIEST_BID', label: 'Earliest bid (server time)' }, { value: 'MANUAL', label: 'Manual decision by the auction officer' }]} />
            <SelectField label="Bids per ticket" required placeholder="Select" value={f.bidPolicy} onChange={set('bidPolicy')} error={fe.bidPolicy} options={[{ value: 'SINGLE', label: 'One bid only' }, { value: 'MULTIPLE', label: 'Multiple bids (best one counts)' }]} />
          </div>
        </Card>
        <Card title="Eligibility">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Exclude tickets that already won in this group?" required placeholder="Select" value={f.excludePriorWinners} onChange={set('excludePriorWinners')} error={fe.excludePriorWinners} options={YES_NO} />
            <SelectField label="Require no overdue instalments?" required placeholder="Select" value={f.requireNoOverdue} onChange={set('requireNoOverdue')} error={fe.requireNoOverdue} options={YES_NO} />
          </div>
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/auctions')}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Schedule auction'}</Button>
        </div>
      </form>
    </>
  );
}
