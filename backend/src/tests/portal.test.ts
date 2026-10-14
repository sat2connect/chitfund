import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Store } from '../repositories/store.js';
import { createSeededStore } from '../seed/crmSeed.js';

let nowMs = Date.parse('2026-12-01T04:00:00.000Z');
let store: Store;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  nowMs = Date.parse('2026-12-01T04:00:00.000Z');
  store = createSeededStore();
  store.now = () => new Date(nowMs);
  store.today = () => new Date(nowMs).toISOString().slice(0, 10);
  app = createApp(store);
});

const as = (user: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-dev-user', user),
  post: (p: string, b: object = {}) => request(app).post(`/api/v1${p}`).set('x-dev-user', user).send(b),
});
const maker = as('u-chitops');
const head = as('u-ops');
const crm = as('u-crm-chn');
const col = as('u-col-chn');
const fm = as('u-fin-maker');
const fc = as('u-fin-checker');
const officer = as('u-auction');

const INSTALMENT = 10000000;
const scheme = {
  code: 'SCH-P',
  config: {
    name: 'Portal Scheme', jurisdiction: 'TAMIL_NADU', chitValuePaise: 20000000, memberCount: 2, installmentAmountPaise: INSTALMENT, frequency: 'MONTHLY',
    tenureMonths: 2, auction: { mode: 'MEMBER_BIDS' }, requiredDocuments: ['Prize claim form'], complianceChecklist: [], effectiveFrom: '2026-01-01',
  },
};

async function verifiedCustomer(phone: string) {
  const { body: lead } = await crm.post('/leads', { name: 'Member ' + phone, phone, source: 'WALK_IN', branchId: 'CHN' });
  for (const to of ['CONTACTED', 'INTERESTED', 'REGISTRATION_PENDING']) await crm.post(`/leads/${lead.id}/transition`, { to });
  const cid = (await crm.post(`/leads/${lead.id}/convert`)).body.customer.id as string;
  const kycId = (await crm.get(`/customers/${cid}`)).body.kycCaseId;
  await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'i.pdf' });
  await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'ADDRESS_PROOF', fileName: 'a.pdf' });
  await crm.post(`/kyc-cases/${kycId}/submit`);
  await as('u-kyc').post(`/kyc-cases/${kycId}/decision`, { decision: 'VERIFIED' });
  const a = await crm.post('/memberships/applications', { customerId: cid, preferredScheme: 'T' });
  await head.post(`/memberships/applications/${a.body.id}/decision`, { decision: 'APPROVED' });
  return cid;
}

async function activeGroup() {
  const created = await maker.post('/schemes', scheme);
  const vId = created.body.version.id;
  const rid = (await maker.post(`/scheme-versions/${vId}/submit`)).body.request.id;
  await head.post(`/approvals/${rid}/start-review`);
  await head.post(`/approvals/${rid}/decision`, { decision: 'APPROVED' });
  await head.post(`/scheme-versions/${vId}/publish`);
  const g = await maker.post('/groups', { code: 'GRP-P', name: 'Portal Group', schemeVersionId: vId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
  await maker.post(`/groups/${g.body.id}/submit`);
  const open = (await head.get('/approvals?scope=queue&type=GROUP_OPEN')).body.items[0];
  await head.post(`/approvals/${open.id}/decision`, { decision: 'APPROVED' });
  await head.post(`/groups/${g.body.id}/open-enrolment`);
  const cs = [await verifiedCustomer('9111111101'), await verifiedCustomer('9111111102')];
  for (const c of cs) await maker.post(`/groups/${g.body.id}/tickets`, { customerId: c });
  await maker.post(`/groups/${g.body.id}/ready`);
  await maker.post(`/groups/${g.body.id}/activation-request`);
  const act = (await head.get('/approvals?scope=queue&type=GROUP_ACTIVATION')).body.items[0];
  await head.post(`/approvals/${act.id}/decision`, { decision: 'APPROVED' });
  return { groupId: g.body.id as string, cs, m1: as(`u-member-${cs[0]}`), m2: as(`u-member-${cs[1]}`) };
}

let n = 0;
const payCash = (customerId: string, amountPaise = 4000000) =>
  col.post('/payments/offline', { customerId, mode: 'CASH', amountPaise, clientRequestId: `p-${++n}-abcdefgh` });

describe('portal access and isolation', () => {
  it('is for member sessions only, and members cannot reach staff data', async () => {
    const { m1 } = await activeGroup();
    expect((await crm.get('/portal/summary')).status).toBe(403); // staff
    expect((await crm.get('/portal/summary')).body.error.code).toBe('FORBIDDEN');
    expect((await fm.get('/portal/summary')).status).toBe(403);
    expect((await request(app).get('/api/v1/portal/summary')).status).toBe(401);
    for (const p of ['/instalments', '/payments', '/receipts', '/customers', '/leads', '/groups', '/accounting/journals', '/payouts', '/support-cases', '/approvals']) {
      expect((await m1.get(p)).status, p).toBe(403);
    }
    expect((await m1.get('/dashboard/summary')).status).toBe(403);
  });

  it('shows each member only their own memberships, dues and payments', async () => {
    const { cs, m1, m2 } = await activeGroup();
    const pay = (await payCash(cs[0]!)).body.payment;
    const s1 = (await m1.get('/portal/summary')).body;
    const s2 = (await m2.get('/portal/summary')).body;
    expect(s1.customer.id).toBe(cs[0]);
    expect(s2.customer.id).toBe(cs[1]);
    expect(s1.memberships).toHaveLength(1);
    expect(s1.memberships[0].paidPaise).toBe(4000000);
    expect(s2.memberships[0].paidPaise).toBe(0);
    expect((await m1.get('/portal/instalments')).body.items.every((i: { id: string }) => store.instalments.find((x) => x.id === i.id)!.customerId === cs[0])).toBe(true);
    expect((await m2.get('/portal/payments')).body.total).toBe(0);
    // another member's payment looks exactly like a missing one
    const other = await m2.get(`/portal/payments/${pay.id}`);
    const missing = await m2.get('/portal/payments/PAY-9999');
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe(missing.body.error.code);
    expect((await m1.get(`/portal/payments/${pay.id}`)).status).toBe(200);
  });

  it('ignores any customer id supplied by the client', async () => {
    const { cs, m1, m2 } = await activeGroup();
    const res = await m1.post('/portal/payment-attempts', { customerId: cs[1], amountPaise: 1000000 });
    expect(res.status).toBe(201);
    const att = store.attempts.find((a) => a.id === res.body.id)!;
    expect(att.customerId).toBe(cs[0]); // forced to the session's customer
    expect((await m2.get('/portal/payment-attempts')).body.items).toHaveLength(0);
  });

  it('exposes no internal fields on payments', async () => {
    const { cs, m1 } = await activeGroup();
    await payCash(cs[0]!);
    const p = (await m1.get('/portal/payments')).body.items[0];
    for (const k of ['recordedBy', 'journalId', 'reconciliationStatus', 'clientRequestId', 'branchId']) expect(p).not.toHaveProperty(k);
    const prof = (await m1.get('/portal/profile')).body;
    for (const k of ['createdBy', 'branchId', 'leadId']) expect(prof).not.toHaveProperty(k);
  });
});

describe('dues, payments and statements', () => {
  it('reports instalments with derived status and next due', async () => {
    const { cs, m1 } = await activeGroup();
    const s = (await m1.get('/portal/summary')).body;
    expect(s.memberships[0].nextDue.dueDate).toBe('2026-12-01');
    expect(s.memberships[0].nextDue.status).toBe('DUE');
    expect(s.totals.outstandingDuePaise).toBe(INSTALMENT);
    nowMs += 3 * 86400_000;
    expect((await m1.get('/portal/summary')).body.totals.overduePaise).toBe(INSTALMENT);
    await payCash(cs[0]!, INSTALMENT);
    const after = (await m1.get('/portal/summary')).body;
    expect(after.totals.overduePaise).toBe(0);
    expect((await m1.get('/portal/instalments?status=PAID')).body.total).toBe(1);
  });

  it('builds a statement whose balance matches the outstanding dues', async () => {
    const { cs, m1 } = await activeGroup();
    await payCash(cs[0]!, 4000000);
    const st = (await m1.get('/portal/statement')).body;
    expect(st.lines.map((l: { type: string }) => l.type)).toEqual(['INSTALMENT', 'PAYMENT']);
    expect(st.totalDebitPaise).toBe(INSTALMENT);
    expect(st.totalCreditPaise).toBe(4000000);
    expect(st.closingPaise).toBe(INSTALMENT - 4000000);
    expect(st.closingPaise).toBe((await m1.get('/portal/summary')).body.totals.outstandingDuePaise);
    expect(st.notice).toMatch(/not an accounting/i);
  });

  it('shows a reversed payment as a reversal line and restores the balance', async () => {
    const { cs, m1 } = await activeGroup();
    const pay = (await payCash(cs[0]!, 4000000)).body.payment;
    const rr = await as('u-fin-both').post(`/payments/${pay.id}/reversal-request`, { reason: 'Entered in error' });
    await fc.post(`/approvals/${rr.body.id}/decision`, { decision: 'APPROVED' });
    const st = (await m1.get('/portal/statement')).body;
    expect(st.lines.map((l: { type: string }) => l.type)).toEqual(['INSTALMENT', 'PAYMENT', 'PAYMENT_REVERSED']);
    expect(st.closingPaise).toBe(INSTALMENT);
    const list = (await m1.get('/portal/payments')).body.items[0];
    expect(list.status).toBe('REVERSED');
    expect(list.receiptStatus).toBe('VOID');
  });

  it('filters the statement by date range and keeps an opening balance', async () => {
    const { cs, m1 } = await activeGroup();
    await payCash(cs[0]!, 4000000);
    nowMs += 40 * 86400_000; // 2027-01-10: second instalment now due
    const st = (await m1.get('/portal/statement?from=2027-01-01')).body;
    expect(st.openingPaise).toBe(INSTALMENT - 4000000);
    expect(st.lines).toHaveLength(1);
    expect(st.lines[0].type).toBe('INSTALMENT');
    expect(st.closingPaise).toBe(2 * INSTALMENT - 4000000);
  });
});

describe('online payment from the portal (simulated)', () => {
  it('lets a member start an attempt, confirms only through the provider callback, and lets them cancel pending ones', async () => {
    const { cs, m1 } = await activeGroup();
    const att = await m1.post('/portal/payment-attempts', { amountPaise: INSTALMENT });
    expect(att.status).toBe(201);
    expect(att.body.status).toBe('PENDING_CONFIRMATION');
    expect((await m1.get('/portal/payments')).body.total).toBe(0);
    expect((await m1.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-member-1', outcome: 'SUCCESS' })).status).toBe(403);
    const ok = await fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-staff-001', outcome: 'SUCCESS' });
    expect(ok.status).toBe(200);
    const list = (await m1.get('/portal/payment-attempts')).body;
    expect(list.items[0].status).toBe('SUCCESSFUL');
    expect(list.notice).toMatch(/SIMULATED/);
    const payment = (await m1.get('/portal/payments')).body.items[0];
    expect(payment.simulated).toBe(true);
    expect((await m1.get(`/portal/payments/${payment.id}`)).body.notice).toMatch(/SIMULATED/);
    expect((await m1.get('/portal/summary')).body.totals.outstandingDuePaise).toBe(0);

    const second = await as(`u-member-${cs[1]}`).post('/portal/payment-attempts', { amountPaise: 1000000 });
    expect((await m1.post(`/portal/payment-attempts/${second.body.id}/cancel`)).status).toBe(404); // not theirs
    expect((await as(`u-member-${cs[1]}`).post(`/portal/payment-attempts/${second.body.id}/cancel`)).body.status).toBe('CANCELLED');
  });

  it('rejects amounts above what is payable and instalments that are not yet due', async () => {
    const { m1 } = await activeGroup();
    const over = await m1.post('/portal/payment-attempts', { amountPaise: 5 * INSTALMENT });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('EXCEEDS_OUTSTANDING');
    nowMs = Date.parse('2026-11-01T04:00:00Z');
    expect((await m1.post('/portal/payment-attempts', { amountPaise: 1000000 })).status).toBe(409);
    expect((await m1.post('/portal/payment-attempts', { amountPaise: 10.5 })).status).toBe(400);
  });
});

describe('prize payout tracking', () => {
  async function awarded() {
    const g = await activeGroup();
    const auc = await officer.post('/auctions', {
      groupId: g.groupId, cycleNo: 1, scheduledOpenAt: new Date(nowMs + 3600_000).toISOString(), scheduledCloseAt: new Date(nowMs + 3 * 3600_000).toISOString(),
      winnerSelection: 'HIGHEST_BID', tieBreak: 'EARLIEST_BID', bidPolicy: 'SINGLE', excludePriorWinners: false, requireNoOverdue: false,
    });
    await officer.post(`/auctions/${auc.body.id}/ready`);
    nowMs += 3700_000;
    await g.m1.post(`/auctions/${auc.body.id}/bids`, { ticketNo: 1, amountPaise: 500000, clientRequestId: 'bid-portal-0001' });
    nowMs += 3 * 3600_000;
    await officer.post(`/auctions/${auc.body.id}/compute`);
    await officer.post(`/auctions/${auc.body.id}/validate`);
    await officer.post(`/auctions/${auc.body.id}/submit`);
    const req = (await head.get('/approvals?scope=queue&type=AUCTION_RESULT')).body.items[0];
    await head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
    const p = (await fm.post('/payouts', { auctionId: auc.body.id, amountPaise: 15000000, amountBasis: 'Calc sheet CS-9 (manual)', clientRequestId: 'payout-portal-01' })).body.payout;
    return { ...g, payoutId: p.id as string, auctionId: auc.body.id as string };
  }

  it('shows stages in plain language, hides the amount until approved, and never leaks internals', async () => {
    const { m1, m2, payoutId } = await awarded();
    let item = (await m1.get('/portal/payouts')).body.items[0];
    expect(item.stage).toBe('Being prepared');
    expect(item.amountPaise).toBeUndefined();
    for (const k of ['amountBasis', 'createdBy', 'history', 'journalId', 'holdReason', 'failureReason']) expect(item).not.toHaveProperty(k);
    expect(item.documents).toEqual([{ title: 'Prize claim form', confirmed: false }]);
    expect((await m2.get('/portal/payouts')).body.items).toHaveLength(0); // loser sees nothing

    await fm.post(`/payouts/${payoutId}/submit-review`);
    const doc = (await maker.get(`/payouts/${payoutId}`)).body.documents[0];
    await maker.post(`/payouts/${payoutId}/documents/${doc.id}/confirm`, { reference: 'F-1' });
    const reqId = (await maker.post(`/payouts/${payoutId}/request-approval`)).body.approvalRequests[0].id;
    expect((await m1.get('/portal/payouts')).body.items[0].stage).toBe('Awaiting approval');
    await fc.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' });
    item = (await m1.get('/portal/payouts')).body.items[0];
    expect(item.stage).toBe('Approved');
    expect(item.amountPaise).toBe(15000000);
    await fm.post(`/payouts/${payoutId}/initiate`, { channel: 'BANK_TRANSFER' });
    await fm.post(`/payouts/${payoutId}/disbursement`, { reference: 'UTR-PORTAL', paidDate: '2026-12-01' });
    item = (await m1.get('/portal/payouts')).body.items[0];
    expect(item.stage).toBe('Paid');
    expect(item.reference).toBe('UTR-PORTAL');
  });

  it('shows a held payout generically without the internal reason', async () => {
    const { m1, payoutId } = await awarded();
    await head.post(`/payouts/${payoutId}/hold`, { reason: 'Internal legal query about claimant' });
    const item = (await m1.get('/portal/payouts')).body.items[0];
    expect(item.stage).toMatch(/On hold/);
    expect(JSON.stringify(item)).not.toMatch(/legal/);
  });
});

describe('customer support', () => {
  const caseBody = (over: Record<string, unknown> = {}) => ({ category: 'PAYMENT', subject: 'Receipt missing', description: 'I paid in cash but cannot find my receipt.', clientRequestId: `case-${++n}-abcdefgh`, ...over });

  it('validates and creates a case, idempotently', async () => {
    const { m1 } = await activeGroup();
    expect((await m1.post('/portal/support-cases', { category: 'NOPE', subject: 'x', description: 'y' })).status).toBe(400);
    const body = caseBody({ clientRequestId: 'same-case-request' });
    const a = await m1.post('/portal/support-cases', body);
    const b = await m1.post('/portal/support-cases', body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.case.id).toBe(a.body.case.id);
    expect((await m1.get('/portal/support-cases')).body.total).toBe(1);
    expect(a.body.case.status).toBe('OPEN');
  });

  it('keeps cases private to the member and to staff in the right branch', async () => {
    const { m1, m2 } = await activeGroup();
    const c = (await m1.post('/portal/support-cases', caseBody())).body.case;
    expect((await m2.get(`/portal/support-cases/${c.id}`)).status).toBe(404);
    expect((await m2.post(`/portal/support-cases/${c.id}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await m2.get('/portal/support-cases')).body.total).toBe(0);
    expect((await crm.get(`/support-cases/${c.id}`)).status).toBe(200);
    const cbe = await as('u-crm-cbe').get(`/support-cases/${c.id}`);
    expect(cbe.status).toBe(403);
    expect(cbe.body.error.code).toBe('FORBIDDEN_BRANCH');
    expect((await as('u-crm-cbe').get('/support-cases')).body.total).toBe(0);
    expect((await col.get('/support-cases')).status).toBe(403);
  });

  it('runs the conversation: staff reply, hidden internal notes, resolution, member reopen', async () => {
    const { m1 } = await activeGroup();
    const c = (await m1.post('/portal/support-cases', caseBody())).body.case;
    expect((await crm.post(`/support-cases/${c.id}/status`, { status: 'RESOLVED', comment: 'Receipt re-issued' })).body.error.code).toBe('REPLY_REQUIRED');
    await crm.post(`/support-cases/${c.id}/assign`);
    await crm.post(`/support-cases/${c.id}/messages`, { body: 'Checking with the branch cashier.', internal: true });
    await crm.post(`/support-cases/${c.id}/messages`, { body: 'We found your receipt and will send it today.' });
    const member = (await m1.get(`/portal/support-cases/${c.id}`)).body;
    expect(member.messages.map((m: { body: string }) => m.body)).toEqual(['I paid in cash but cannot find my receipt.', 'We found your receipt and will send it today.']);
    expect(member.messages.every((m: { internal?: boolean }) => m.internal === undefined)).toBe(true);
    expect(member.status).toBe('IN_PROGRESS');
    const staff = (await crm.get(`/support-cases/${c.id}`)).body;
    expect(staff.messages).toHaveLength(3);
    expect((await crm.post(`/support-cases/${c.id}/status`, { status: 'RESOLVED' })).status).toBe(400); // comment required
    expect((await crm.post(`/support-cases/${c.id}/status`, { status: 'RESOLVED', comment: 'Receipt re-issued' })).body.status).toBe('RESOLVED');
    const reopened = await m1.post(`/portal/support-cases/${c.id}/messages`, { body: 'The receipt amount is wrong.' });
    expect(reopened.body.status).toBe('OPEN');
    await crm.post(`/support-cases/${c.id}/status`, { status: 'CLOSED', comment: 'Duplicate of SUP-0002' });
    const closed = await m1.post(`/portal/support-cases/${c.id}/messages`, { body: 'Hello again' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('CASE_CLOSED');
  });

  it('records support actions in the audit log and lets staff without manage rights only look', async () => {
    const { m1 } = await activeGroup();
    const c = (await m1.post('/portal/support-cases', caseBody({ category: 'COMPLAINT' }))).body.case;
    await crm.post(`/support-cases/${c.id}/assign`);
    expect((await as('u-audit').get(`/support-cases/${c.id}`)).status).toBe(200);
    expect((await as('u-audit').post(`/support-cases/${c.id}/messages`, { body: 'x' })).status).toBe(403);
    const logs = (await as('u-audit').get('/audit-logs?pageSize=100')).body.items.map((a: { action: string }) => a.action);
    expect(logs).toEqual(expect.arrayContaining(['support.create', 'support.assign']));
  });
});
