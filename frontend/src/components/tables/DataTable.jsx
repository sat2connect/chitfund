import { EmptyState, ErrorState, LoadingState } from '../feedback/States.jsx';

// Presentational table. Server-side search/sort/pagination will be wired by features (Phase 2+).
export function DataTable({ columns, rows, loading, error, onRetry, emptyTitle = 'No records', emptyDescription }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!rows?.length) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-3 py-2 font-medium">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2">{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
