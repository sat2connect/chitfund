import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { PageHeader } from '../../components/common/ui.jsx';
import { Banner, ErrorState, LoadingState } from '../../components/feedback/States.jsx';
import { useUnsavedWarning } from '../../components/forms/controls.jsx';
import { useApi } from '../../hooks/useApi.js';
import SchemeConfigForm, { configFromForm, emptyForm, formFromConfig } from './SchemeConfigForm.jsx';
import { createScheme, getScheme, getSchemeMeta, updateSchemeVersion } from './schemeService.js';

/** Create a scheme (no :versionId) or edit a draft version (/schemes/:schemeId/versions/:versionId/edit). */
export default function SchemeFormPage() {
  const { schemeId, versionId } = useParams();
  const editing = Boolean(versionId);
  const { can } = useAuth();
  const navigate = useNavigate();
  const metaApi = useApi(getSchemeMeta);
  const loader = useCallback((signal) => (editing ? getScheme(schemeId, signal) : Promise.resolve(null)), [editing, schemeId]);
  const schemeApi = useApi(loader);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  useUnsavedWarning(dirty);

  if (!can(editing ? 'scheme:edit' : 'scheme:create')) return <Banner tone="error">You do not have permission for this action.</Banner>;
  if (metaApi.loading || schemeApi.loading) return <LoadingState />;
  if (metaApi.error || schemeApi.error) return <ErrorState error={metaApi.error ?? schemeApi.error} />;

  const version = editing ? schemeApi.data.versions.find((v) => v.id === versionId) : null;
  if (editing && (!version || !version.actions.canEdit)) return <Banner tone="warning">This version is read-only. Only draft versions can be edited.</Banner>;
  const initial = editing ? { ...formFromConfig(version.config), code: schemeApi.data.scheme.code } : emptyForm;

  const submit = async (f) => {
    setBusy(true);
    setError(null);
    try {
      const config = configFromForm(f);
      const r = editing ? await updateSchemeVersion(versionId, { config }) : await createScheme({ code: f.code, config });
      setDirty(false);
      setWarnings(r.warnings);
      navigate(`/schemes/${editing ? schemeId : r.scheme.id}`, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={editing ? `Edit draft v${version.version}` : 'Create scheme'}
        description="Approved versions are never edited in place. Changes to approved terms need a new version and approval."
      />
      {error && !error.details && <Banner tone="error">{error.message}</Banner>}
      {error?.details && <div className="mb-3"><Banner tone="error">Please correct the highlighted fields.</Banner></div>}
      {warnings.length > 0 && <Banner tone="warning">{warnings.join(' ')}</Banner>}
      <SchemeConfigForm
        meta={metaApi.data}
        initial={initial}
        withCode={!editing}
        submitLabel={editing ? 'Save draft' : 'Create scheme'}
        busy={busy}
        errors={error?.details && !Array.isArray(error.details) ? error.details : {}}
        onSubmit={submit}
        onCancel={() => navigate(editing ? `/schemes/${schemeId}` : '/schemes')}
        onDirty={() => setDirty(true)}
      />
    </>
  );
}
