import { NavLink } from 'react-router-dom';

export default function SubNav({ items }) {
  return (
    <nav aria-label="Section" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end
          className={({ isActive }) =>
            `whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              isActive ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-muted hover:text-ink'
            }`
          }
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
