import { useCallback } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { Status } from '../../components/common/Status.jsx';
import { Button, PageHeader } from '../../components/common/ui.jsx';
import SubNav from '../../components/navigation/SubNav.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { FilterSelect, Pagination, SearchBox } from '../../components/tables/ListToolbar.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatPaise } from '../../utils/format.js';
import { humanize } from '../../utils/labels.js';
import { listSchemes } from './schemeService.js';

const STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED', 'REJECTED'];

export function SchemesLayout() {
  const { can } = useAuth();
  return (
    <>
      <SubNav
        items={[
          ...(can('scheme:view') ? [{ to: '/schemes', label: 'Scheme catalogue' }] : []),
          ...(can('group:view') ? [{ to: '/schemes/groups', label: 'Chit groups' }] : []),
        ]}
      />
      <Outlet />
    </>
  );
}

export default function SchemesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { params, set, setPage } = useListParams();
  const loader = useCallback((signal) => listSchemes(params, signal), [params]);
  const { data, error, loading, reload } = useApi(loader);
  return (
    <>
      <PageHeader
        title="Scheme catalogue"
        description="Versioned scheme configurations. Only published versions can be used for new groups."
        actions={can('scheme:create') && <Button onClick={() => navigate('/schemes/new')}>Create scheme</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search code or name" />
        <FilterSelect label="Latest version" value={params.status} onChange={(status) => set({ status })} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <DataTable
        loading={loading}
        error={error}
        onRetry={reload}
        rows={data?.items}
        emptyTitle="No schemes found"
        emptyDescription="Create a scheme and submit it for approval."
        columns={[
          { key: 'code', header: 'Code', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/schemes/${r.id}`}>{r.code}</Link> },
          { key: 'name', header: 'Name' },
          { key: 'chitValuePaise', header: 'Chit value', render: (r) => formatPaise(r.chitValuePaise) },
          { key: 'installmentAmountPaise', header: 'Instalment', render: (r) => formatPaise(r.installmentAmountPaise) },
          { key: 'memberCount', header: 'Members' },
          { key: 'latestVersion', header: 'Latest version', render: (r) => <span className="flex items-center gap-2">v{r.latestVersion.version} <Status value={r.latestVersion.status} /></span> },
          { key: 'publishedVersion', header: 'Published', render: (r) => (r.publishedVersion ? `v${r.publishedVersion.version}` : '—') },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
