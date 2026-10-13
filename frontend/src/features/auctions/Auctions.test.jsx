import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App.jsx';

const users = [
  { id: 'u-member', name: 'Member One', roles: ['CHIT_MEMBER'], branchIds: [], customerId: 'CU-0002' },
  { id: 'u-officer', name: 'Officer', roles: ['AUCTION_OFFICER'], branchIds: ['CHN'] },
  { id: 'u-fm', name: 'Finance Maker', roles: ['FINANCE_MAKER'], branchIds: 'ALL' },
];
const perms = {
  'u-member': ['auction:view', 'bid:submit', 'dispute:raise'],
  'u-officer': ['auction:view', 'auction:create', 'auction:prepare', 'auction:operate', 'dispute:raise', 'approval:view'],
  'u-fm': ['auction:view', 'payout:view', 'payout:create', 'payout:disburse', 'payout:reconcile'],
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const rules = { winnerSelection: 'HIGHEST_BID', tieBreak: 'EARLIEST_BID', bidPolicy: 'SINGLE', excludePriorWinners: true, requireNoOverdue: false, minBidPaise: 100000, maxBidPaise: 5000000, bidIncrementPaise: 100000 };
const base = { id: 'AUC-0001', groupId: 'GRP-0001', groupCode: 'GRP-A', branchId: 'CHN', cycleNo: 1, status: 'OPEN', scheduledOpenAt: '2026-12-01T05:00:00Z', scheduledCloseAt: '2026-12-01T07:00:00Z', serverTime: '2026-12-01T05:30:00Z', rules };
const memberAuction = (over = {}) => ({
  ...base, view: 'MEMBER', myTickets: [{ ticketNo: 1, eligible: true, reasons: [] }, { ticketNo: 4, eligible: false, reasons: ['Already won in cycle 1'] }],
  myBids: [], outcome: null, actions: { canBid: true, canRaiseDispute: false }, myDisputes: [], ...over,
});
const staffAuction = (over = {}) => ({
  ...base, view: 'STAFF', bids: [{ id: 'BID-0001', sequence: 1, ticketNo: 1, customerName: 'Member One', amountPaise: 500000, serverTimestamp: '2026-12-01T05:10:00Z' }], bidCount: 1,
  eligibility: [{ ticketNo: 1, customerName: 'Member One', eligible: true, reasons: [] }], readiness: { items: [], allMet: true }, result: null, disputes: [], history: [], approvalRequests: [],
  actions: { canCloseEarly: true, canCancel: true, canCompute: false }, ...over,
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
  localStorage.setItem('crm.devUser', user);
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
};

describe('Member bidding', () => {
  it('lists a member\'s auctions inside the customer portal shell', async () => {
    stub({ 'GET /auctions': () => ok({ items: [{ ...base, bidCount: undefined }], page: 1, pageSize: 10, total: 1 }) });
    renderAt('/auctions', 'u-member');
    expect(await screen.findByRole('heading', { name: 'My auctions' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Portal' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Collections/ })).not.toBeInTheDocument();
  });

  it('lists eligible and ineligible tickets with the reason', async () => {
    stub({ 'GET /auctions/AUC-0001': () => ok(memberAuction()) });
    renderAt('/auctions/AUC-0001', 'u-member');
    expect(await screen.findByText(/Not eligible: Already won in cycle 1/)).toBeInTheDocument();
    const select = screen.getByLabelText('Ticket');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select ticket', 'Ticket #1']); // ineligible ticket is not offered
  });

  it('confirms before sending, converts to paise, and shows acceptance only from the server reply', async () => {
    stub({
      'GET /auctions/AUC-0001': () => ok(memberAuction()),
      'POST /auctions/AUC-0001/bids': () => ok({ accepted: true, duplicate: false, bid: { id: 'BID-0007', ticketNo: 1, amountPaise: 150000, serverTimestamp: '2026-12-01T05:31:02Z' } }, 201),
    });
    renderAt('/auctions/AUC-0001', 'u-member');
    await userEvent.selectOptions(await screen.findByLabelText('Ticket'), '1');
    const submit = screen.getByRole('button', { name: 'Review bid' });
    await userEvent.type(screen.getByLabelText('Bid amount (₹)'), '1500.555');
    expect(submit).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Bid amount (₹)'));
    await userEvent.type(screen.getByLabelText('Bid amount (₹)'), '1500');
    await userEvent.click(submit);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/₹1,500/)).toBeInTheDocument();
    expect(screen.queryByText(/server accepted/i)).not.toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /auctions/AUC-0001/bids')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit bid' }));
    expect(await screen.findByText(/The server accepted your bid/)).toBeInTheDocument();
    const sent = calls.find((c) => c.key === 'POST /auctions/AUC-0001/bids').body;
    expect(sent).toMatchObject({ ticketNo: 1, amountPaise: 150000 });
    expect(sent.clientRequestId).toMatch(/.{8,}/);
  });

  it('never claims acceptance when the server rejects the bid', async () => {
    stub({
      'GET /auctions/AUC-0001': () => ok(memberAuction()),
      'POST /auctions/AUC-0001/bids': () => ok({ error: { code: 'AUCTION_NOT_OPEN', message: 'This auction is not open for bids' } }, 409),
    });
    renderAt('/auctions/AUC-0001', 'u-member');
    await userEvent.selectOptions(await screen.findByLabelText('Ticket'), '1');
    await userEvent.type(screen.getByLabelText('Bid amount (₹)'), '1500');
    await userEvent.click(screen.getByRole('button', { name: 'Review bid' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit bid' }));
    expect(await screen.findByText('This auction is not open for bids')).toBeInTheDocument();
    expect(screen.queryByText(/server accepted/i)).not.toBeInTheDocument();
  });

  it('hides the bid form once the auction is no longer open', async () => {
    stub({ 'GET /auctions/AUC-0001': () => ok(memberAuction({ status: 'CLOSED', actions: { canBid: false, canRaiseDispute: true } })) });
    renderAt('/auctions/AUC-0001', 'u-member');
    await screen.findByText('Your tickets');
    expect(screen.queryByText('Place a bid')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise a dispute' })).toBeInTheDocument();
  });

  it('tells a member the outcome only after approval, without exposing other bids', async () => {
    stub({ 'GET /auctions/AUC-0001': () => ok(memberAuction({ status: 'APPROVED', actions: { canBid: false, canRaiseDispute: true }, outcome: { outcome: 'AWARDED', winnerTicketNo: 2, youWon: false } })) });
    renderAt('/auctions/AUC-0001', 'u-member');
    expect(await screen.findByText('Ticket 2 won this auction.')).toBeInTheDocument();
    expect(screen.queryByText('Bid history')).not.toBeInTheDocument();
  });
});

describe('Auction console and scheduling', () => {
  it('shows the bid log and actions permitted by the server, plus open-dispute warnings', async () => {
    stub({ 'GET /auctions/AUC-0001': () => ok(staffAuction({ disputes: [{ id: 'DSP-0001', reason: 'Bid missing', raisedByName: 'Member', raisedAt: '2026-12-01T08:00:00Z', status: 'OPEN' }] })) });
    renderAt('/auctions/AUC-0001', 'u-officer');
    expect(await screen.findByText('Bid history (1)')).toBeInTheDocument();
    expect(screen.getByText(/1 open dispute/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close early' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compute result' })).not.toBeInTheDocument();
    expect(screen.getByText(/append-only/)).toBeInTheDocument();
  });

  it('requires every rule choice and shows server-side field errors on the schedule form', async () => {
    stub({
      'GET /groups': () => ok({ items: [{ id: 'GRP-0001', code: 'GRP-A', name: 'Group A' }], page: 1, pageSize: 100, total: 1 }),
      'POST /auctions': () => ok({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { winnerSelection: 'Required', excludePriorWinners: 'Choose yes or no' } } }, 400),
    });
    renderAt('/auctions/new', 'u-officer');
    await userEvent.selectOptions(await screen.findByLabelText('Group'), 'GRP-0001');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule auction' }));
    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Choose yes or no')).toBeInTheDocument();
    const sent = calls.find((c) => c.key === 'POST /auctions').body;
    expect(sent.excludePriorWinners).toBeUndefined(); // no silent default for a rule choice
    expect(sent.winnerSelection).toBe('');
  });
});

describe('Payouts', () => {
  const payout = (over = {}) => ({
    id: 'PYT-0001', auctionId: 'AUC-0001', groupCode: 'GRP-A', ticketNo: 2, customerId: 'CU-0003', customerName: 'Member Two', status: 'APPROVED',
    amountPaise: 25000000, amountBasis: 'Calc sheet CS-1', createdByName: 'Finance Maker', channel: undefined, documents: [], history: [], approvalRequests: [],
    eligibility: { items: [], allMet: true, info: { overdueInstalments: 1, overduePaise: 5000000 } }, reconciliationStatus: 'PENDING',
    amountNotice: 'Amount entered manually by Finance. It is not calculated by the system; the calculation engine has not been approved.',
    notificationNotice: 'Customer notification is not sent: no notification provider has been selected.',
    actions: { canInitiate: true, canHold: true }, ...over,
  });

  it('states that amounts are manual and offers only the actions the server allows', async () => {
    stub({ 'GET /payouts/PYT-0001': () => ok(payout()), 'GET /payouts/meta': () => ok({ channels: ['BANK_TRANSFER', 'CHEQUE'] }) });
    renderAt('/payouts/PYT-0001', 'u-fm');
    expect(await screen.findByText(/not calculated by the system/)).toBeInTheDocument();
    expect(screen.getByText('₹2,50,000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Initiate disbursement' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment made' })).not.toBeInTheDocument();
    expect(screen.getByText(/1 overdue instalment/)).toBeInTheDocument();
  });

  it('shows the no-notification notice once paid and does not imply automatic payment', async () => {
    stub({ 'GET /payouts/PYT-0001': () => ok(payout({ status: 'PAID', channel: 'BANK_TRANSFER', disbursement: { reference: 'UTR-1', paidDate: '2026-12-01' }, actions: {} })), 'GET /payouts/meta': () => ok({ channels: ['BANK_TRANSFER'] }) });
    renderAt('/payouts/PYT-0001', 'u-fm');
    expect(await screen.findByText(/notification is not sent/i)).toBeInTheDocument();
    expect(screen.getByText('UTR-1')).toBeInTheDocument();
  });

  it('records a disbursement only after the user supplies a reference and date', async () => {
    stub({
      'GET /payouts/PYT-0001': () => ok(payout({ status: 'DISBURSEMENT_PENDING', channel: 'BANK_TRANSFER', actions: { canRecordDisbursement: true } })),
      'GET /payouts/meta': () => ok({ channels: ['BANK_TRANSFER'] }),
      'POST /payouts/PYT-0001/disbursement': () => ok(payout({ status: 'PAID' })),
    });
    renderAt('/payouts/PYT-0001', 'u-fm');
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment made' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Record payment' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Bank / cheque reference'), 'UTR-99');
    await userEvent.type(within(dialog).getByLabelText('Date paid'), '2026-12-01');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /payouts/PYT-0001/disbursement')?.body).toEqual({ reference: 'UTR-99', paidDate: '2026-12-01' }));
  });
});
