import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App.jsx';

const users = [
  { id: 'u-member', name: 'Member One', roles: ['CHIT_MEMBER'], branchIds: [], customerId: 'CU-0002' },
  { id: 'u-crm', name: 'CRM User', roles: ['CRM_EXEC'], branchIds: ['CHN'] },
];
const perms = {
  'u-member': ['auction:view', 'bid:submit', 'dispute:raise', 'portal:access'],
  'u-crm': ['support:view', 'support:manage', 'customer:view', 'lead:view'],
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
let calls;

const summary = (over = {}) => ({
  today: '2026-12-01', customer: { id: 'CU-0002', name: 'Member One', kycStatus: 'VERIFIED', membershipStatus: 'ACTIVE' },
  totals: { outstandingDuePaise: 10000000, overduePaise: 0, paidPaise: 4000000 },
  memberships: [{ groupId: 'GRP-0001', groupCode: 'GRP-P', groupName: 'Portal Group', groupStatus: 'ACTIVE', ticketNo: 1, schemeName: 'Portal Scheme', chitValuePaise: 20000000, installmentAmountPaise: 10000000, tenureMonths: 2, outstandingDuePaise: 10000000, overduePaise: 0, paidPaise: 4000000, nextDue: { instalmentId: 'INS-1', dueDate: '2026-12-01', outstandingPaise: 6000000, status: 'PARTIALLY_PAID' } }],
  openSupportCases: 1, pendingPaymentAttempts: 0, ...over,
});

function stub(handlers = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
    if (handlers[key]) return handlers[key](init);
    if (path === '/dev/users') return ok({ users });
    if (path === '/me') {
      const id = init.headers?.['x-dev-user'];
      return ok({ user: users.find((u) => u.id === id), permissions: perms[id] });
    }
    return ok({ error: { code: 'X', message: `unmocked ${key}` } }, 500);
  }));
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const renderAt = (path, user = 'u-member') => {
  localStorage.setItem('crm.devUser', user);
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
};

describe('portal shell and home', () => {
  it('sends a member to the portal home and shows no staff navigation', async () => {
    stub({ 'GET /portal/summary': () => ok(summary()) });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome, Member One' })).toBeInTheDocument();
    expect(screen.getAllByText('₹1,00,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹40,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Portal Group · ticket #1/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Portal' });
    expect(within(nav).getByRole('link', { name: 'Statement' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Collections|Accounting|CRM/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Simulated sign-in \(development mode\)/)).toBeInTheDocument();
  });

  it('keeps members out of staff routes', async () => {
    stub({ 'GET /portal/summary': () => ok(summary()) });
    renderAt('/accounting');
    expect(await screen.findByRole('heading', { name: 'Welcome, Member One' })).toBeInTheDocument();
  });

  it('warns when KYC is not verified', async () => {
    stub({ 'GET /portal/summary': () => ok(summary({ customer: { id: 'CU-0002', name: 'Member One', kycStatus: 'UNDER_REVIEW', membershipStatus: 'NONE' }, memberships: [] })) });
    renderAt('/portal');
    expect(await screen.findByText(/Your KYC status is Under review/)).toBeInTheDocument();
    expect(screen.getByText(/not yet in an active chit group/)).toBeInTheDocument();
  });

  it('gives staff the staff shell, not the portal', async () => {
    stub({ 'GET /support-cases': () => ok({ items: [], page: 1, pageSize: 10, total: 0 }) });
    renderAt('/support', 'u-crm');
    expect(await screen.findByRole('heading', { name: 'Customer support' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Portal' })).not.toBeInTheDocument();
  });
});

describe('portal payments (simulated)', () => {
  it('labels the payment as simulated, limits the amount to what is payable, and confirms before sending paise', async () => {
    stub({
      'GET /portal/summary': () => ok(summary()),
      'GET /portal/payment-attempts': () => ok({ items: [], notice: 'SIMULATED' }),
      'POST /portal/payment-attempts': () => ok({ id: 'ATT-0009', amountPaise: 150050, status: 'PENDING_CONFIRMATION', simulated: true }, 201),
    });
    renderAt('/portal/pay');
    expect(await screen.findByText(/Simulated payment\./)).toBeInTheDocument();
    const amount = screen.getByLabelText('Amount (₹)');
    const review = screen.getByRole('button', { name: 'Review payment' });
    await userEvent.type(amount, '2000000');
    expect(review).toBeDisabled();
    expect(screen.getByText('More than the amount payable')).toBeInTheDocument();
    await userEvent.clear(amount);
    await userEvent.type(amount, '1500.50');
    expect(review).toBeEnabled();
    await userEvent.click(review);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/₹1,500.50/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /portal/payment-attempts')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start payment' }));
    expect(await screen.findByText(/awaiting confirmation/)).toBeInTheDocument();
    const sent = calls.find((c) => c.key === 'POST /portal/payment-attempts').body;
    expect(sent).toEqual({ amountPaise: 150050 });
    expect(sent.customerId).toBeUndefined(); // identity comes from the session, never the form
    expect(screen.queryByText(/payment successful|paid successfully/i)).not.toBeInTheDocument();
  });

  it('shows pending requests as pending and lets the member cancel only those', async () => {
    stub({
      'GET /portal/summary': () => ok(summary()),
      'GET /portal/payment-attempts': () => ok({ items: [{ id: 'ATT-0001', amountPaise: 1000000, status: 'PENDING_CONFIRMATION', createdAt: '2026-12-01T05:00:00Z' }, { id: 'ATT-0002', amountPaise: 500000, status: 'SUCCESSFUL', paymentId: 'PAY-0001', createdAt: '2026-12-01T04:00:00Z' }], notice: 'SIMULATED' }),
    });
    renderAt('/portal/pay');
    const rows = await screen.findAllByRole('row');
    const pending = rows.find((r) => within(r).queryByText('ATT-0001'));
    const done = rows.find((r) => within(r).queryByText('ATT-0002'));
    expect(within(pending).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(done).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(within(done).getByRole('link', { name: 'Receipt' })).toBeInTheDocument();
  });

  it('shows the statement with its not-an-accounting-document notice and balance', async () => {
    stub({
      'GET /portal/summary': () => ok(summary()),
      'GET /portal/statement': () => ok({
        generatedAt: '2026-12-01T05:00:00Z', asOf: '2026-12-01', notice: 'Operational statement of instalments due and payments received. It is not an accounting or statutory document.',
        openingPaise: 0, totalDebitPaise: 10000000, totalCreditPaise: 4000000, closingPaise: 6000000,
        lines: [
          { date: '2026-12-01', type: 'INSTALMENT', description: 'GRP-P ticket 1 instalment 1', debitPaise: 10000000, creditPaise: 0, balancePaise: 10000000 },
          { date: '2026-12-01', type: 'PAYMENT', description: 'Payment received (cash), receipt RCP-0001', debitPaise: 0, creditPaise: 4000000, balancePaise: 6000000 },
        ],
      }),
    });
    renderAt('/portal/statement');
    expect(await screen.findByText(/not an accounting or statutory document/)).toBeInTheDocument();
    expect(screen.getByText('Payment received (cash), receipt RCP-0001')).toBeInTheDocument();
    expect(screen.getByText(/Balance ₹60,000/)).toBeInTheDocument();
  });

  it('hides the payout amount until approval and says notifications are not sent', async () => {
    stub({ 'GET /portal/payouts': () => ok({ items: [{ id: 'PYT-1', groupCode: 'GRP-P', ticketNo: 1, stage: 'Documents under review', status: 'ELIGIBILITY_REVIEW', documents: [{ title: 'Prize claim form', confirmed: false }] }] }) });
    renderAt('/portal/payouts');
    expect(await screen.findByText('Shown once approved')).toBeInTheDocument();
    expect(screen.getByText('Documents under review')).toBeInTheDocument();
    expect(screen.getByText(/Notifications about payouts are not sent yet/)).toBeInTheDocument();
  });
});

describe('support', () => {
  it('shows server-side validation errors and sends an idempotency key when creating a request', async () => {
    stub({
      'GET /portal/support/meta': () => ok({ categories: ['PAYMENT', 'OTHER'] }),
      'POST /portal/support-cases': () => ok({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { subject: 'Must be at least 5 characters' } } }, 400),
    });
    renderAt('/portal/support/new');
    await userEvent.selectOptions(await screen.findByLabelText('Type'), 'PAYMENT');
    await userEvent.type(screen.getByLabelText('Subject'), 'Hi');
    await userEvent.type(screen.getByLabelText('Details'), 'Something is wrong with my receipt');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Must be at least 5 characters')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /portal/support-cases').body.clientRequestId).toMatch(/.{8,}/);
  });

  it('lets a member reply to an open case but not to a closed one', async () => {
    const thread = (status) => ({ id: 'SUP-0001', subject: 'Receipt missing', category: 'PAYMENT', status, messages: [{ id: 'M1', at: '2026-12-01T05:00:00Z', authorType: 'MEMBER', body: 'Where is my receipt?', authorName: 'You' }, { id: 'M2', at: '2026-12-01T06:00:00Z', authorType: 'STAFF', body: 'We are checking.', authorName: 'Support team' }], history: [] });
    stub({ 'GET /portal/support-cases/SUP-0001': () => ok(thread('IN_PROGRESS')) });
    const { unmount } = renderAt('/portal/support/SUP-0001');
    expect(await screen.findByText('We are checking.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    unmount();
    stub({ 'GET /portal/support-cases/SUP-0001': () => ok(thread('CLOSED')) });
    renderAt('/portal/support/SUP-0001');
    expect(await screen.findByText(/This request is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reply' })).not.toBeInTheDocument();
  });

  it('marks internal notes clearly for staff and requires a comment to resolve', async () => {
    stub({
      'GET /support-cases/SUP-0001': () => ok({
        id: 'SUP-0001', subject: 'Receipt missing', category: 'PAYMENT', status: 'IN_PROGRESS', customerId: 'CU-0002', customerName: 'Member One', branchId: 'CHN', assignedToName: 'CRM User',
        messages: [{ id: 'M1', at: '2026-12-01T05:00:00Z', authorType: 'STAFF', internal: true, body: 'Check with cashier', authorName: 'CRM User' }], history: [],
      }),
      'POST /support-cases/SUP-0001/status': () => ok({}),
    });
    renderAt('/support/SUP-0001', 'u-crm');
    expect(await screen.findByText(/internal note \(not visible to the member\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark resolved' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Comment (min. 5 characters)'), 'Receipt re-issued');
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /support-cases/SUP-0001/status')?.body).toEqual({ status: 'RESOLVED', comment: 'Receipt re-issued' }));
  });
});
