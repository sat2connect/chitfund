export function LoadingState({ label = 'Loading…' }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, children }) {
  return (
    <div className="rounded-card border border-dashed border-slate-300 bg-white p-8 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">{error?.message ?? 'Unexpected error'}</p>
      {error?.requestId && <p className="mt-1 text-xs text-red-700">Request ID: {error.requestId}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  );
}

const tones = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
};

export function Banner({ tone = 'info', children }) {
  return <div className={`rounded-card border px-4 py-2.5 text-sm ${tones[tone]}`}>{children}</div>;
}
