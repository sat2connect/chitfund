import { useCallback, useState } from 'react';
import { PageHeader } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';
import { DataTable } from '../../components/tables/DataTable.jsx';
import { Pagination } from '../../components/tables/ListToolbar.jsx';
import { useAuth } from '../../app/AuthContext.jsx';
import { useApi } from '../../hooks/useApi.js';
import { apiRequest, toQuery } from '../../services/apiClient.js';
import { formatDateTime } from '../../utils/labels.js';

export default function AuditLogsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const loader = useCallback((signal) => (can('audit:view') ? apiRequest(`/audit-logs${toQuery({ page, pageSize: 15 })}`, { signal }) : Promise.resolve(null)), [page, can]);
  const { data, error, loading, reload } = useApi(loader);
  return (
    <>
      <PageHeader title="Administration · Audit log" description="Sensitive changes recorded by the system." />
      <Banner tone="info">Other administration screens (branches, users, roles, policies) are scheduled for later phases. Audit data is held in memory and resets when the server restarts.</Banner>
      <div className="mt-4">
        {!can('audit:view') ? (
          <Banner tone="error">You do not have permission to view the audit log.</Banner>
        ) : (
          <>
            <DataTable
              loading={loading}
              error={error}
              onRetry={reload}
              rows={data?.items}
              emptyTitle="No audit events yet"
              columns={[
                { key: 'at', header: 'Time', render: (r) => formatDateTime(r.at) },
                { key: 'actorName', header: 'Actor' },
                { key: 'action', header: 'Action' },
                { key: 'entity', header: 'Entity', render: (r) => `${r.entityType} ${r.entityId}` },
                { key: 'detail', header: 'Detail', render: (r) => (r.detail ? <code className="text-xs">{JSON.stringify(r.detail)}</code> : '—') },
              ]}
            />
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </div>
    </>
  );
}
