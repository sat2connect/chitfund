import { humanize, toneOf } from '../../utils/labels.js';
import { StatusBadge } from './ui.jsx';

export const Status = ({ value, label }) => <StatusBadge tone={toneOf(value)}>{label ?? humanize(value)}</StatusBadge>;

export function Timeline({ items }) {
  if (!items?.length) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="border-l-2 border-line pl-3 text-sm">
          <p>{a.note}</p>
          <p className="text-xs text-muted">{humanize(a.type)} · {a.actorName} · {new Date(a.at).toLocaleString('en-IN')}</p>
        </li>
      ))}
    </ol>
  );
}
