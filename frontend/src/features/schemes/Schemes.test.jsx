import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App.jsx';

const users = [
  { id: 'u-ops', name: 'Ops Head', roles: ['OPS_HEAD'], branchIds: 'ALL' },
  { id: 'u-maker', name: 'Maker', roles: ['CHIT_OPS'], branchIds: ['CHN'] },
];
const perms = {
  'u-ops': ['scheme:view', 'scheme:approve', 'group:view', 'group:approve', 'approval:view'],
  'u-maker': ['scheme:view', 'scheme:create', 'scheme:edit', 'scheme:submit', 'group:view', 'approval:view'],
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const approvalRow = (over = {}) => ({
  id: 'APR-0001', entityType: 'SCHEME_VERSION', entityId: 'SCV-0001', entityLabel: 'SCH-A v1 – Test', subjectPath: '/schemes/SCH-0001',
  makerId: 'u-maker', makerName: 'Maker', submittedAt: '2026-10-01T10:00:00Z', status: 'IN_REVIEW', submittedRevision: 1,
  actions: { canStartReview: false, canDecide: true, isOwnSubmission: false }, ...over,
});

function stub(handlers = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    if (handlers[key]) return handlers[key](init);
    if (path === '/dev/users') return ok({ users });
    if (path === '/me') {
      const id = init.headers?.['x-dev-user'];
      return ok({ user: users.find((u) => u.id === id), permissions: perms[id] });
    }
    if (path === '/schemes/meta') return ok({ jurisdictions: ['TAMIL_NADU'], frequencies: ['MONTHLY'], auctionModes: ['STAFF_ASSISTED'] });
    return ok({ error: { code: 'X', message: `unmocked ${key}` } }, 500);
  }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('Schemes & approvals UI', () => {
  it('lists schemes with Indian rupee formatting converted from paise', async () => {
    stub({
      'GET /schemes': () => ok({
        items: [{ id: 'SCH-0001', code: 'SCH-A', name: 'Test Scheme', chitValuePaise: 20000000, installmentAmountPaise: 1000000, memberCount: 20,
          latestVersion: { id: 'SCV-0001', version: 1, status: 'PUBLISHED' }, publishedVersion: { id: 'SCV-0001', version: 1 } }],
        page: 1, pageSize: 10, total: 1,
      }),
    });
    renderAt('/schemes');
    expect(await screen.findByText('₹2,00,000')).toBeInTheDocument();
    expect(screen.getByText('₹10,000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create scheme' })).not.toBeInTheDocument(); // ops head cannot create
  });

  it('shows Create scheme only to users with the permission', async () => {
    localStorage.setItem('crm.devUser', 'u-maker');
    stub({ 'GET /schemes': () => ok({ items: [], page: 1, pageSize: 10, total: 0 }) });
    renderAt('/schemes');
    expect(await screen.findByRole('button', { name: 'Create scheme' })).toBeInTheDocument();
  });

  it('maps nested server validation errors onto scheme form fields', async () => {
    localStorage.setItem('crm.devUser', 'u-maker');
    stub({
      'POST /schemes': () => ok({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { code: 'Use 3–20 capital letters, digits or hyphens', 'auction.mode': 'Must be one of: STAFF_ASSISTED' } } }, 400),
    });
    renderAt('/schemes/new');
    await userEvent.type(await screen.findByLabelText('Scheme code'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Create scheme' }));
    expect(await screen.findByText('Use 3–20 capital letters, digits or hyphens')).toBeInTheDocument();
    expect(screen.getByText('Must be one of: STAFF_ASSISTED')).toBeInTheDocument();
  });

  it('approval centre offers decisions only where the server says the user may decide', async () => {
    stub({
      'GET /approvals': () => ok({
        items: [
          approvalRow(),
          approvalRow({ id: 'APR-0002', entityLabel: 'Own item', makerId: 'u-ops', actions: { canStartReview: false, canDecide: false, isOwnSubmission: true } }),
        ],
        page: 1, pageSize: 10, total: 2,
      }),
    });
    renderAt('/approvals');
    const rows = await screen.findAllByRole('row');
    const first = rows.find((r) => within(r).queryByText('APR-0001'));
    const own = rows.find((r) => within(r).queryByText('APR-0002'));
    expect(within(first).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(own).getByText('Your submission')).toBeInTheDocument();
  });

  it('requires a comment before a return decision is sent', async () => {
    stub({ 'GET /approvals': () => ok({ items: [approvalRow()], page: 1, pageSize: 10, total: 1 }) });
    renderAt('/approvals');
    await userEvent.click(await screen.findByRole('button', { name: 'Return' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Returned' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Comment'), 'Please fix');
    expect(within(dialog).getByRole('button', { name: 'Returned' })).toBeEnabled();
  });
});
