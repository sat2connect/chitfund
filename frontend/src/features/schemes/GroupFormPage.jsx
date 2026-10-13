import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { Banner, EmptyState, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { SelectField, TextField, useUnsavedWarning } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import { getMeta } from '../crm/crmService.js';
import { createGroup, listPublishedVersions } from './schemeService.js';

export default function GroupFormPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const versions = useApi(listPublishedVersions);
  const meta = useApi(getMeta);
  const [form, setForm] = useState({ code: '', name: '', schemeVersionId: '', branchId: user?.branchIds?.length === 1 ? user.branchIds[0] : '', plannedStartDate: '' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useUnsavedWarning(dirty);

  if (!can('group:create')) return <Banner tone="error">You do not have permission to create groups.</Banner>;
  if (versions.loading || meta.loading) return <LoadingState />;
  if (versions.error || meta.error) return <ErrorState error={versions.error ?? meta.error} />;
  if (versions.data.items.length === 0) {
    return <EmptyState title="No published schemes" description="A group can only be created from a published scheme version. Publish an approved scheme first." />;
  }

  const change = (k) => (e) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};
  const branches = user.branchIds === 'ALL' ? meta.data.branches : meta.data.branches.filter((b) => user.branchIds.includes(b.id));
  const chosen = versions.data.items.find((v) => v.id === form.schemeVersionId);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const g = await createGroup(form);
      setDirty(false);
      navigate(`/schemes/groups/${g.id}`, { replace: true });
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Create group" description="The group is pinned to the scheme version you choose and starts as a draft." />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          {error && !error.details && <Banner tone="error">{error.message}</Banner>}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Group code" required value={form.code} onChange={change('code')} error={fe.code} hint="3–20 capital letters, digits or hyphens" />
            <TextField label="Group name" required value={form.name} onChange={change('name')} error={fe.name} />
            <SelectField label="Scheme version" required placeholder="Select published version" value={form.schemeVersionId} onChange={change('schemeVersionId')} error={fe.schemeVersionId} options={versions.data.items.map((v) => ({ value: v.id, label: v.label }))} />
            <SelectField label="Branch" required placeholder="Select branch" value={form.branchId} onChange={change('branchId')} error={fe.branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            <TextField label="Planned start date" type="date" required value={form.plannedStartDate} onChange={change('plannedStartDate')} error={fe.plannedStartDate}
              hint={chosen ? `Scheme effective ${chosen.config.effectiveFrom} to ${chosen.config.effectiveTo ?? 'open'}` : undefined} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate('/schemes/groups')}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create group'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
