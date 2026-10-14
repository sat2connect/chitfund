import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createSeededStore } from '../seed/crmSeed.js';
import { addMonths } from '../services/instalmentService.js';
import type { Store } from '../repositories/store.js';

let store: Store;
let app: ReturnType<typeof createApp>;
let today = '2026-12-01';
beforeEach(() => {
  today = '2026-12-01';
  store = createSeededStore();
  store.today = () => today;
  app = createApp(store);
});

const as = (user: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-dev-user', user),
  post: (p: string, b: object = {}) => request(app).post(`/api/v1${p}`).set('x-dev-user', user).send(b),
  put: (p: string, b: object = {}) => request(app).put(`/api/v1${p}`).set('x-dev-user', user).send(b),
});
const maker = as('u-chitops');
const head = as('u-ops');
const crm = as('u-crm-chn');
const col = as('u-col-chn');
const fm = as('u-fin-maker');
const fc = as('u-fin-checker');
const both = as('u-fin-both');

const INSTALMENT = 10000000; // 1,00,000 rupees in paise
const scheme = {
  code: 'SCH-F',
  config: {
    name: 'Finance Scheme', jurisdiction: 'TAMIL_NADU', chitValuePaise: 20000000, memberCount: 2, installmentAmountPaise: INSTALMENT,
    frequency: 'MONTHLY', tenureMonths: 2, auction: { mode: 'STAFF_ASSISTED' }, requiredDocuments: [], complianceChecklist: [], effectiveFrom: '2026-01-01',
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

/** Builds an ACTIVE group with two members whose first instalment is due 2026-12-01. */
async function activeGroup() {
  const created = await maker.post('/schemes', scheme);
  const vId = created.body.version.id;
  const rid = (await maker.post(`/scheme-versions/${vId}/submit`)).body.request.id;
  await head.post(`/approvals/${rid}/start-review`);
  await head.post(`/approvals/${rid}/decision`, { decision: 'APPROVED' });
  await head.post(`/scheme-versions/${vId}/publish`);
  const g = await maker.post('/groups', { code: 'GRP-F', name: 'Fin Group', schemeVersionId: vId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
  await maker.post(`/groups/${g.body.id}/submit`);
  const open = (await head.get('/approvals?scope=queue&type=GROUP_OPEN')).body.items[0];
  await head.post(`/approvals/${open.id}/decision`, { decision: 'APPROVED' });
  await head.post(`/groups/${g.body.id}/open-enrolment`);
  const c1 = await verifiedCustomer('9777777771');
  const c2 = await verifiedCustomer('9777777772');
  await maker.post(`/groups/${g.body.id}/tickets`, { customerId: c1 });
  await maker.post(`/groups/${g.body.id}/tickets`, { customerId: c2 });
  await maker.post(`/groups/${g.body.id}/ready`);
  await maker.post(`/groups/${g.body.id}/activation-request`);
  const act = (await head.get('/approvals?scope=queue&type=GROUP_ACTIVATION')).body.items[0];
  const res = await head.post(`/approvals/${act.id}/decision`, { decision: 'APPROVED' });
  return { groupId: g.body.id as string, c1, c2, activation: res };
}

let n = 0;
const pay = (who: ReturnType<typeof as>, customerId: string, over: Record<string, unknown> = {}) =>
  who.post('/payments/offline', { customerId, mode: 'CASH', amountPaise: 4000000, clientRequestId: `req-${++n}-abcdefgh`, ...over });

const acct = async (code: string) => (await fm.get('/accounting/accounts')).body.items.find((a: { code: string }) => a.code === code).id as string;
const tb = async (q = '') => (await fm.get(`/accounting/trial-balance${q}`)).body;
const tbRow = (t: { items: { code: string; debitPaise: number; creditPaise: number }[] }, code: string) => t.items.find((r) => r.code === code)!;

describe('instalment schedules', () => {
  it('adds months with month-end clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 2)).toBe('2027-02-15');
  });
  it('generates one instalment per tenure month per ticket on activation, with derived statuses', async () => {
    const { groupId, activation } = await activeGroup();
    expect(activation.status).toBe(200);
    const list = (await col.get(`/instalments?groupId=${groupId}&pageSize=100`)).body;
    expect(list.total).toBe(4);
    expect(list.items.map((i: { dueDate: string }) => i.dueDate).sort()).toEqual(['2026-12-01', '2026-12-01', '2027-01-01', '2027-01-01']);
    expect(list.items.every((i: { amountPaise: number }) => i.amountPaise === INSTALMENT)).toBe(true);
    const status = async () => (await col.get(`/instalments?groupId=${groupId}&pageSize=100`)).body.items.map((i: { status: string }) => i.status);
    expect(await status()).toEqual(['DUE', 'DUE', 'SCHEDULED', 'SCHEDULED']); // today = due date
    today = '2026-12-02';
    expect((await status()).slice(0, 2)).toEqual(['OVERDUE', 'OVERDUE']); // grace days = 0 (placeholder setting)
    today = '2026-11-20';
    expect((await status()).every((s: string) => s === 'SCHEDULED')).toBe(true);
  });
  it('does not generate duplicate schedules', async () => {
    const { groupId } = await activeGroup();
    expect((await col.get(`/instalments?groupId=${groupId}&pageSize=100`)).body.total).toBe(4);
  });
  it('blocks payment of instalments that are not yet due', async () => {
    const { c1 } = await activeGroup();
    today = '2026-11-20';
    expect((await pay(col, c1)).status).toBe(409);
  });
});

describe('offline collections', () => {
  it('records a partial cash payment with receipt, allocation and a balanced journal', async () => {
    const { c1 } = await activeGroup();
    const res = await pay(col, c1);
    expect(res.status).toBe(201);
    const id = res.body.payment.id;
    const detail = (await col.get(`/payments/${id}`)).body;
    expect(detail.receipt.status).toBe('ISSUED');
    expect(detail.allocations).toHaveLength(1);
    expect(detail.allocations[0].amountPaise).toBe(4000000);
    expect(detail.journal.status).toBe('POSTED');
    expect(detail.payment.reconciliationStatus).toBe('NOT_APPLICABLE');
    const inst = (await col.get(`/instalments?customerId=${c1}`)).body.items[0];
    expect(inst.status).toBe('PARTIALLY_PAID');
    expect(inst.outstandingPaise).toBe(INSTALMENT - 4000000);
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(tbRow(t, '1010').debitPaise).toBe(4000000);
    expect(tbRow(t, '2100').creditPaise).toBe(4000000);
  });
  it('allocates oldest-first across instalments and marks them paid', async () => {
    const { c1 } = await activeGroup();
    today = '2027-01-05';
    const res = await pay(col, c1, { amountPaise: 2 * INSTALMENT });
    expect(res.status).toBe(201);
    const items = (await col.get(`/instalments?customerId=${c1}`)).body.items;
    expect(items.map((i: { status: string }) => i.status)).toEqual(['PAID', 'PAID']);
  });
  it('is idempotent for the same client request id', async () => {
    const { c1 } = await activeGroup();
    const body = { customerId: c1, mode: 'CASH', amountPaise: 1000000, clientRequestId: 'same-request-001' };
    const first = await col.post('/payments/offline', body);
    const again = await col.post('/payments/offline', body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.payment.id).toBe(first.body.payment.id);
    expect((await col.get('/payments')).body.total).toBe(1);
    expect(tbRow(await tb(), '1010').debitPaise).toBe(1000000);
  });
  it('warns on a likely duplicate cash entry and requires confirmation', async () => {
    const { c1 } = await activeGroup();
    await pay(col, c1);
    const dup = await pay(col, c1);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_WARNING');
    expect((await pay(col, c1, { confirmDuplicate: true })).status).toBe(201);
  });
  it('requires and de-duplicates references for non-cash modes', async () => {
    const { c1 } = await activeGroup();
    expect((await pay(col, c1, { mode: 'UPI' })).status).toBe(400);
    expect((await pay(col, c1, { mode: 'UPI', reference: 'UTR-1' })).status).toBe(201);
    expect((await pay(col, c1, { mode: 'UPI', reference: 'utr-1' })).body.error.code).toBe('DUPLICATE_REFERENCE');
  });
  it('rejects amounts above the outstanding balance and bad input', async () => {
    const { c1 } = await activeGroup();
    const over = await pay(col, c1, { amountPaise: 5 * INSTALMENT });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('EXCEEDS_OUTSTANDING');
    expect(over.body.error.details.outstandingPaise).toBe(INSTALMENT);
    expect((await pay(col, c1, { amountPaise: 100.5 })).status).toBe(400);
    expect((await pay(col, c1, { receivedDate: '2999-01-01' })).status).toBe(400);
  });
  it('enforces permission and branch scope', async () => {
    const { c1 } = await activeGroup();
    expect((await pay(crm, c1)).status).toBe(403); // no collection permission
    const other = await pay(as('u-col-cbe'), c1);
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('FORBIDDEN_BRANCH');
    expect((await as('u-col-cbe').get('/instalments')).body.total).toBe(0);
  });
});

describe('online payments (simulated gateway)', () => {
  it('only the provider callback can confirm; replays and late callbacks never double-post', async () => {
    const { c1 } = await activeGroup();
    const att = await col.post('/payment-attempts', { customerId: c1, amountPaise: INSTALMENT });
    expect(att.status).toBe(201);
    expect(att.body.status).toBe('PENDING_CONFIRMATION');
    expect(att.body.simulated).toBe(true);
    expect((await col.get('/payments')).body.total).toBe(0); // initiating proves nothing
    expect((await col.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-0001', outcome: 'SUCCESS' })).status).toBe(403);

    const ok = await fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-0001', outcome: 'SUCCESS' });
    expect(ok.status).toBe(200);
    expect(ok.body.attempt.status).toBe('SUCCESSFUL');
    expect(ok.body.payment.simulated).toBe(true);

    const replay = await fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-0001', outcome: 'SUCCESS' });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    const late = await fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-0002', outcome: 'SUCCESS' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ATTEMPT_FINALIZED');
    expect((await fm.get('/payments')).body.total).toBe(1);
    expect((await col.get(`/instalments?customerId=${c1}`)).body.items[0].status).toBe('PAID');
  });
  it('keeps simulated money out of the books by default', async () => {
    const { c1 } = await activeGroup();
    const att = await col.post('/payment-attempts', { customerId: c1, amountPaise: INSTALMENT });
    await fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-0003', outcome: 'SUCCESS' });
    expect(tbRow(await tb(), '1030').debitPaise).toBe(0);
    const withSim = await tb('?includeSimulated=true');
    expect(tbRow(withSim, '1030').debitPaise).toBe(INSTALMENT);
    expect(withSim.includesSimulated).toBe(true);
  });
  it('records a failed callback without creating a payment', async () => {
    const { c1 } = await activeGroup();
    const att = await col.post('/payment-attempts', { customerId: c1, amountPaise: INSTALMENT });
    const res = await fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-0004', outcome: 'FAILURE' });
    expect(res.body.attempt.status).toBe('FAILED');
    expect((await fm.get('/payments')).body.total).toBe(0);
  });
  it('allows cancelling a pending attempt, after which callbacks are not applied', async () => {
    const { c1 } = await activeGroup();
    const att = await col.post('/payment-attempts', { customerId: c1, amountPaise: INSTALMENT });
    expect((await col.post(`/payment-attempts/${att.body.id}/cancel`)).body.status).toBe('CANCELLED');
    expect((await fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-0005', outcome: 'SUCCESS' })).status).toBe(409);
    expect((await fm.get('/payments')).body.total).toBe(0);
  });
});

describe('payment reversal', () => {
  it('needs independent approval, preserves history, and restores the dues', async () => {
    const { c1 } = await activeGroup();
    const p = (await pay(col, c1, { amountPaise: INSTALMENT })).body.payment;
    expect((await col.post(`/payments/${p.id}/reversal-request`, { reason: 'Entered in error' })).status).toBe(403);
    const reqRes = await both.post(`/payments/${p.id}/reversal-request`, { reason: 'Entered in error' });
    expect(reqRes.status).toBe(201);
    const self = await both.post(`/approvals/${reqRes.body.id}/decision`, { decision: 'APPROVED' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('MAKER_CHECKER');
    expect((await fc.post(`/approvals/${reqRes.body.id}/decision`, { decision: 'APPROVED' })).status).toBe(200);

    const detail = (await fc.get(`/payments/${p.id}`)).body;
    expect(detail.payment.status).toBe('REVERSED');
    expect(detail.receipt.status).toBe('VOID');
    expect(detail.allocations[0].status).toBe('REVERSED');
    expect(detail.journal.status).toBe('REVERSED');
    expect((await col.get(`/instalments?customerId=${c1}`)).body.items[0].status).toBe('DUE');

    const journals = (await fc.get('/accounting/journals?pageSize=50')).body.items;
    expect(journals.filter((j: { source: { type: string } }) => ['PAYMENT', 'PAYMENT_REVERSAL'].includes(j.source.type))).toHaveLength(2);
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(tbRow(t, '1010').debitPaise).toBe(tbRow(t, '1010').creditPaise); // net zero, both entries preserved
  });
  it('cannot reverse a reconciled payment', async () => {
    const { c1 } = await activeGroup();
    const p = (await pay(col, c1, { mode: 'UPI', reference: 'UTR-9', amountPaise: INSTALMENT })).body.payment;
    const imp = await fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: INSTALMENT, reference: 'UTR-9' }] });
    expect(imp.body.added).toBe(1);
    const line = (await fm.get('/reconciliation/bank-lines')).body.items[0];
    await fm.post('/reconciliation/match', { paymentId: p.id, bankLineId: line.id });
    const res = await fm.post(`/payments/${p.id}/reversal-request`, { reason: 'Customer dispute' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECONCILED');
  });
});

describe('reconciliation', () => {
  it('queues non-cash payments, suggests matches, and matches exact amounts', async () => {
    const { c1 } = await activeGroup();
    await pay(col, c1, { amountPaise: 1000000 }); // cash: not applicable
    const p = (await pay(col, c1, { mode: 'UPI', reference: 'UTR-77', amountPaise: 2000000 })).body.payment;
    let q = (await fm.get('/reconciliation/queue')).body;
    expect(q.total).toBe(1);
    expect(q.items[0].id).toBe(p.id);
    await fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 2000000, reference: 'utr-77' }] });
    q = (await fm.get('/reconciliation/queue')).body;
    expect(q.items[0].suggestion.differencePaise).toBe(0);
    const lineId = q.items[0].suggestion.bankLineId;
    const m = await fm.post('/reconciliation/match', { paymentId: p.id, bankLineId: lineId });
    expect(m.status).toBe(201);
    expect(m.body.result).toBe('MATCHED');
    expect((await fm.get('/reconciliation/queue')).body.total).toBe(0);
    expect((await fm.get(`/payments/${p.id}`)).body.payment.reconciliationStatus).toBe('MATCHED');
  });
  it('records a visible exception when amounts differ and demands a comment', async () => {
    const { c1 } = await activeGroup();
    const p = (await pay(col, c1, { mode: 'BANK_TRANSFER', reference: 'NEFT-1', amountPaise: 2000000 })).body.payment;
    await fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 1900000, reference: 'NEFT-1' }] });
    const line = (await fm.get('/reconciliation/bank-lines')).body.items[0];
    expect((await fm.post('/reconciliation/match', { paymentId: p.id, bankLineId: line.id })).status).toBe(400);
    const m = await fm.post('/reconciliation/match', { paymentId: p.id, bankLineId: line.id, comment: 'Bank charges deducted' });
    expect(m.body.result).toBe('EXCEPTION');
    expect(m.body.differencePaise).toBe(-100000);
    expect((await fm.get('/reconciliation/queue?reconciliationStatus=EXCEPTION')).body.total).toBe(1);
  });
  it('does not allow a statement line to be matched twice, or collectors to reconcile', async () => {
    const { c1 } = await activeGroup();
    const p1 = (await pay(col, c1, { mode: 'UPI', reference: 'A-1', amountPaise: 1000000 })).body.payment;
    const p2 = (await pay(col, c1, { mode: 'UPI', reference: 'A-2', amountPaise: 1000000 })).body.payment;
    await fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 1000000, reference: 'A-1' }] });
    const line = (await fm.get('/reconciliation/bank-lines')).body.items[0];
    expect((await col.post('/reconciliation/match', { paymentId: p1.id, bankLineId: line.id })).status).toBe(403);
    await fm.post('/reconciliation/match', { paymentId: p1.id, bankLineId: line.id });
    expect((await fm.post('/reconciliation/match', { paymentId: p2.id, bankLineId: line.id })).body.error.code).toBe('LINE_ALREADY_MATCHED');
  });
  it('skips duplicate statement lines on re-import', async () => {
    const lines = [{ date: '2026-12-01', amountPaise: 500, reference: 'R-1' }];
    expect((await fm.post('/reconciliation/bank-lines', { lines })).body.added).toBe(1);
    const again = await fm.post('/reconciliation/bank-lines', { lines });
    expect(again.body.added).toBe(0);
    expect(again.body.skipped).toEqual(['R-1']);
  });
});

describe('double-entry accounting', () => {
  const lines = async (amount = 500000) => [
    { accountId: await acct('5100'), debitPaise: amount },
    { accountId: await acct('1020'), creditPaise: amount },
  ];
  const draft = async (over: Record<string, unknown> = {}) =>
    fm.post('/accounting/journals', { date: '2026-12-01', memo: 'Office rent', lines: await lines(), ...over });

  it('rejects unbalanced, one-sided, unknown-account and too-short journals', async () => {
    const bad = await draft({ lines: [{ accountId: await acct('5100'), debitPaise: 500 }, { accountId: await acct('1020'), creditPaise: 400 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/balance/i);
    expect((await draft({ lines: [{ accountId: await acct('5100'), debitPaise: 500, creditPaise: 500 }, { accountId: await acct('1020'), creditPaise: 0, debitPaise: 0 }] })).status).toBe(400);
    expect((await draft({ lines: [{ accountId: 'nope', debitPaise: 5 }, { accountId: await acct('1020'), creditPaise: 5 }] })).status).toBe(400);
    expect((await draft({ lines: [{ accountId: await acct('5100'), debitPaise: 5 }] })).status).toBe(400);
    expect((await draft({ lines: [{ accountId: await acct('5100'), debitPaise: 5.5 }, { accountId: await acct('1020'), creditPaise: 5.5 }] })).status).toBe(400);
  });
  it('runs Draft → Submitted → Approved → Posted with maker-checker and then locks the entry', async () => {
    const j = (await draft()).body;
    expect(j.status).toBe('DRAFT');
    expect((await fm.put(`/accounting/journals/${j.id}`, { date: '2026-12-01', memo: 'Office rent (edited)', lines: await lines(600000) })).status).toBe(200);
    const sub = await fm.post(`/accounting/journals/${j.id}/submit`);
    expect(sub.body.status).toBe('SUBMITTED');
    expect((await fm.put(`/accounting/journals/${j.id}`, { date: '2026-12-01', memo: 'sneaky edit', lines: await lines() })).status).toBe(409);
    const reqId = sub.body.approvalRequests[0].id;
    expect((await fm.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' })).status).toBe(403); // maker lacks approve permission
    const posted = await fc.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' });
    expect(posted.status).toBe(200);
    const after = (await fc.get(`/accounting/journals/${j.id}`)).body;
    expect(after.status).toBe('POSTED');
    expect(after.history.map((h: { to: string }) => h.to)).toEqual(['SUBMITTED', 'APPROVED', 'POSTED']);
    const edit = await fm.put(`/accounting/journals/${j.id}`, { date: '2026-12-01', memo: 'late edit', lines: await lines() });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('READ_ONLY');
    expect(tbRow(await tb(), '5100').debitPaise).toBe(600000);
  });
  it('blocks a user holding both roles from approving their own journal', async () => {
    const j = (await both.post('/accounting/journals', { date: '2026-12-01', memo: 'Self approve test', lines: await lines() })).body;
    const sub = await both.post(`/accounting/journals/${j.id}/submit`);
    const self = await both.post(`/approvals/${sub.body.approvalRequests[0].id}/decision`, { decision: 'APPROVED' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('MAKER_CHECKER');
  });
  it('corrects a posted journal only through an approved reversal, keeping both entries', async () => {
    const j = (await draft()).body;
    const sub = await fm.post(`/accounting/journals/${j.id}/submit`);
    await fc.post(`/approvals/${sub.body.approvalRequests[0].id}/decision`, { decision: 'APPROVED' });
    expect((await fm.post(`/accounting/journals/${j.id}/reversal-request`, {})).status).toBe(400); // reason required
    const rr = await fm.post(`/accounting/journals/${j.id}/reversal-request`, { reason: 'Wrong account' });
    expect(rr.status).toBe(201);
    expect((await fm.post(`/accounting/journals/${j.id}/reversal-request`, { reason: 'again' })).body.error.code).toBe('DUPLICATE_REQUEST');
    await fc.post(`/approvals/${rr.body.request.id}/decision`, { decision: 'APPROVED', comment: 'ok' });
    const orig = (await fc.get(`/accounting/journals/${j.id}`)).body;
    expect(orig.status).toBe('REVERSED');
    const rev = (await fc.get(`/accounting/journals/${orig.reversedBy}`)).body;
    expect(rev.status).toBe('POSTED');
    expect(rev.reversalOf).toBe(j.id);
    expect(rev.lines[0].creditPaise).toBe(500000); // sides swapped
    expect((await fm.post(`/accounting/journals/${rev.id}/reversal-request`, { reason: 'undo undo' })).status).toBe(409);
    const t = await tb();
    expect(tbRow(t, '5100').debitPaise).toBe(tbRow(t, '5100').creditPaise);
  });
  it('sends payment journals to the payment reversal workflow instead', async () => {
    const { c1 } = await activeGroup();
    const p = (await pay(col, c1)).body.payment;
    const jid = (await fm.get(`/payments/${p.id}`)).body.journal.id;
    expect((await fm.post(`/accounting/journals/${jid}/reversal-request`, { reason: 'try shortcut' })).body.error.code).toBe('USE_PAYMENT_REVERSAL');
  });
  it('controls periods: cannot close with unposted journals, closed periods reject entries, reopening needs a reason', async () => {
    const dec = (await fm.get('/accounting/periods')).body.items.find((p: { name: string }) => p.name === 'Dec 2026');
    await draft();
    const blocked = await fc.post(`/accounting/periods/${dec.id}/close`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('OPEN_JOURNALS');
    expect((await fm.post(`/accounting/periods/${dec.id}/close`)).status).toBe(403);

    const jan = (await fm.get('/accounting/periods')).body.items.find((p: { name: string }) => p.name === 'Jan 2027');
    expect((await fc.post(`/accounting/periods/${jan.id}/close`)).status).toBe(200);
    const closed = await draft({ date: '2027-01-10' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('PERIOD_CLOSED');
    expect((await fc.post(`/accounting/periods/${jan.id}/reopen`, {})).status).toBe(400);
    expect((await fc.post(`/accounting/periods/${jan.id}/reopen`, { reason: 'Late adjustment' })).body.status).toBe('OPEN');
    expect((await draft({ date: '2027-01-10' })).status).toBe(201);
  });
  it('rejects collections dated in a closed period without changing anything', async () => {
    const { c1 } = await activeGroup();
    const dec = (await fm.get('/accounting/periods')).body.items.find((p: { name: string }) => p.name === 'Dec 2026');
    await fc.post(`/accounting/periods/${dec.id}/close`);
    const res = await pay(col, c1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_CLOSED');
    expect((await col.get('/payments')).body.total).toBe(0);
    expect((await col.get(`/instalments?customerId=${c1}`)).body.items[0].paidPaise).toBe(0);
  });
});

describe('ledger and statements', () => {
  it('reconciles ledger, trial balance and provisional statements with posted journals', async () => {
    const { c1, c2 } = await activeGroup();
    await pay(col, c1, { amountPaise: INSTALMENT });
    await pay(col, c2, { mode: 'UPI', reference: 'UTR-L1', amountPaise: 3000000 });
    const cash = await acct('1010');
    const ledger = (await fm.get(`/accounting/ledger?accountId=${cash}`)).body;
    expect(ledger.items).toHaveLength(1);
    expect(ledger.closingPaise).toBe(INSTALMENT);
    expect(ledger.items[0].balancePaise).toBe(INSTALMENT);
    const t = await tb();
    expect(t.totalDebitPaise).toBe(t.totalCreditPaise);
    expect(t.totalDebitPaise).toBe(INSTALMENT + 3000000);
    expect(tbRow(t, '1010').debitPaise).toBe(ledger.closingPaise);
    const st = (await fm.get('/accounting/statements')).body;
    expect(st.provisional).toBe(true);
    expect(st.balanceSheet.balanced).toBe(true);
    expect(st.balanceSheet.totalAssetsPaise).toBe(INSTALMENT + 3000000);
  });
  it('includes manual income and expense in the provisional P&L', async () => {
    const mk = async (debit: string, credit: string, amount: number) => {
      const j = (await fm.post('/accounting/journals', { date: '2026-12-01', memo: 'Manual entry', lines: [{ accountId: await acct(debit), debitPaise: amount }, { accountId: await acct(credit), creditPaise: amount }] })).body;
      const sub = await fm.post(`/accounting/journals/${j.id}/submit`);
      await fc.post(`/approvals/${sub.body.approvalRequests[0].id}/decision`, { decision: 'APPROVED' });
    };
    await mk('1020', '4100', 900000);
    await mk('5100', '1020', 300000);
    const st = (await fm.get('/accounting/statements')).body;
    expect(st.profitAndLoss.totalIncomePaise).toBe(900000);
    expect(st.profitAndLoss.totalExpensePaise).toBe(300000);
    expect(st.profitAndLoss.netPaise).toBe(600000);
    expect(st.balanceSheet.balanced).toBe(true);
  });
  it('limits accounting access by permission', async () => {
    expect((await as('u-audit').get('/accounting/trial-balance')).status).toBe(200);
    expect((await as('u-audit').post('/accounting/journals', {})).status).toBe(403);
    expect((await col.get('/accounting/journals')).status).toBe(403);
    expect((await col.get('/reconciliation/queue')).status).toBe(403);
  });
  it('shows placeholder chart and posting rules as unapproved', async () => {
    expect((await fm.get('/accounting/accounts')).body.placeholder).toBe(true);
    expect((await fm.get('/accounting/posting-rules')).body.placeholder).toBe(true);
  });
});

describe('summary and arrears', () => {
  it('reports due, collected, outstanding and overdue and lists arrears by customer', async () => {
    const { c1 } = await activeGroup();
    await pay(col, c1, { amountPaise: 4000000 });
    today = '2026-12-10';
    const sum = (await col.get('/instalments/summary')).body;
    expect(sum.dueToDatePaise).toBe(2 * INSTALMENT);
    expect(sum.collectedAgainstDuePaise).toBe(4000000);
    expect(sum.outstandingDuePaise).toBe(2 * INSTALMENT - 4000000);
    expect(sum.overdueCount).toBe(2);
    const arrears = (await col.get('/instalments/arrears')).body;
    expect(arrears.total).toBe(2);
    expect(arrears.items.find((a: { customerId: string }) => a.customerId === c1).overduePaise).toBe(INSTALMENT - 4000000);
  });
});
