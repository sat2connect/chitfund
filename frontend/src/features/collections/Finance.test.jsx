import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App.jsx';

const users = [
  { id: 'u-col', name: 'Collector', roles: ['COLLECTION_OFFICER'], branchIds: ['CHN'] },
  { id: 'u-fm', name: 'Finance Maker', roles: ['FINANCE_MAKER'], branchIds: 'ALL' },
];
const perms = {
  'u-col': ['instalment:view', 'payment:view', 'receipt:view', 'collection:record', 'payment:initiate', 'customer:view'],
  'u-fm': ['instalment:view', 'payment:view', 'receipt:view', 'reconcile:view', 'reconcile:manage', 'accounting:view', 'journal:create', 'journal:submit',
    'payment:simulate', 'payment:reverse-request', 'approval:view', 'customer:view'],
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const due = (over = {}) => ({
  id: 'INS-0001', groupId: 'GRP-0001', groupCode: 'GRP-F', branchId: 'CHN', ticketNo: 1, customerId: 'CU-0002', customerName: 'Member One', seq: 1,
  dueDate: '2026-12-01', amountPaise: 10000000, paidPaise: 0, outstandingPaise: 10000000, status: 'DUE', ...over,
});
let calls;

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
const renderAt = (path, user) => {
  if (user) localStorage.setItem('crm.devUser', user);
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
};

describe('Collections UI', () => {
  it('shows dues with rupee formatting, summary and the placeholder grace-rule notice', async () => {
    stub({
      'GET /instalments': () => ok({ items: [due()], page: 1, pageSize: 10, total: 1 }),
      'GET /instalments/summary': () => ok({ today: '2026-12-01', graceDays: 0, graceNotice: 'Overdue grace days are a placeholder setting pending approved business rules.', dueToDatePaise: 20000000, collectedAgainstDuePaise: 4000000, outstandingDuePaise: 16000000, overduePaise: 0, overdueCount: 0, scheduledPaise: 0 }),
    });
    renderAt('/collections', 'u-col');
    expect(await screen.findByText('₹2,00,000')).toBeInTheDocument();
    expect(screen.getByText('₹40,000')).toBeInTheDocument();
    expect(screen.getByText(/placeholder setting/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Collect' })).toBeInTheDocument();
  });

  it('converts rupees to paise, sends an idempotency key, and asks for confirmation before recording', async () => {
    stub({
      'GET /customers': () => ok({ items: [{ id: 'CU-0002', name: 'Member One' }], page: 1, pageSize: 100, total: 1 }),
      'GET /payments/meta': () => ok({ modes: ['CASH', 'UPI'], today: '2026-12-01' }),
      'GET /instalments': () => ok({ items: [due()], page: 1, pageSize: 100, total: 1 }),
      'POST /payments/offline': () => ok({ payment: { id: 'PAY-0001', receiptId: 'RCP-0001' }, duplicate: false }, 201),
    });
    renderAt('/collections/collect?customerId=CU-0002', 'u-col');
    const amount = await screen.findByLabelText('Amount (₹)', { selector: 'input' , exact: false }).catch(() => null);
    const amountInput = amount ?? screen.getAllByLabelText('Amount (₹)')[0];
    const review = screen.getByRole('button', { name: 'Review and record' });
    expect(review).toBeDisabled();
    await userEvent.type(amountInput, '1500.505');
    expect(review).toBeDisabled(); // more than 2 decimals is rejected
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '1500.50');
    expect(review).toBeEnabled();
    await userEvent.click(review);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/₹1,500.50/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /payments/offline')).toBe(false); // nothing sent before confirming
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /payments/offline')).toBe(true));
    const sent = calls.find((c) => c.key === 'POST /payments/offline').body;
    expect(sent.amountPaise).toBe(150050);
    expect(sent.clientRequestId).toMatch(/.{8,}/);
    expect(await screen.findByText(/RCP-0001/)).toBeInTheDocument();
  });

  it('labels the online flow as simulated and offers callbacks only to users allowed to simulate', async () => {
    const attempt = { id: 'ATT-0001', customerName: 'Member One', amountPaise: 10000000, providerRef: 'SIM-ATT-0001', status: 'PENDING_CONFIRMATION', simulated: true };
    stub({ 'GET /payment-attempts': () => ok({ items: [attempt], page: 1, pageSize: 10, total: 1 }) });
    const { unmount } = renderAt('/collections/attempts', 'u-col');
    expect(await screen.findByText(/Simulated gateway\./)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simulate success' })).not.toBeInTheDocument();
    unmount();
    stub({ 'GET /payment-attempts': () => ok({ items: [attempt], page: 1, pageSize: 10, total: 1 }) });
    renderAt('/collections/attempts', 'u-fm');
    expect(await screen.findByRole('button', { name: 'Simulate success' })).toBeInTheDocument();
  });

  it('hides collections for users without the permission', async () => {
    stub();
    renderAt('/', 'u-col');
    await screen.findByText(/Simulated sign-in/);
    expect(screen.queryByRole('link', { name: /Accounting/ })).not.toBeInTheDocument();
  });
});

describe('Accounting UI', () => {
  const accounts = { placeholder: true, items: [
    { id: 'ACC-1', code: '5100', name: 'Operating expenses', type: 'EXPENSE', active: true, placeholder: true },
    { id: 'ACC-2', code: '1020', name: 'Bank - collections', type: 'ASSET', active: true, placeholder: true },
  ] };

  it('journal form shows live balance and blocks saving unbalanced entries', async () => {
    stub({ 'GET /accounting/accounts': () => ok(accounts), 'GET /accounting/periods': () => ok({ items: [] }) });
    renderAt('/accounting/journals/new', 'u-fm');
    await userEvent.selectOptions(await screen.findByLabelText('Account line 1'), 'ACC-1');
    await userEvent.selectOptions(screen.getByLabelText('Account line 2'), 'ACC-2');
    await userEvent.type(screen.getByLabelText('Debit line 1'), '500');
    const save = screen.getByRole('button', { name: 'Save draft' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Out of balance by/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Credit line 2'), '500');
    expect(screen.getByText('Balanced')).toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it('flags the chart of accounts as an unapproved placeholder', async () => {
    stub({ 'GET /accounting/accounts': () => ok(accounts), 'GET /accounting/posting-rules': () => ok({ placeholder: true, notice: 'Placeholder mappings.', debitByMode: { CASH: 'Cash in hand' }, credit: 'Chit subscription collections' }) });
    renderAt('/accounting/accounts', 'u-fm');
    expect(await screen.findByText(/Placeholder chart\./)).toBeInTheDocument();
    expect(screen.getAllByText('No (placeholder)')).toHaveLength(2);
  });

  it('shows an out-of-balance warning if the server ever reports one', async () => {
    stub({ 'GET /accounting/trial-balance': () => ok({ asOf: '2026-12-01', items: [], totalDebitPaise: 100, totalCreditPaise: 50, balanced: false, includesSimulated: false }) });
    renderAt('/accounting/trial-balance', 'u-fm');
    expect(await screen.findByText('Out of balance')).toBeInTheDocument();
  });
});
