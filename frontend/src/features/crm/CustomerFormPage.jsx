import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Button, Card, PageHeader } from '../../components/common/ui.jsx';
import { SelectField, TextAreaField, TextField, useUnsavedWarning } from '../../components/forms/controls.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useApi } from '../../hooks/useApi.js';
import { createCustomer, getMeta } from './crmService.js';
import { DuplicateWarning } from './shared.jsx';

export default function CustomerFormPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const { data: meta, error: metaError, loading } = useApi(getMeta);
  const [form, setForm] = useState({ name: '', phone: '', email: '', dob: '', address: '', branchId: user?.branchIds?.length === 1 ? user.branchIds[0] : '' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dups, setDups] = useState(null);
  useUnsavedWarning(dirty);

  if (!can('customer:create')) return <Banner tone="error">You do not have permission to register customers.</Banner>;
  if (loading) return <LoadingState />;
  if (metaError) return <ErrorState error={metaError} />;

  const change = (k) => (e) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const fe = error?.details && !Array.isArray(error.details) ? error.details : {};
  const branches = user.branchIds === 'ALL' ? meta.branches : meta.branches.filter((b) => user.branchIds.includes(b.id));

  const submit = async (confirmDuplicate = false) => {
    setBusy(true);
    setError(null);
    try {
      const c = await createCustomer({ ...form, confirmDuplicate });
      setDirty(false);
      navigate(`/crm/customers/${c.id}`, { replace: true });
    } catch (e) {
      if (e.code === 'DUPLICATE_WARNING') setDups(e.details);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Register customer" description="Staff-assisted registration. KYC is started separately." />
      <Card className="max-w-2xl">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setDups(null); submit(false); }}>
          {error && !error.details && <Banner tone="error">{error.message}</Banner>}
          {dups && <DuplicateWarning matches={dups} busy={busy} onConfirm={() => submit(true)} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Full name" required value={form.name} onChange={change('name')} error={fe.name} />
            <TextField label="Mobile number" required value={form.phone} onChange={change('phone')} error={fe.phone} inputMode="numeric" maxLength={10} />
            <TextField label="Email" type="email" value={form.email} onChange={change('email')} error={fe.email} />
            <TextField label="Date of birth" type="date" value={form.dob} onChange={change('dob')} error={fe.dob} />
            <SelectField label="Branch" required placeholder="Select branch" value={form.branchId} onChange={change('branchId')} error={fe.branchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          </div>
          <TextAreaField label="Address" value={form.address} onChange={change('address')} error={fe.address} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate('/crm/customers')}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Register customer'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
