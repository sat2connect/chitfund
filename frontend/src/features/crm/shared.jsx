import { Banner } from '../../components/feedback/States.jsx';
import { Button } from '../../components/common/ui.jsx';
import { Link } from 'react-router-dom';
import SubNav from '../../components/navigation/SubNav.jsx';
import { Outlet } from 'react-router-dom';

export function CrmLayout() {
  return (
    <>
      <SubNav
        items={[
          { to: '/crm', label: 'Leads' },
          { to: '/crm/follow-ups', label: 'Follow-ups' },
          { to: '/crm/customers', label: 'Customers' },
        ]}
      />
      <Outlet />
    </>
  );
}

const typeLabel = { lead: 'Lead', customer: 'Customer' };

/** Shown when the backend returns DUPLICATE_WARNING (409); lets the user explicitly confirm. */
export function DuplicateWarning({ matches, onConfirm, busy }) {
  return (
    <Banner tone="warning">
      <p className="font-medium">Possible duplicate found</p>
      <ul className="mt-1 list-disc pl-5">
        {matches.map((m) => (
          <li key={m.id}>
            {typeLabel[m.type]} {m.id} — {m.name}{' '}
            <Link className="underline" to={m.type === 'lead' ? `/crm/leads/${m.id}` : `/crm/customers/${m.id}`} target="_blank">view</Link>
          </li>
        ))}
      </ul>
      <Button className="mt-2" variant="secondary" onClick={onConfirm} disabled={busy}>Create anyway</Button>
    </Banner>
  );
}
