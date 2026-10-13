import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

const devUsers = [
  { id: 'u-crm', name: 'CRM User', roles: ['CRM_EXEC'], branchIds: ['CHN'] },
  { id: 'u-audit', name: 'Auditor', roles: ['AUDITOR'], branchIds: 'ALL' },
];
const perms = {
  'u-crm': ['lead:view', 'lead:create', 'customer:view', 'customer:create', 'kyc:view'],
  'u-audit': ['lead:view', 'customer:view', 'kyc:view', 'audit:view'],
};
const dashboard = {
  dataSource: 'demo',
  notice: 'Sample data for demonstration. Not live financial information.',
  data: {
    leads: { total: 10, contacted: 5, interested: 3, converted: 2 },
    kyc: { pending: 4, underReview: 1, correctionRequired: 0 },
    schemes: { active: 2 },
    groups: { active: 1, enrolmentOpen: 0 },
    memberships: { active: 7 },
    collections: { dueAmount: 100000, receivedAmount: 60000, overdueAmount: 5000 },
    upcomingAuctions: [],
    approvals: { auctionsPending: 0, payoutsPending: 1 },
    reconciliationExceptions: 0,
    alerts: [],
  },
};
const leadsPage = { items: [], page: 1, pageSize: 10, total: 0 };
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function stubApi(overrides = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0];
      const key = `${init.method ?? 'GET'} ${path}`;
      if (overrides[key]) return overrides[key](init);
      if (path === '/dev/users') return ok({ users: devUsers });
      if (path === '/me') {
        const id = init.headers?.['x-dev-user'];
        const user = devUsers.find((u) => u.id === id);
        return ok({ user, permissions: perms[id] });
      }
      if (path === '/dashboard/summary') return ok(dashboard);
      if (path === '/leads') return ok(leadsPage);
      if (path === '/crm/meta') return ok({ branches: [{ id: 'CHN', name: 'Chennai' }], leadSources: ['WALK_IN'] });
      return ok({ error: { code: 'X', message: `unmocked ${key}` } }, 500);
    }),
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const renderApp = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe('App shell', () => {
  it('renders dashboard with a demo-data label and a simulated-auth notice', async () => {
    stubApi();
    renderApp();
    expect(await screen.findByText(/Demo data\./)).toBeInTheDocument();
    expect(screen.getByText('₹1,00,000')).toBeInTheDocument();
    expect(screen.getByText(/Simulated sign-in/)).toBeInTheDocument();
  });

  it('shows an error state when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cannot reach the server/);
  });

  it('navigates via the sidebar to a not-yet-built module page', async () => {
    stubApi();
    renderApp();
    await userEvent.click(await screen.findByRole('link', { name: /Reports/ }));
    expect(await screen.findByText(/not implemented yet/i)).toBeInTheDocument();
  });
});

describe('CRM', () => {
  it('shows the Create lead action only with the create permission', async () => {
    stubApi();
    renderApp('/crm');
    expect(await screen.findByRole('button', { name: 'Create lead' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Simulated user'), 'u-audit');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create lead' })).not.toBeInTheDocument());
    expect(await screen.findByText('No leads found')).toBeInTheDocument();
  });

  it('hides modules the user cannot access', async () => {
    stubApi();
    renderApp();
    await screen.findByText(/Demo data\./);
    expect(screen.queryByRole('link', { name: /Administration/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Simulated user'), 'u-audit');
    expect(await screen.findByRole('link', { name: /Administration/ })).toBeInTheDocument();
  });

  it('displays server-side field errors on the lead form', async () => {
    stubApi({
      'POST /leads': () =>
        ok({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { phone: 'Enter a 10-digit Indian mobile number' } } }, 400),
    });
    renderApp('/crm/leads/new');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Test Person');
    await userEvent.type(screen.getByLabelText('Mobile number'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));
    expect(await screen.findByText('Enter a 10-digit Indian mobile number')).toBeInTheDocument();
  });

  it('offers explicit confirmation on a duplicate warning', async () => {
    stubApi({
      'POST /leads': () =>
        ok({ error: { code: 'DUPLICATE_WARNING', message: 'dup', details: [{ type: 'customer', id: 'CU-0001', name: 'Sample Customer One' }] } }, 409),
    });
    renderApp('/crm/leads/new');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Test Person');
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));
    expect(await screen.findByText(/Possible duplicate found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create anyway' })).toBeInTheDocument();
  });
});
