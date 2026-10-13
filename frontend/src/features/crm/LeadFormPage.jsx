import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { SelectField, TextField, useUnsavedWarning } from '../../components/forms/controls.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { humanize } from '../../utils/labels.js';
import { createLead, getMeta } from './crmService.js';
import { DuplicateWarning } from './shared.jsx';

const empty = { name: '', phone: '', email: '', source: '', branchId: '', interestedScheme: '' };

export default function LeadFormPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const { data: meta, error: metaError, loading } = useApi(getMeta);
  const [form, setForm] = useState({ ...empty, branchId: user?.branchIds?.length === 1 ? user.branchIds[0] : '' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dups, setDups] = useState(null);
  useUnsavedWarning(dirty);

  if (!can('lead:create')) return <Banner tone="error">You do not have permission to create leads.</Banner>;
  if (loading) return <LoadingState />;
  if (metaError) return <ErrorState error={metaError} />;

  const change = (k) => (e) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const fieldErr = error?.details && !Array.isArray(error.details) ? error.details : {};
  const branches = user.branchIds === 'ALL' ? meta.branches : meta.branches.filter((b) => user.branchIds.includes(b.id));

  const submit = async (confirmDuplicate = false) => {
    setBusy(true);
    setError(null);
    try {
      const lead = await createLead({ ...form, confirmDuplicate });
      setDirty(false);
      navigate(`/crm/leads/${lead.id}`, { replace: true });
    } catch (e) {
      if (e.code === 'DUPLICATE_WARNING') setDups(e.details);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Create lead" description="Record a new prospect." />
      <Card className="max-w-2xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setDups(null);
            submit(false);
          }}
        >
          {error && !error.details && <Banner tone="error">{error.message}</Banner>}
          {dups && <DuplicateWarning matches={dups} busy={busy} onConfirm={() => submit(true)} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Full name" required value={form.name} onChange={change('name')} error={fieldErr.name} />
            <TextField label="Mobile number" required value={form.phone} onChange={change('phone')} error={fieldErr.phone} hint="10-digit Indian mobile number" inputMode="numeric" maxLength={10} />
            <TextField label="Email" type="email" value={form.email} onChange={change('email')} error={fieldErr.email} />
            <SelectField label="Lead source" required placeholder="Select source" value={form.source} onChange={change('source')} error={fieldErr.source} options={meta.leadSources.map((s) => ({ value: s, label: humanize(s) }))} />
            <SelectField label="Branch" required placeholder="Select branch" value={form.branchId} onChange={change('branchId')} error={fieldErr.branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            <TextField label="Interested scheme (free text)" value={form.interestedScheme} onChange={change('interestedScheme')} error={fieldErr.interestedScheme} hint="Scheme catalogue arrives in a later phase" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate('/crm')}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create lead'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
