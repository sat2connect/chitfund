import { Outlet } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import SubNav from '../../components/navigation/SubNav.jsx';

export default function AdminLayout() {
  const { can } = useAuth();
  const items = [
    ...(can('audit:view') ? [{ to: '/admin', label: 'Audit log' }] : []),
    ...(can('user:view') ? [{ to: '/admin/users', label: 'Users and access' }] : []),
  ];
  return (
    <>
      <SubNav items={items} />
      <Outlet />
    </>
  );
}