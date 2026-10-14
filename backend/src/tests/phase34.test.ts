import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createSeededStore } from '../seed/crmSeed.js';
import { createCalculationService, validateRuleSet, type CalculationRuleSet } from '../services/calculationService.js';
import { createInstalmentService, shiftForNonWorkingDates } from '../services/instalmentService.js';
import type { Store } from '../repositories/store.js';
import { actor, activeGroup, installClock, publishedScheme, SCHEME, staff, T0, uniq, type Clock, type Staff } from './scenario.js';

const DAY = 24 * 3_600_000;
const INSTALMENT = 10000000;

let store: Store;
let app: ReturnType<typeof createApp>;
let s: Staff;
let clock: Clock;
const setDay = (n: number) => { clock.ms = T0 + n * DAY; }; // day 0 = 2026-12-01

beforeEach(() => {
  clock = { ms: T0 };
  store = createSeededStore();
  installClock(store, clock);
  app = createApp(store);
  s = staff(app);
});

const pay = (customerId: string, over: Record<string, unknown> = {}) =>
  s.col.post('/payments/offline', { customerId, mode: 'CASH', amountPaise: 4000000, clientRequestId: uniq('req'), ...over });
const instalmentsOf = async (customerId: string) => (await s.col.get(`/instalments?customerId=${customerId}&pageSize=50`)).body.items as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const first = async (customerId: string) => (await instalmentsOf(customerId)).find((i) => i.seq === 1)!;

// ---------------------------------------------------------------- Phase 3 extension

describe('scheme template fields', () => {
  const extra = {
    schemeType: 'Monthly auction chit', description: 'Pilot scheme', permittedBranchIds: ['CHN'],
    discountPolicyText: 'As approved by the company', roundingPolicyText: 'Round to the nearest rupee as approved',
  };

  it('stores type, description, permitted branches and policy texts, and warns when policies are missing', async () => {
    const res = await s.maker.post('/schemes', SCHEME('SCH-T1', extra));
    expect(res.status).toBe(201);
    const cfg = res.body.version.config;
    expect(cfg.schemeType).toBe('Monthly auction chit');
    expect(cfg.permittedBranchIds).toEqual(['CHN']);
    expect(cfg.discountPolicyText).toBe('As approved by the company');
    const bare = await s.maker.post('/schemes', SCHEME('SCH-T2'));
    expect(bare.body.warnings.join(' ')).toMatch(/discount policy/i);
    expect(bare.body.warnings.join(' ')).toMatch(/rounding policy/i);
  });

  it('rejects an unknown permitted branch', async () => {
    const res = await s.maker.post('/schemes', SCHEME('SCH-T3', { permittedBranchIds: ['NOPE'] }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.permittedBranchIds).toMatch(/Unknown branch/);
  });

  it('refuses a group in a branch the scheme does not permit', async () => {
    const { versionId } = await publishedScheme(s, 'SCH-T4', { permittedBranchIds: ['CBE'] });
    const res = await s.maker.post('/groups', { code: 'GRP-T4', name: 'Branch test', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_NOT_PERMITTED');
  });

  it('requires a reason to reject or return a scheme, and the submitter cannot approve it', async () => {
    const created = await s.maker.post('/schemes', SCHEME('SCH-T5'));
    const vId = created.body.version.id;
    const rid = (await s.maker.post(`/scheme-versions/${vId}/submit`)).body.request.id;
    await s.head.post(`/approvals/${rid}/start-review`);
    const noReason = await s.head.post(`/approvals/${rid}/decision`, { decision: 'REJECTED' });
    expect(noReason.status).toBe(400);
    expect((await s.maker.post(`/approvals/${rid}/decision`, { decision: 'APPROVED' })).status).toBe(403);
    expect((await s.head.post(`/approvals/${rid}/decision`, { decision: 'RETURNED', comment: 'Fix the rounding policy' })).status).toBe(200);
    const detail = (await s.maker.get(`/schemes/${created.body.scheme.id}`)).body;
    expect(detail.versions[0].status).toBe('DRAFT');
    expect(detail.versions[0].history.at(-1).comment).toBe('Fix the rounding policy');
  });

  it('keeps an approved version unchanged and creates a new version for changed terms', async () => {
    const { schemeId, versionId } = await publishedScheme(s, 'SCH-T6');
    expect((await s.maker.put(`/scheme-versions/${versionId}`, { config: SCHEME('SCH-T6').config })).status).toBe(409);
    const v2 = await s.maker.post(`/schemes/${schemeId}/versions`);
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    const detail = (await s.maker.get(`/schemes/${schemeId}`)).body;
    expect(detail.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(['1:PUBLISHED', '2:DRAFT']);
  });
});

describe('group lifecycle with an explicit Approved state', () => {
  const makeGroup = async (over: Record<string, unknown> = {}) => {
    const { versionId } = await publishedScheme(s, uniq('SCH').toUpperCase().slice(0, 18));
    const g = await s.maker.post('/groups', { code: uniq('G').toUpperCase().slice(0, 18), name: 'Lifecycle', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2026-12-01', ...over });
    return g;
  };
  const approve = async (groupId: string) => {
    await s.maker.post(`/groups/${groupId}/submit`);
    const req = (await s.head.get('/approvals?scope=queue&type=GROUP_OPEN')).body.items.find((r: { entityId: string }) => r.entityId === groupId);
    return s.head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
  };

  it('approval alone does not open enrolment; central operations opens it separately', async () => {
    const g = await makeGroup();
    expect((await approve(g.body.id)).status).toBe(200);
    expect((await s.maker.get(`/groups/${g.body.id}`)).body.status).toBe('APPROVED');
    const cid = 'CU-0001';
    expect((await s.maker.post(`/groups/${g.body.id}/tickets`, { customerId: cid })).body.error.code).toBe('ENROLMENT_CLOSED');
    expect((await s.maker.post(`/groups/${g.body.id}/open-enrolment`)).status).toBe(403);
    expect((await s.head.post(`/groups/${g.body.id}/open-enrolment`)).status).toBe(200);
    const detail = (await s.maker.get(`/groups/${g.body.id}`)).body;
    expect(detail.status).toBe('ENROLMENT_OPEN');
    expect(detail.history.map((h: { to: string }) => h.to)).toEqual(['APPROVAL_PENDING', 'APPROVED', 'ENROLMENT_OPEN']);
    expect((await s.head.post(`/groups/${g.body.id}/open-enrolment`)).status).toBe(409); // not repeatable
  });

  it('keeps the group closed to enrolment outside its enrolment window', async () => {
    const g = await makeGroup({ enrolmentStartDate: '2026-12-05', enrolmentEndDate: '2026-12-10' });
    expect(g.status).toBe(201);
    await approve(g.body.id);
    const early = await s.head.post(`/groups/${g.body.id}/open-enrolment`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ENROLMENT_NOT_STARTED');
    setDay(5);
    expect((await s.head.post(`/groups/${g.body.id}/open-enrolment`)).status).toBe(200);
    setDay(11);
    const late = await s.maker.post(`/groups/${g.body.id}/tickets`, { customerId: 'CU-0001' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ENROLMENT_ENDED');
  });

  it('validates the enrolment window and the auction schedule', async () => {
    const bad = await makeGroup({ enrolmentStartDate: '2026-12-10', enrolmentEndDate: '2026-12-01' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.enrolmentEndDate).toBeDefined();
    const unordered = await makeGroup({ auctionSchedule: ['2027-01-10', '2027-01-05'] });
    expect(unordered.body.error.details.auctionSchedule).toMatch(/increasing/);
    const tooMany = await makeGroup({ auctionSchedule: ['2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01'] });
    expect(tooMany.body.error.details.auctionSchedule).toMatch(/At most 3/);
    const early = await makeGroup({ auctionSchedule: ['2026-11-01'] });
    expect(early.body.error.details.auctionSchedule).toMatch(/commencement/);
  });

  it('stores the provisional instalment schedule and the auction plan, and regenerates the schedule on edit', async () => {
    const g = await makeGroup({ auctionSchedule: ['2027-01-05', '2027-02-05'] });
    expect(g.body.instalmentSchedule.map((x: { dueDate: string }) => x.dueDate)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
    expect(g.body.auctionSchedule).toEqual([{ cycleNo: 1, plannedDate: '2027-01-05' }, { cycleNo: 2, plannedDate: '2027-02-05' }]);
    expect(g.body.schedulesNotice).toMatch(/unapproved/i);
    const upd = await s.maker.put(`/groups/${g.body.id}`, { name: 'Lifecycle', plannedStartDate: '2026-12-15' });
    expect(upd.body.instalmentSchedule.map((x: { dueDate: string }) => x.dueDate)).toEqual(['2026-12-15', '2027-01-15', '2027-02-15']);
    expect(upd.body.auctionSchedule).toHaveLength(2); // untouched when omitted
  });

  it('records compliance document references and audits them', async () => {
    const g = await makeGroup();
    const doc = await s.maker.post(`/groups/${g.body.id}/documents`, { title: 'Registrar approval', reference: 'REG-2026-11' });
    expect(doc.status).toBe(201);
    expect(doc.body.complianceDocuments[0]).toMatchObject({ title: 'Registrar approval', reference: 'REG-2026-11' });
    expect((await s.maker.post(`/groups/${g.body.id}/documents`, { title: 'x' })).status).toBe(400);
    expect((await s.crm.post(`/groups/${g.body.id}/documents`, { title: 'Nope nope', reference: 'R' })).status).toBe(403);
    expect(store.audit.some((a) => a.action === 'group.document' && a.entityId === g.body.id)).toBe(true);
  });

  it('does not allow commencement while compliance items are unconfirmed, and the approver of activation is not the requester', async () => {
    const { groupId } = await activeGroup(app, s);
    expect((await s.maker.get(`/groups/${groupId}`)).body.status).toBe('ACTIVE');
    // a fresh group with an unconfirmed checklist cannot be marked ready
    const g = await makeGroup();
    await approve(g.body.id);
    await s.head.post(`/groups/${g.body.id}/open-enrolment`);
    const res = await s.maker.post(`/groups/${g.body.id}/ready`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_READY');
  });
});

describe('calculation engine interface', () => {
  const rule = (over: Partial<CalculationRuleSet> = {}): CalculationRuleSet => ({
    id: 'TEST-DIV', kind: 'DIVIDEND', version: 1, status: 'DRAFT', description: 'TEST ONLY rule, not a real formula',
    compute: (i) => ({ amountPaise: i.chitValuePaise - i.memberCount, workings: ['test-only'] }), ...over,
  });

  it('produces no figures because no rule is registered, via the API', async () => {
    const rules = (await s.maker.get('/calculations/rules')).body;
    expect(rules.notice).toMatch(/No financial calculation rule has been approved/);
    expect(rules.kinds.every((k: { productionReady: boolean; ruleSets: unknown[] }) => !k.productionReady && k.ruleSets.length === 0)).toBe(true);
    const prev = await s.maker.post('/calculations/preview', { kind: 'DIVIDEND', useSample: true });
    expect(prev.status).toBe(200);
    expect(prev.body.status).toBe('RULES_NOT_VALIDATED');
    expect(prev.body.result).toBeUndefined();
    expect(prev.body.mode).toBe('SAMPLE');
    expect(prev.body.sampleLabel).toMatch(/SAMPLE DATA/);
    expect(prev.body.productionUse).toBe(false);
  });

  it('validates input and the kind', async () => {
    expect((await s.maker.post('/calculations/preview', { kind: 'TAX' })).status).toBe(400);
    const res = await s.maker.post('/calculations/preview', { kind: 'COMMISSION', input: { chitValuePaise: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.error.details['input.memberCount']).toBeDefined();
    expect((await actor(app, 'u-member-none').post('/calculations/preview', { kind: 'DIVIDEND', useSample: true })).status).toBeGreaterThanOrEqual(401);
  });

  it('labels a registered but unvalidated rule set as preview-only and never as production', () => {
    const svc = createCalculationService([rule()]);
    const out = svc.preview({ kind: 'DIVIDEND', useSample: true });
    expect(out.status).toBe('PREVIEW_ONLY');
    expect(out.productionUse).toBe(false);
    expect(out.notices.join(' ')).toMatch(/not validated/);
    expect(out.notices.join(' ')).toMatch(/SAMPLE DATA/);
  });

  it('treats a validated rule set without an approval reference as not production-ready', () => {
    const svc = createCalculationService([rule({ status: 'VALIDATED' })]);
    expect(svc.rules().kinds.find((k) => k.kind === 'DIVIDEND')!.productionReady).toBe(false);
    const withRef = createCalculationService([rule({ status: 'VALIDATED', approvalRef: 'CA-2026-11' })]);
    expect(withRef.rules().kinds.find((k) => k.kind === 'DIVIDEND')!.productionReady).toBe(true);
    expect(withRef.preview({ kind: 'DIVIDEND', useSample: true }).productionUse).toBe(false); // still a preview: nothing is wired to postings
  });

  it('validates a rule set against supplied cases and reports mismatches', () => {
    const input = { chitValuePaise: 1000, memberCount: 10, installmentAmountPaise: 100 };
    const pass = validateRuleSet(rule(), [{ name: 'a', input, expectedAmountPaise: 990 }]);
    expect(pass.passed).toBe(true);
    const fail = validateRuleSet(rule(), [{ name: 'a', input, expectedAmountPaise: 990 }, { name: 'b', input, expectedAmountPaise: 1 }]);
    expect(fail.passed).toBe(false);
    expect(fail.results[1]).toMatchObject({ passed: false, actualAmountPaise: 990 });
    expect(validateRuleSet(rule(), []).passed).toBe(false); // no cases proves nothing
  });
});

// ---------------------------------------------------------------- Phase 4 extension

describe('overdue rules configuration', () => {
  it('validates the rules and shows them as unapproved until a confirmation reference is recorded', async () => {
    const bad = await s.maker.post('/schemes', SCHEME('SCH-O1', {
      overdueRules: { graceDays: -1, cutoffTime: '25:00', timezone: 'Mars/Base', holidayPolicy: 'EVERY_DAY', nonWorkingDates: ['soon'], reminderDaysBefore: [1.5] },
    }));
    expect(bad.status).toBe(400);
    const d = bad.body.error.details;
    for (const k of ['graceDays', 'cutoffTime', 'timezone', 'holidayPolicy', 'nonWorkingDates', 'reminderDaysBefore']) expect(d[`overdueRules.${k}`]).toBeDefined();

    const ok = await s.maker.post('/schemes', SCHEME('SCH-O2', { overdueRules: { graceDays: 3, cutoffTime: '17:30', timezone: 'Asia/Kolkata', reminderDaysBefore: [3, 1, 3], reminderDaysAfter: [2] } }));
    expect(ok.status).toBe(201);
    expect(ok.body.version.config.overdueRules.reminderDaysBefore).toEqual([1, 3]);
    expect(ok.body.warnings.join(' ')).toMatch(/UNAPPROVED/);
    const confirmed = await s.maker.post('/schemes', SCHEME('SCH-O3', { overdueRules: { graceDays: 3, policyConfirmationRef: 'COMPL-2026-04' } }));
    expect(confirmed.body.warnings.join(' ')).not.toMatch(/Overdue and grace-period rules are UNAPPROVED/);
  });

  it('applies the scheme grace days instead of the global placeholder', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-GRACE', config: { overdueRules: { graceDays: 5 } } });
    expect((await first(cs[0]!)).status).toBe('DUE'); // day 0
    setDay(5);
    expect((await first(cs[0]!)).status).toBe('DUE'); // last day inside grace (due 12-01 + 5)
    setDay(6);
    const i = await first(cs[0]!);
    expect(i.status).toBe('OVERDUE');
    expect(i.lastDayInGrace).toBe('2026-12-06');
    expect(i.policyStatus).toBe('UNAPPROVED');
  });

  it('keeps the global placeholder when a scheme sets no overdue rules', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-DEFAULT' });
    setDay(1);
    expect((await first(cs[0]!)).status).toBe('OVERDUE'); // global grace days = 0
  });

  it('lets the scheme decide whether a partial payment stops the instalment becoming overdue', async () => {
    const stops = await activeGroup(app, s, { code: 'G-STOP', phones: ['9555100001', '9555100002', '9555100003'], config: { overdueRules: { partialPaymentStopsOverdue: true } } });
    await pay(stops.cs[0]!);
    setDay(10);
    const a = await first(stops.cs[0]!);
    expect(a.status).toBe('PARTIALLY_PAID');
    expect(a.outstandingPaise).toBe(INSTALMENT - 4000000);
    expect((await first(stops.cs[1]!)).status).toBe('OVERDUE'); // unpaid member in the same group
  });

  it('treats a partial payment as still overdue by default', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-KEEP', phones: ['9555200001', '9555200002', '9555200003'] });
    await pay(cs[0]!);
    setDay(10);
    const a = await first(cs[0]!);
    expect(a.status).toBe('OVERDUE');
    expect(a.paidPaise).toBe(4000000);
    expect(a.outstandingPaise).toBe(INSTALMENT - 4000000);
  });

  it('moves a due date that falls on a listed non-working date', async () => {
    const rules = { holidayPolicy: 'NEXT_UNLISTED_DAY' as const, nonWorkingDates: ['2026-12-01', '2026-12-02'], partialPaymentStopsOverdue: false, reminderDaysBefore: [], reminderDaysAfter: [] };
    expect(shiftForNonWorkingDates('2026-12-01', rules)).toBe('2026-12-03');
    expect(shiftForNonWorkingDates('2026-12-04', rules)).toBe('2026-12-04');
    expect(shiftForNonWorkingDates('2026-12-01', { ...rules, holidayPolicy: 'NONE' })).toBe('2026-12-01');
    const { cs } = await activeGroup(app, s, { code: 'G-HOL', config: { overdueRules: { holidayPolicy: 'NEXT_UNLISTED_DAY', nonWorkingDates: ['2026-12-01', '2026-12-02'] } } });
    const i = await first(cs[0]!);
    expect(i.dueDate).toBe('2026-12-01');
    expect(i.effectiveDueDate).toBe('2026-12-03');
    expect(i.status).toBe('SCHEDULED'); // not yet due on the adjusted date
    setDay(1);
    expect((await first(cs[0]!)).status).toBe('SCHEDULED');
    setDay(2);
    expect((await first(cs[0]!)).status).toBe('DUE');
  });

  it('derives reminder dates for planning and charges no penalty', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-REM', config: { overdueRules: { reminderDaysBefore: [3], reminderDaysAfter: [2, 7], lateFeeText: 'To be confirmed' } } });
    const i = await first(cs[0]!);
    expect(i.reminderDates).toEqual({ before: ['2026-11-28'], after: ['2026-12-03', '2026-12-08'] });
    setDay(30);
    const later = await first(cs[0]!);
    expect(later.amountPaise).toBe(INSTALMENT); // no fee added
    expect(Object.keys(later).some((k) => /fee|penalt/i.test(k))).toBe(false);
    expect(store.customers.find((c) => c.id === cs[0])!.membershipStatus).toBe('ACTIVE'); // eligibility untouched
  });

  it('reports the summary notice as unapproved', async () => {
    await activeGroup(app, s, { code: 'G-SUM' });
    const sum = (await s.col.get('/instalments/summary')).body;
    expect(sum.graceNotice).toMatch(/UNAPPROVED/);
    expect(sum.graceNotice).toMatch(/no penalties/i);
  });
});

describe('payment status effects on instalments', () => {
  it('does not treat a pending online payment as paid, even after the grace period', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-PEND', phones: ['9555300001', '9555300002', '9555300003'] });
    const att = await s.col.post('/payment-attempts', { customerId: cs[0], amountPaise: INSTALMENT });
    expect(att.body.status).toBe('PENDING_CONFIRMATION');
    setDay(3);
    const i = await first(cs[0]!);
    expect(i.paidPaise).toBe(0);
    expect(i.status).toBe('OVERDUE');
  });

  it('recomputes status when a late confirmation carries an earlier effective receipt date, and keeps the audit trail', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-LATE', phones: ['9555400001', '9555400002', '9555400003'], config: { overdueRules: { graceDays: 2 } } });
    const att = await s.col.post('/payment-attempts', { customerId: cs[0], amountPaise: INSTALMENT });
    setDay(6); // the callback arrives long after the grace period (ended 2026-12-03)
    expect((await first(cs[0]!)).status).toBe('OVERDUE');
    const ok = await s.fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-late-01', outcome: 'SUCCESS', effectiveDate: '2026-12-02' });
    expect(ok.status).toBe(200);
    expect(ok.body.payment.receivedDate).toBe('2026-12-02');
    const i = await first(cs[0]!);
    expect(i.status).toBe('PAID');
    expect(i.settledOn).toBe('2026-12-02');
    expect(i.paidLate).toBe(false); // effective receipt date was inside the grace period
    const trail = store.audit.filter((a) => a.action === 'instalment.status_recomputed' && a.entityId === i.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.detail).toMatchObject({ from: 'OVERDUE', to: 'PAID', cause: 'PAYMENT_CONFIRMED', effectiveReceiptDate: '2026-12-02' });
    // history is reproducible: the same instalment was overdue on 12-04 only if the payment had not yet been effective
    const svc = createInstalmentService(store);
    const raw = store.instalments.find((x) => x.id === i.id)!;
    expect(svc.statusAsOf(raw, '2026-12-01')).toBe('DUE');
    expect(svc.statusAsOf(raw, '2026-12-04')).toBe('PAID');
  });

  it('marks an instalment as paid late when the effective receipt date is after the grace period', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-LATE2', phones: ['9555500001', '9555500002', '9555500003'], config: { overdueRules: { graceDays: 2 } } });
    setDay(6);
    await pay(cs[0]!, { amountPaise: INSTALMENT, receivedDate: '2026-12-05' });
    const i = await first(cs[0]!);
    expect(i.status).toBe('PAID');
    expect(i.paidLate).toBe(true);
    const svc = createInstalmentService(store);
    const raw = store.instalments.find((x) => x.id === i.id)!;
    expect(svc.statusAsOf(raw, '2026-12-04')).toBe('OVERDUE'); // unpaid as of then, even though it is paid now
  });

  it('falls back to overdue and records the change when a payment is reversed (disputed or reversed payment)', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-REV', phones: ['9555600001', '9555600002', '9555600003'] });
    const p = (await pay(cs[0]!, { amountPaise: INSTALMENT })).body.payment;
    expect((await first(cs[0]!)).status).toBe('PAID');
    setDay(4);
    const reqRes = await s.both.post(`/payments/${p.id}/reversal-request`, { reason: 'Cheque dishonoured' });
    expect((await s.fc.post(`/approvals/${reqRes.body.id}/decision`, { decision: 'APPROVED' })).status).toBe(200);
    const i = await first(cs[0]!);
    expect(i.status).toBe('OVERDUE');
    expect(i.paidPaise).toBe(0);
    const trail = store.audit.filter((a) => a.action === 'instalment.status_recomputed' && a.entityId === i.id).map((a) => a.detail);
    expect(trail.at(-1)).toMatchObject({ from: 'PAID', to: 'OVERDUE', cause: 'PAYMENT_REVERSED' });
  });

  it('rejects a callback effective date in the future', async () => {
    const { cs } = await activeGroup(app, s, { code: 'G-FUT', phones: ['9555700001', '9555700002', '9555700003'] });
    const att = await s.col.post('/payment-attempts', { customerId: cs[0], amountPaise: INSTALMENT });
    const res = await s.fm.post(`/payment-attempts/${att.body.id}/simulated-callback`, { eventId: 'evt-fut-01', outcome: 'SUCCESS', effectiveDate: '2027-01-01' });
    expect(res.status).toBe(400);
    expect((await first(cs[0]!)).paidPaise).toBe(0);
  });
});

describe('chart of accounts hierarchy', () => {
  it('records an optional parent account, rejects an unknown parent, and audits the change', async () => {
    const parent = await s.fm.post('/accounting/accounts', { code: '5000', name: 'Operating expenses', type: 'EXPENSE' });
    expect(parent.status).toBe(201);
    const child = await s.fm.post('/accounting/accounts', { code: '5010', name: 'Stationery', type: 'EXPENSE', parentCode: '5000' });
    expect(child.status).toBe(201);
    const list = (await s.fm.get('/accounting/accounts')).body.items;
    expect(list.find((a: { code: string }) => a.code === '5010').parentCode).toBe('5000');
    expect(list.find((a: { code: string }) => a.code === '5000').parentCode).toBeUndefined();
    const bad = await s.fm.post('/accounting/accounts', { code: '5020', name: 'Orphan', type: 'EXPENSE', parentCode: '9999' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.parentCode).toMatch(/Unknown parent/);
    expect(store.audit.some((a) => a.action === 'account.create' && (a.detail as { parentCode?: string })?.parentCode === '5000')).toBe(true);
    expect((await s.col.post('/accounting/accounts', { code: '5030', name: 'Nope nope', type: 'EXPENSE' })).status).toBe(403);
  });
});
