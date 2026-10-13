import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Status } from '../../components/common/Status.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextAreaField, TextField, useUnsavedWarning } from '../../components/forms/controls.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { Pagination } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDateTime, humanize } from '../../utils/labels.js';
import { createCase, getMyCase, getProfile, getSupportMeta, listMyCases, replyToCase } from './portalService.js';

export function Thread({ messages, staff }) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className={`rounded-card border p-3 text-sm ${m.internal ? 'border-amber-300 bg-amber-50' : m.authorType === 'STAFF' ? 'border-brand-100 bg-brand-50' : 'border-line bg-white'}`}>
          <p className="whitespace-pre-wrap">{m.body}</p>
          <p className="mt-1 text-xs text-muted">{m.authorName}{m.internal ? ' · internal note (not visible to the member)' : ''} · {formatDateTime(m.at)}</p>
        </li>
      ))}
      {messages.length === 0 && <li className="text-sm text-muted">{staff ? 'No messages.' : ''}</li>}
    </ol>
  );
}

export function PortalSupportList() {
  const navigate = useNavigate();
  const { params, setPage } = useListParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => listMyCases(params, signal), [params]));
  return (
    <>
      <PageHeader title="Support" description="Questions, complaints and requests." actions={<Button onClick={() => navigate('/portal/support/new')}>New request</Button>} />
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No requests yet"
        emptyDescription="Raise a request if you need help with a payment, auction, payout or your account."
        columns={[
          { key: 'id', header: 'Request', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/portal/support/${r.id}`}>{r.id}</Link> },
          { key: 'subject', header: 'Subject' },
          { key: 'category', header: 'Type', render: (r) => humanize(r.category) },
          { key: 'status', header: 'Status', render: (r) => <Status value={r.status === 'RESOLVED' ? 'DONE' : r.status === 'IN_PROGRESS' ? 'PENDING' : r.status === 'CLOSED' ? 'CANCELLED' : 'NEW'} label={humanize(r.status)} /> },
          { key: 'updatedAt', header: 'Updated', render: (r) => formatDateTime(r.updatedAt) },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}

export function PortalSupportNew() {
  const navigate = useNavigate();
  const meta = useApi(getSupportMeta);
  const [f, setF] = useState({ category: '', subject: '', description: '' });
  const [requestId] = useState(() => crypto.randomUUID());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useUnsavedWarning(dirty);
  if (meta.loading) return <LoadingState />;
  if (meta.error) return <ErrorState error={meta.error} />;
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};
  const set = (k) => (e) => { setDirty(true); setF((p) => ({ ...p, [k]: e.target.value })); };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createCase({ ...f, clientRequestId: requestId });
      setDirty(false);
      navigate(`/portal/support/${r.case.id}`, { replace: true });
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="New support request" description="Tell us what you need help with. Do not include passwords or card numbers." />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          {error && !error.details && <Banner tone="error">{error.message}</Banner>}
          <SelectField label="Type" required placeholder="Select type" value={f.category} onChange={set('category')} error={fe.category} options={meta.data.categories.map((c) => ({ value: c, label: humanize(c) }))} />
          <TextField label="Subject" required value={f.subject} onChange={set('subject')} error={fe.subject} hint="At least 5 characters" />
          <TextAreaField label="Details" required value={f.description} onChange={set('description')} error={fe.description} hint="At least 10 characters" />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => navigate('/portal/support')}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button></div>
        </form>
      </Card>
    </>
  );
}

export function PortalSupportCase() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(useCallback((signal) => getMyCase(id, signal), [id]));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await replyToCase(id, { body: text });
      setText('');
      reload();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={data.subject} description={`${data.id} · ${humanize(data.category)}`} />
      <div className="mb-4"><Status value={data.status === 'RESOLVED' ? 'DONE' : data.status === 'CLOSED' ? 'CANCELLED' : 'PENDING'} /> <span className="ml-2 text-sm">{humanize(data.status)}</span></div>
      <Thread messages={data.messages} />
      {data.status === 'CLOSED' ? <div className="mt-4"><Banner tone="info">This request is closed. Please raise a new request if you need more help.</Banner></div> : (
        <form onSubmit={send} className="mt-4 space-y-3">
          {data.status === 'RESOLVED' && <Banner tone="info">This request was marked resolved. Replying will reopen it.</Banner>}
          {err && <Banner tone="error">{err.message}</Banner>}
          <TextAreaField label="Reply" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" disabled={busy || !text.trim()}>Send reply</Button>
        </form>
      )}
    </>
  );
}

export function PortalProfile() {
  const { data, error, loading, reload } = useApi(getProfile);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="My profile" />
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Details">
          <dl className="space-y-1 text-sm">
            {[['Customer ID', data.id], ['Name', data.name], ['Mobile', data.phone], ['Email', data.email], ['Address', data.address], ['Branch', data.branch]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right">{v ?? '-'}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">To change your details, <Link className="underline" to="/portal/support/new">raise a support request</Link>. Staff verify changes first.</p>
        </Card>
        <Card title="KYC and membership">
          <p className="text-sm">KYC: <Status value={data.kyc.status} /> · Membership: <Status value={data.membershipStatus} /></p>
          <p className="mt-2 text-sm text-muted">{data.kyc.documentsOnFile} document(s) on file.</p>
          <p className="mt-2 text-xs text-muted">{data.kyc.notice}</p>
        </Card>
      </div>
    </>
  );
}
