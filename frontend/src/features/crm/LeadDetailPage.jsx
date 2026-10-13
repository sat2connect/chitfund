import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status, Timeline } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { SelectField, TextAreaField, TextField } from '../../components/forms/controls.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { addFollowUp, addLeadNote, completeFollowUp, convertLead, getLead, transitionLead } from './crmService.js';

export default function LeadDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const loader = useCallback((signal) => getLead(id, signal), [id]);
  const { data, error, loading, reload } = useApi(loader);
  const [dialog, setDialog] = useState(null); // { kind, to? }
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [dupMatches, setDupMatches] = useState(null);
  const navigate = useNavigate();

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { lead, allowedTransitions, canConvert, timeline, followUps } = data;
  const close = () => {
    setDialog(null);
    setActionError(null);
    setDupMatches(null);
  };

  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      close();
      reload();
    } catch (e) {
      if (e.code === 'DUPLICATE_WARNING') setDupMatches(e.details);
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`${lead.name} · ${lead.id}`}
        description={`${lead.phone} · ${lead.branchId} · Source: ${humanize(lead.source)}`}
        actions={
          <>
            {can('lead:edit') && allowedTransitions.map((t) => (
              <Button key={t} variant={t === 'LOST' ? 'secondary' : 'primary'} onClick={() => setDialog({ kind: 'transition', to: t })}>
                {t === 'LOST' ? 'Mark lost' : `Move to ${humanize(t)}`}
              </Button>
            ))}
            {can('lead:convert') && canConvert && <Button onClick={() => setDialog({ kind: 'convert' })}>Convert to customer</Button>}
          </>
        }
      />
      <div className="mb-4 flex items-center gap-3 text-sm">
        <Status value={lead.status} />
        {lead.lostReason && <span className="text-muted">Reason: {lead.lostReason}</span>}
        {lead.customerId && <Link className="text-brand-700 underline" to={`/crm/customers/${lead.customerId}`}>Customer {lead.customerId}</Link>}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {can('lead:edit') && <NoteForm leadId={id} onDone={reload} />}
          <Card title="Activity timeline"><Timeline items={timeline} /></Card>
        </div>
        <div className="space-y-5">
          <Card title="Follow-ups">
            {followUps.length === 0 && <p className="text-sm text-muted">No follow-ups scheduled.</p>}
            <ul className="space-y-2 text-sm">
              {followUps.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block">{f.note}</span>
                    <span className="text-xs text-muted">Due {formatDateTime(f.dueAt)}</span>
                  </span>
                  {f.status === 'OPEN' && can('followup:manage')
                    ? <Button variant="secondary" onClick={() => run(() => completeFollowUp(f.id))} disabled={busy}>Done</Button>
                    : <Status value={f.status} />}
                </li>
              ))}
            </ul>
            {can('followup:manage') && !['CONVERTED', 'LOST'].includes(lead.status) && <FollowUpForm leadId={id} onDone={reload} />}
          </Card>
        </div>
      </div>

      {dialog?.kind === 'transition' && (
        <ConfirmDialog
          title={dialog.to === 'LOST' ? 'Mark lead as lost' : `Move to ${humanize(dialog.to)}`}
          message={`Lead ${lead.id} will change from ${humanize(lead.status)} to ${humanize(dialog.to)}.`}
          commentLabel={dialog.to === 'LOST' ? 'Reason' : undefined}
          commentRequired
          confirmLabel="Confirm"
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={(reason) => run(() => transitionLead(id, { to: dialog.to, reason }))}
        />
      )}
      {dialog?.kind === 'convert' && (
        <ConfirmDialog
          title="Convert to customer"
          message={
            dupMatches
              ? `Possible duplicate: ${dupMatches.map((m) => `${m.type} ${m.id} (${m.name})`).join(', ')}. Convert anyway?`
              : 'This creates a customer record and an empty KYC case from this lead.'
          }
          confirmLabel={dupMatches ? 'Convert anyway' : 'Convert'}
          busy={busy}
          error={dupMatches ? null : actionError}
          onCancel={close}
          onConfirm={() =>
            run(async () => {
              const r = await convertLead(id, dupMatches ? { confirmDuplicate: true } : {});
              navigate(`/crm/customers/${r.customer.id}`);
            })
          }
        />
      )}
    </>
  );
}

function NoteForm({ leadId, onDone }) {
  const [type, setType] = useState('NOTE');
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await addLeadNote(leadId, { type, note });
      setNote('');
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Log contact">
      <form onSubmit={submit} className="space-y-3">
        {err && <Banner tone="error">{err.details?.note ?? err.message}</Banner>}
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={['NOTE', 'CALL', 'MEETING'].map((v) => ({ value: v, label: humanize(v) }))} />
        <TextAreaField label="Note" required value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" disabled={busy || !note.trim()}>Add to timeline</Button>
      </form>
    </Card>
  );
}

function FollowUpForm({ leadId, onDone }) {
  const [dueAt, setDueAt] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await addFollowUp(leadId, { dueAt, note });
      setDueAt('');
      setNote('');
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-3">
      {err && <Banner tone="error">{err.message}</Banner>}
      <TextField label="Due date" type="datetime-local" required value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      <TextField label="Follow-up note" required value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" disabled={busy || !dueAt || !note.trim()}>Schedule follow-up</Button>
    </form>
  );
}
