import { useEffect, useState } from 'react';

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => {
    const t = setTimeout(() => text !== (value ?? '') && onChange(text), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="search"
      aria-label="Search"
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm sm:w-64"
    />
  );
}

export function FilterSelect({ label, value, onChange, options }) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-line bg-white px-3 py-2 text-sm">
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted">
      <span>{total} record{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <button className="rounded border border-line bg-white px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="rounded border border-line bg-white px-2 py-1 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
