import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status, Timeline } from '../../components/common/Status.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { TextField } from '../../components/forms/controls.jsx';
import { Modal } from '../../components/common/overlay.jsx';
import { ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { createApplication, getCustomer } from './crmService.js';

export default function CustomerProfilePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const loader = useCallback((signal) => getCustomer(id, signal), [id]);
  const { data, error, loading, reload } = useApi(loader);
  const [open, setOpen] = useState(false);
  const [scheme, setScheme] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { customer: c, timeline, applications, kycCaseId } = data;
  const canApply = can('application:create') && c.kycStatus === 'VERIFIED' && c.membershipStatus === 'NONE';

  const apply = async (e) => {
    e.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createApplication({ customerId: c.id, preferredScheme: scheme });
      setOpen(false);
      setScheme('');
      reload();
    } catch (x) {
      setActionError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`${c.name} · ${c.id}`}
        description={`${c.phone}${c.email ? ` · ${c.email}` : ''} · Branch ${c.branchId}`}
        actions={canApply && <Button onClick={() => setOpen(true)}>Start membership application</Button>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Journey stage">
            <p className="text-sm"><Status value={c.lifecycleStage} /></p>
            <p className="mt-2 text-xs text-muted">KYC status and membership status are tracked separately.</p>
          </Card>
          <Card title="Activity timeline"><Timeline items={timeline} /></Card>
        </div>
        <div className="space-y-5">
          <Card title="KYC">
            <div className="flex items-center justify-between text-sm">
              <Status value={c.kycStatus} />
              {kycCaseId && can('kyc:view') && <Link className="text-brand-700 underline" to={`/kyc/cases/${kycCaseId}`}>Open KYC case</Link>}
            </div>
          </Card>
          <Card title="Membership">
            <p className="text-sm"><Status value={c.membershipStatus} /></p>
            <ul className="mt-3 space-y-2 text-sm">
              {applications.length === 0 && <li className="text-muted">No applications.</li>}
              {applications.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span>{a.id} · {a.preferredScheme}<br /><span className="text-xs text-muted">{formatDateTime(a.submittedAt)}</span></span>
                  <Status value={a.status} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Details">
            <dl className="space-y-1 text-sm">
              <div><dt className="inline text-muted">DOB: </dt><dd className="inline">{c.dob ?? '—'}</dd></div>
              <div><dt className="inline text-muted">Address: </dt><dd className="inline">{c.address ?? '—'}</dd></div>
              {c.leadId && <div><dt className="inline text-muted">Source lead: </dt><dd className="inline"><Link className="text-brand-700 underline" to={`/crm/leads/${c.leadId}`}>{c.leadId}</Link></dd></div>}
              <div><dt className="inline text-muted">Stage: </dt><dd className="inline">{humanize(c.lifecycleStage)}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
      {open && (
        <Modal title="Membership application" onClose={() => setOpen(false)}>
          <form onSubmit={apply} className="space-y-3">
            <p className="text-sm text-muted">Submits the application for central approval. You cannot approve your own submission.</p>
            <TextField label="Preferred scheme (free text)" required hint="Scheme catalogue arrives in a later phase" value={scheme} onChange={(e) => setScheme(e.target.value)} />
            {actionError && <p role="alert" className="text-sm text-red-700">{actionError.details?.preferredScheme ?? actionError.message}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !scheme.trim()}>{busy ? 'Submitting�' : 'Submit application'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

