import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { ConfirmDialog } from '../../components/common/overlay.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { SelectField, TextField } from '../../components/forms/controls.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { addKycDocument, decideKyc, getKyc, submitKyc } from './kycService.js';

const DOC_TYPES = ['IDENTITY_PROOF', 'ADDRESS_PROOF', 'PHOTO', 'OTHER'];

export default function KycCasePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const loader = useCallback((signal) => getKyc(id, signal), [id]);
  const { data: k, error, loading, reload } = useApi(loader);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !k) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const close = () => {
    setDialog(null);
    setActionError(null);
  };
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
  const editable = ['NOT_STARTED', 'DOCUMENTS_PENDING', 'CORRECTION_REQUIRED'].includes(k.status);
  const canSubmit = can('kyc:submit') && ['DOCUMENTS_PENDING', 'CORRECTION_REQUIRED'].includes(k.status) && k.missingDocuments.length === 0;

  return (
    <>
      <PageHeader
        title={`KYC ${k.id} · ${k.customerName}`}
        description={`Customer ${k.customerId} · Branch ${k.branchId}`}
        actions={
          <>
            {canSubmit && <Button onClick={() => setDialog({ kind: 'submit' })}>Submit for review</Button>}
            {can('kyc:decide') && k.status === 'UNDER_REVIEW' && (
              <>
                <Button onClick={() => setDialog({ kind: 'decide', decision: 'VERIFIED' })}>Verify</Button>
                <Button variant="secondary" onClick={() => setDialog({ kind: 'decide', decision: 'CORRECTION_REQUIRED' })}>Request correction</Button>
                <Button variant="secondary" onClick={() => setDialog({ kind: 'decide', decision: 'REJECTED' })}>Reject</Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Status value={k.status} />
        <Link className="text-brand-700 underline" to={`/crm/customers/${k.customerId}`}>Customer profile</Link>
      </div>
      <Banner tone="info">{k.storageNotice}</Banner>

      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Documents">
            {k.missingDocuments.length > 0 && (
              <p className="mb-3 text-sm text-amber-800">Required and missing: {k.missingDocuments.map(humanize).join(', ')}</p>
            )}
            {k.documents === null ? (
              <p className="text-sm text-muted">{k.documentCount} document(s) on file. Your role does not have access to document details.</p>
            ) : (
              <DataTable
                rows={k.documents}
                emptyTitle="No documents recorded"
                columns={[
                  { key: 'type', header: 'Type', render: (d) => humanize(d.type) },
                  { key: 'fileName', header: 'File' },
                  { key: 'version', header: 'Ver.', render: (d) => `v${d.version}` },
                  { key: 'active', header: 'State', render: (d) => (d.active ? 'Current' : 'Superseded') },
                  { key: 'uploadedBy', header: 'Recorded by', render: (d) => `${d.uploadedByName} · ${formatDateTime(d.uploadedAt)}` },
                ]}
              />
            )}
            {can('kyc:submit') && editable && <DocumentForm kycId={id} onDone={reload} />}
          </Card>
        </div>
        <Card title="Decision history">
          {k.history.length === 0 ? <p className="text-sm text-muted">No decisions yet.</p> : (
            <ol className="space-y-3 text-sm">
              {[...k.history].reverse().map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3">
                  <p>{humanize(h.from)} → <strong>{humanize(h.to)}</strong></p>
                  {h.comment && <p className="text-muted">“{h.comment}”</p>}
                  <p className="text-xs text-muted">{h.actorName} · {formatDateTime(h.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {dialog?.kind === 'submit' && (
        <ConfirmDialog title="Submit for review" message="The case will be locked for manual review by a KYC officer." confirmLabel="Submit" busy={busy} error={actionError} onCancel={close} onConfirm={() => run(() => submitKyc(id))} />
      )}
      {dialog?.kind === 'decide' && (
        <ConfirmDialog
          title={`${humanize(dialog.decision)} KYC`}
          message="This decision is recorded with your identity and time, and cannot be edited."
          commentLabel="Comment"
          commentRequired={dialog.decision !== 'VERIFIED'}
          confirmLabel="Record decision"
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={(comment) => run(() => decideKyc(id, { decision: dialog.decision, comment }))}
        />
      )}
    </>
  );
}

function DocumentForm({ kycId, onDone }) {
  const [type, setType] = useState('');
  const [fileName, setFileName] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await addKycDocument(kycId, { type, fileName, note });
      setType('');
      setFileName('');
      setNote('');
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const fe = err?.details ?? {};
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Record a document</h3>
      {err && !err.details && <Banner tone="error">{err.message}</Banner>}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Document type" required placeholder="Select type" value={type} onChange={(e) => setType(e.target.value)} error={fe.type} options={DOC_TYPES.map((v) => ({ value: v, label: humanize(v) }))} />
        <TextField label="File name" required value={fileName} onChange={(e) => setFileName(e.target.value)} error={fe.fileName} hint="Metadata only; no file is uploaded yet" />
      </div>
      <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" disabled={busy || !type || !fileName.trim()}>Record document</Button>
    </form>
  );
}
