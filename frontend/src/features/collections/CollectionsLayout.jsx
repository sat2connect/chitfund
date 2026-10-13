import { Outlet } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { StatusBadge } from '../../components/common/ui.jsx';
import SubNav from '../../components/navigation/SubNav.jsx';

export function CollectionsLayout() {
  const { can } = useAuth();
  const items = [
    { to: '/collections', label: 'Dues', show: can('instalment:view') },
    { to: '/collections/collect', label: 'Collect payment', show: can('collection:record') || can('payment:initiate') },
    { to: '/collections/payments', label: 'Payments', show: can('payment:view') },
    { to: '/collections/attempts', label: 'Online attempts', show: can('payment:view') },
    { to: '/collections/arrears', label: 'Arrears', show: can('instalment:view') },
    { to: '/collections/reconciliation', label: 'Reconciliation', show: can('reconcile:view') },
  ].filter((i) => i.show);
  return (
    <>
      <SubNav items={items} />
      <Outlet />
    </>
  );
}

export const SimulatedBadge = () => <StatusBadge tone="warning">Simulated</StatusBadge>;
