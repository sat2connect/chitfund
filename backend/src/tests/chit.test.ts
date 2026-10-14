import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
beforeEach(() => { app = createApp(); });

const as = (user: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-dev-user', user),
  post: (p: string, b: object = {}) => request(app).post(`/api/v1${p}`).set('x-dev-user', user).send(b),
  put: (p: string, b: object = {}) => request(app).put(`/api/v1${p}`).set('x-dev-user', user).send(b),
});
const ops = as('u-chitops'); // maker (Chennai)
const head = as('u-ops'); // central approver
const crm = as('u-crm-chn');

const schemeBody = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) => ({
  code: 'SCH-A',
  config: {
    name: 'Test Scheme', jurisdiction: 'TAMIL_NADU', chitValuePaise: 20000000, memberCount: 2,
    installmentAmountPaise: 10000000, frequency: 'MONTHLY', tenureMonths: 2,
    auction: { mode: 'STAFF_ASSISTED' }, dividendRuleText: 'As approved (text)', commissionRuleText: 'As approved (text)',
    requiredDocuments: [], complianceChecklist: ['Chit agreement executed'], effectiveFrom: '2026-01-01', effectiveTo: '2030-12-31',
    ...cfg,
  },
  ...over,
});

async function approvedScheme(body = schemeBody()) {
  const created = await ops.post('/schemes', body);
  const versionId = created.body.version.id;
  const sub = await ops.post(`/scheme-versions/${versionId}/submit`);
  const reqId = sub.body.request.id;
  await head.post(`/approvals/${reqId}/start-review`);
  await head.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' });
  return { schemeId: created.body.scheme.id, versionId, reqId };
}
async function publishedScheme(body = schemeBody()) {
  const s = await approvedScheme(body);
  const pub = await head.post(`/scheme-versions/${s.versionId}/publish`);
  return { ...s, pub };
}

async function verifiedCustomer(phone: string) {
  const { body: lead } = await crm.post('/leads', { name: 'Member ' + phone, phone, source: 'WALK_IN', branchId: 'CHN' });
  for (const to of ['CONTACTED', 'INTERESTED', 'REGISTRATION_PENDING']) await crm.post(`/leads/${lead.id}/transition`, { to });
  const { body } = await crm.post(`/leads/${lead.id}/convert`);
  const cid = body.customer.id;
  const kycId = (await crm.get(`/customers/${cid}`)).body.kycCaseId;
  await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'i.pdf' });
  await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'ADDRESS_PROOF', fileName: 'a.pdf' });
  await crm.post(`/kyc-cases/${kycId}/submit`);
  await as('u-kyc').post(`/kyc-cases/${kycId}/decision`, { decision: 'VERIFIED' });
  const a = await crm.post('/memberships/applications', { customerId: cid, preferredScheme: 'Test' });
  await head.post(`/memberships/applications/${a.body.id}/decision`, { decision: 'APPROVED' });
  return cid as string;
}

async function openGroup(versionId: string) {
  const g = await ops.post('/groups', { code: 'GRP-A', name: 'Group A', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
  await ops.post(`/groups/${g.body.id}/submit`);
  const req = (await head.get('/approvals?scope=queue&type=GROUP_OPEN')).body.items[0];
  await head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
  await head.post(`/groups/${g.body.id}/open-enrolment`);
  return g.body.id as string;
}

describe('scheme configuration', () => {
  it('validates fields, including cross-field rules', async () => {
    const res = await ops.post('/schemes', schemeBody({ code: 'bad' }, { chitValuePaise: -5, memberCount: 1, effectiveTo: '2020-01-01', auction: { mode: 'NOPE' } }));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['code', 'chitValuePaise', 'memberCount', 'effectiveTo', 'auction.mode']));
  });
  it('rejects duplicate codes and returns non-blocking warnings', async () => {
    const first = await ops.post('/schemes', schemeBody({}, { tenureMonths: 5 }));
    expect(first.status).toBe(201);
    expect(first.body.warnings.join(' ')).toMatch(/Tenure/);
    expect((await ops.post('/schemes', schemeBody())).body.error.code).toBe('DUPLICATE_CODE');
  });
  it('stores money as integer paise and rejects fractions', async () => {
    const res = await ops.post('/schemes', schemeBody({}, { chitValuePaise: 100.5 }));
    expect(res.status).toBe(400);
  });
  it('is permission protected', async () => {
    expect((await crm.post('/schemes', schemeBody())).status).toBe(403);
    expect((await crm.get('/schemes')).status).toBe(200);
  });
});

describe('scheme versioning and approval', () => {
  it('requires review before decision and forbids reviewing own submission', async () => {
    const created = await as('u-multi').post('/schemes', schemeBody());
    const v = created.body.version.id;
    const sub = await as('u-multi').post(`/scheme-versions/${v}/submit`);
    const reqId = sub.body.request.id;
    const own = await as('u-multi').post(`/approvals/${reqId}/start-review`);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('MAKER_CHECKER');
    const own2 = await as('u-multi').post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' });
    expect(own2.status).toBe(403);
    expect((await head.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' })).body.error.code).toBe('REVIEW_REQUIRED');
  });
  it('maker without approval permission cannot approve', async () => {
    const created = await ops.post('/schemes', schemeBody());
    const sub = await ops.post(`/scheme-versions/${created.body.version.id}/submit`);
    expect((await ops.post(`/approvals/${sub.body.request.id}/decision`, { decision: 'APPROVED' })).status).toBe(403);
  });
  it('runs Draft → Submitted → Under Review → Approved → Published, then locks the version', async () => {
    const { versionId, pub } = await publishedScheme();
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('PUBLISHED');
    expect(pub.body.history.map((h: { to: string }) => h.to)).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED']);
    const edit = await ops.put(`/scheme-versions/${versionId}`, schemeBody());
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('READ_ONLY');
  });
  it('cannot publish an unapproved version', async () => {
    const created = await ops.post('/schemes', schemeBody());
    expect((await head.post(`/scheme-versions/${created.body.version.id}/publish`)).status).toBe(409);
  });
  it('return sends the draft back, keeps request history, and allows edit and resubmission', async () => {
    const created = await ops.post('/schemes', schemeBody());
    const v = created.body.version.id;
    const r1 = (await ops.post(`/scheme-versions/${v}/submit`)).body.request.id;
    await head.post(`/approvals/${r1}/start-review`);
    expect((await head.post(`/approvals/${r1}/decision`, { decision: 'RETURNED' })).status).toBe(400); // comment required
    await head.post(`/approvals/${r1}/decision`, { decision: 'RETURNED', comment: 'Fix tie-break text' });
    const edited = await ops.put(`/scheme-versions/${v}`, schemeBody({}, { tenureMonths: 2 }));
    expect(edited.status).toBe(200);
    const r2 = (await ops.post(`/scheme-versions/${v}/submit`)).body.request;
    expect(r2.id).not.toBe(r1);
    const detail = await ops.get(`/schemes/${created.body.scheme.id}`);
    expect(detail.body.versions[0].approvalRequests).toHaveLength(2);
    expect(detail.body.versions[0].approvalRequests[0].status).toBe('RETURNED');
  });
  it('creates a new version only when no open version exists, preserving old versions', async () => {
    const { schemeId } = await publishedScheme();
    const v2 = await ops.post(`/schemes/${schemeId}/versions`);
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect((await ops.post(`/schemes/${schemeId}/versions`)).body.error.code).toBe('OPEN_VERSION_EXISTS');
    const detail = await ops.get(`/schemes/${schemeId}`);
    expect(detail.body.versions.map((v: { status: string }) => v.status)).toEqual(['PUBLISHED', 'DRAFT']);
  });
  it('lets the maker withdraw a submission', async () => {
    const created = await ops.post('/schemes', schemeBody());
    const v = created.body.version.id;
    await ops.post(`/scheme-versions/${v}/submit`);
    const w = await ops.post(`/scheme-versions/${v}/withdraw`);
    expect(w.status).toBe(200);
    expect(w.body.status).toBe('DRAFT');
  });
});

describe('groups', () => {
  it('cannot be created from an unpublished scheme version', async () => {
    const created = await ops.post('/schemes', schemeBody());
    const res = await ops.post('/groups', { code: 'GRP-X', name: 'Group X', schemeVersionId: created.body.version.id, branchId: 'CHN', plannedStartDate: '2026-12-01' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEME_NOT_PUBLISHED');
  });
  it('enforces scheme effective dates and branch scope', async () => {
    const { versionId } = await publishedScheme();
    const late = await ops.post('/groups', { code: 'GRP-L', name: 'Late', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2035-01-01' });
    expect(late.body.error.code).toBe('OUTSIDE_EFFECTIVE_DATES');
    const other = await ops.post('/groups', { code: 'GRP-O', name: 'Other', schemeVersionId: versionId, branchId: 'CBE', plannedStartDate: '2026-12-01' });
    expect(other.status).toBe(403);
  });
  it('creates tickets and checklist from the pinned scheme version', async () => {
    const { versionId } = await publishedScheme();
    const g = await ops.post('/groups', { code: 'GRP-A', name: 'Group A', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
    expect(g.status).toBe(201);
    expect(g.body.tickets).toHaveLength(2);
    expect(g.body.checklist.map((c: { title: string }) => c.title)).toEqual(['Chit agreement executed']);
    expect(g.body.status).toBe('DRAFT');
    // other-branch users cannot access it
    expect((await as('u-crm-cbe').get(`/groups/${g.body.id}`)).status).toBe(403);
  });
  it('blocks allocation until enrolment is open, and for ineligible customers', async () => {
    const { versionId } = await publishedScheme();
    const g = await ops.post('/groups', { code: 'GRP-A', name: 'Group A', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
    const cid = await verifiedCustomer('9444444441');
    expect((await ops.post(`/groups/${g.body.id}/tickets`, { customerId: cid })).body.error.code).toBe('ENROLMENT_CLOSED');
    await ops.post(`/groups/${g.body.id}/submit`);
    const req = (await head.get('/approvals?scope=queue')).body.items.find((r: { entityType: string }) => r.entityType === 'GROUP_OPEN');
    await head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
    await head.post(`/groups/${g.body.id}/open-enrolment`);
    // seeded customer has no KYC
    const res = await ops.post(`/groups/${g.body.id}/tickets`, { customerId: 'CU-0001' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('KYC_NOT_VERIFIED');
    expect((await ops.post(`/groups/${g.body.id}/tickets`, { customerId: cid })).status).toBe(200);
    expect((await ops.post(`/groups/${g.body.id}/tickets`, { customerId: cid })).body.error.code).toBe('TICKET_LIMIT');
  });
  it('prevents activation until every condition is met, then activates with independent approval', async () => {
    const { versionId } = await publishedScheme();
    const gid = await openGroup(versionId);
    const c1 = await verifiedCustomer('9555555551');
    const c2 = await verifiedCustomer('9555555552');

    const early = await ops.post(`/groups/${gid}/ready`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_READY');

    await ops.post(`/groups/${gid}/tickets`, { customerId: c1 });
    await ops.post(`/groups/${gid}/tickets`, { customerId: c2 });
    expect((await ops.post(`/groups/${gid}/ready`)).body.error.code).toBe('NOT_READY'); // checklist pending

    const detail = (await ops.get(`/groups/${gid}`)).body;
    const item = detail.checklist[0].id;
    expect((await ops.post(`/groups/${gid}/checklist/${item}/confirm`, {})).status).toBe(400); // reference required
    await ops.post(`/groups/${gid}/checklist/${item}/confirm`, { reference: 'AGR-001' });
    expect((await ops.post(`/groups/${gid}/ready`)).body.status).toBe('READY_TO_START');

    const act = await ops.post(`/groups/${gid}/activation-request`);
    expect(act.status).toBe(200);
    expect((await ops.post(`/groups/${gid}/activation-request`)).body.error.code).toBe('DUPLICATE_REQUEST');
    const req = (await head.get('/approvals?scope=queue&type=GROUP_ACTIVATION')).body.items[0];
    expect((await ops.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' })).status).toBe(403);
    const ok = await head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
    expect(ok.status).toBe(200);

    const after = (await head.get(`/groups/${gid}`)).body;
    expect(after.status).toBe('ACTIVE');
    expect((await crm.get(`/customers/${c1}`)).body.customer.membershipStatus).toBe('ACTIVE');
    // Active groups are locked for allocation
    expect((await ops.post(`/groups/${gid}/tickets`, { customerId: c1 })).status).toBe(409);
  });
  it('blocks a maker holding both roles from approving their own activation', async () => {
    const { versionId } = await publishedScheme();
    const g = await as('u-multi').post('/groups', { code: 'GRP-M', name: 'Multi', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
    await as('u-multi').post(`/groups/${g.body.id}/submit`);
    const req = (await head.get('/approvals?scope=queue&type=GROUP_OPEN')).body.items[0];
    const self = await as('u-multi').post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('MAKER_CHECKER');
  });
  it('suspends and resumes an active group with a recorded reason', async () => {
    const { versionId } = await publishedScheme(schemeBody({}, { complianceChecklist: [], minEnrolmentToActivate: 1 }));
    const gid = await openGroup(versionId);
    const c1 = await verifiedCustomer('9666666661');
    await ops.post(`/groups/${gid}/tickets`, { customerId: c1 });
    await ops.post(`/groups/${gid}/ready`);
    await ops.post(`/groups/${gid}/activation-request`);
    const req = (await head.get('/approvals?scope=queue&type=GROUP_ACTIVATION')).body.items[0];
    await head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
    expect((await head.post(`/groups/${gid}/suspend`, {})).status).toBe(400);
    expect((await head.post(`/groups/${gid}/suspend`, { reason: 'Regulatory hold' })).body.status).toBe('SUSPENDED');
    expect((await head.post(`/groups/${gid}/resume`, { reason: 'Cleared' })).body.status).toBe('ACTIVE');
  });
});

describe('approval centre', () => {
  it('filters by scope and preserves decided items as history', async () => {
    const { reqId } = await approvedScheme();
    expect((await head.get('/approvals?scope=history')).body.items.map((r: { id: string }) => r.id)).toContain(reqId);
    expect((await ops.get('/approvals?scope=mine')).body.total).toBeGreaterThan(0);
    expect((await head.get('/approvals?scope=queue')).body.items.find((r: { id: string }) => r.id === reqId)).toBeUndefined();
  });
  it('is not visible to roles without approval permission', async () => {
    expect((await crm.get('/approvals')).status).toBe(403);
  });
  it('writes audit entries for approvals', async () => {
    await approvedScheme();
    const logs = (await as('u-audit').get('/audit-logs?pageSize=100')).body.items.map((a: { action: string }) => a.action);
    expect(logs).toEqual(expect.arrayContaining(['scheme.create', 'scheme.submit', 'approval.review', 'approval.decide']));
  });
});
