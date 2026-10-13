import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
beforeEach(() => { app = createApp(); }); // fresh in-memory store per test

const as = (user: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set('x-dev-user', user),
  post: (p: string, b: object = {}) => request(app).post(`/api/v1${p}`).set('x-dev-user', user).send(b),
});
const crm = as('u-crm-chn');

const newLead = (over = {}) => ({ name: 'Test Person', phone: '9111111111', source: 'WALK_IN', branchId: 'CHN', ...over });

async function convertedCustomer() {
  const { body: lead } = await crm.post('/leads', newLead());
  for (const to of ['CONTACTED', 'INTERESTED', 'REGISTRATION_PENDING']) await crm.post(`/leads/${lead.id}/transition`, { to });
  const res = await crm.post(`/leads/${lead.id}/convert`);
  return { lead, customer: res.body.customer, res };
}

async function verifiedCustomer() {
  const { customer } = await convertedCustomer();
  const { body: profile } = await crm.get(`/customers/${customer.id}`);
  const kycId = profile.kycCaseId;
  await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'id.pdf' });
  await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'ADDRESS_PROOF', fileName: 'addr.pdf' });
  await crm.post(`/kyc-cases/${kycId}/submit`);
  const dec = await as('u-kyc').post(`/kyc-cases/${kycId}/decision`, { decision: 'VERIFIED' });
  return { customer, kycId, dec };
}

describe('authentication & permissions', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request(app).get('/api/v1/leads')).status).toBe(401);
  });
  it('rejects a user lacking the permission', async () => {
    const res = await as('u-kyc').get('/leads');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
  it('blocks mutation by read-only roles', async () => {
    expect((await as('u-audit').post('/leads', newLead())).status).toBe(403);
  });
});

describe('branch scoping', () => {
  it('hides other branches from lists and rejects direct access', async () => {
    const list = await crm.get('/leads');
    expect(list.body.items.every((l: { branchId: string }) => l.branchId === 'CHN')).toBe(true);
    const cbeLead = (await as('u-crm-cbe').get('/leads')).body.items[0];
    const res = await crm.get(`/leads/${cbeLead.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_BRANCH');
  });
  it('cannot create records in another branch', async () => {
    const res = await crm.post('/leads', newLead({ branchId: 'CBE' }));
    expect(res.status).toBe(403);
  });
});

describe('leads', () => {
  it('validates input with field errors', async () => {
    const res = await crm.post('/leads', { name: 'x', phone: '123', source: 'BAD' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['name', 'phone', 'source', 'branchId']));
  });
  it('warns on duplicates unless confirmed', async () => {
    await crm.post('/leads', newLead());
    const dup = await crm.post('/leads', newLead());
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_WARNING');
    expect((await crm.post('/leads', newLead({ confirmDuplicate: true }))).status).toBe(201);
  });
  it('enforces the lead state machine', async () => {
    const { body: lead } = await crm.post('/leads', newLead());
    const skip = await crm.post(`/leads/${lead.id}/transition`, { to: 'INTERESTED' });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');
    expect((await crm.post(`/leads/${lead.id}/transition`, { to: 'LOST' })).status).toBe(400); // reason required
  });
  it('cannot convert before Registration Pending', async () => {
    const { body: lead } = await crm.post('/leads', newLead());
    expect((await crm.post(`/leads/${lead.id}/convert`)).status).toBe(409);
  });
  it('converts a lead into a customer with an audit trail', async () => {
    const { lead, customer, res } = await convertedCustomer();
    expect(res.status).toBe(201);
    expect(customer.kycStatus).toBe('NOT_STARTED');
    expect(customer.membershipStatus).toBe('NONE');
    const detail = await crm.get(`/leads/${lead.id}`);
    expect(detail.body.lead.status).toBe('CONVERTED');
    expect(detail.body.timeline.length).toBeGreaterThan(3);
    const audit = await as('u-audit').get('/audit-logs');
    expect(audit.body.items.some((a: { action: string }) => a.action === 'lead.convert')).toBe(true);
  });
  it('schedules and completes follow-ups', async () => {
    const { body: lead } = await crm.post('/leads', newLead());
    const f = await crm.post(`/leads/${lead.id}/follow-ups`, { dueAt: '2030-01-01', note: 'Call back' });
    expect(f.status).toBe(201);
    expect((await crm.post(`/follow-ups/${f.body.id}/complete`)).body.status).toBe('DONE');
    expect((await crm.post(`/follow-ups/${f.body.id}/complete`)).status).toBe(409);
  });
});

describe('KYC', () => {
  it('cannot submit without required documents', async () => {
    const { customer } = await convertedCustomer();
    const kycId = (await crm.get(`/customers/${customer.id}`)).body.kycCaseId;
    await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'id.pdf' });
    const res = await crm.post(`/kyc-cases/${kycId}/submit`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENTS_MISSING');
  });
  it('only a KYC officer can decide; submitter cannot decide own case', async () => {
    const { customer } = await convertedCustomer();
    const kycId = (await crm.get(`/customers/${customer.id}`)).body.kycCaseId;
    await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'id.pdf' });
    await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'ADDRESS_PROOF', fileName: 'a.pdf' });
    await crm.post(`/kyc-cases/${kycId}/submit`);
    expect((await crm.post(`/kyc-cases/${kycId}/decision`, { decision: 'VERIFIED' })).status).toBe(403);
    // KYC officer submits then tries to decide own case
    const officer = as('u-kyc');
    const second = (await officer.get('/kyc-cases?status=NOT_STARTED')).body.items[0];
    await officer.post(`/kyc-cases/${second.id}/documents`, { type: 'IDENTITY_PROOF', fileName: 'i.pdf' });
    await officer.post(`/kyc-cases/${second.id}/documents`, { type: 'ADDRESS_PROOF', fileName: 'a.pdf' });
    await officer.post(`/kyc-cases/${second.id}/submit`);
    const self = await officer.post(`/kyc-cases/${second.id}/decision`, { decision: 'VERIFIED' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('MAKER_CHECKER');
  });
  it('requires a comment for correction and keeps document history', async () => {
    const { customer } = await convertedCustomer();
    const kycId = (await crm.get(`/customers/${customer.id}`)).body.kycCaseId;
    await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'v1.pdf' });
    await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'ADDRESS_PROOF', fileName: 'a.pdf' });
    await crm.post(`/kyc-cases/${kycId}/submit`);
    const kyc = as('u-kyc');
    expect((await kyc.post(`/kyc-cases/${kycId}/decision`, { decision: 'CORRECTION_REQUIRED' })).status).toBe(400);
    await kyc.post(`/kyc-cases/${kycId}/decision`, { decision: 'CORRECTION_REQUIRED', comment: 'Blurry ID' });
    await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'v2.pdf' });
    const view = (await crm.get(`/kyc-cases/${kycId}`)).body;
    expect(view.documents.filter((d: { type: string }) => d.type === 'IDENTITY_PROOF')).toHaveLength(2);
    expect(view.documents.filter((d: { active: boolean }) => d.active)).toHaveLength(2);
    expect(view.status).toBe('DOCUMENTS_PENDING');
    expect(view.history.length).toBeGreaterThanOrEqual(4);
  });
  it('hides document details from roles without document access', async () => {
    const { customer } = await convertedCustomer();
    const kycId = (await crm.get(`/customers/${customer.id}`)).body.kycCaseId;
    await crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'id.pdf' });
    const view = (await as('u-chitops').get(`/kyc-cases/${kycId}`)).body;
    expect(view.documents).toBeNull();
    expect(view.documentCount).toBe(1);
  });
});

describe('membership applications', () => {
  it('requires verified KYC', async () => {
    const { customer } = await convertedCustomer();
    const res = await crm.post('/memberships/applications', { customerId: customer.id, preferredScheme: 'Any' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('KYC_NOT_VERIFIED');
  });
  it('maker cannot approve own submission; ops head approval moves membership to Enrolment Pending', async () => {
    const { customer, dec } = await verifiedCustomer();
    expect(dec.status).toBe(200);
    const app1 = await crm.post('/memberships/applications', { customerId: customer.id, preferredScheme: 'Scheme A' });
    expect(app1.status).toBe(201);
    expect((await crm.post('/memberships/applications', { customerId: customer.id, preferredScheme: 'B' })).body.error.code).toBe('DUPLICATE_APPLICATION');
    expect((await crm.post(`/memberships/applications/${app1.body.id}/decision`, { decision: 'APPROVED' })).status).toBe(403);
    const ok = await as('u-ops').post(`/memberships/applications/${app1.body.id}/decision`, { decision: 'APPROVED' });
    expect(ok.status).toBe(200);
    const profile = (await crm.get(`/customers/${customer.id}`)).body.customer;
    expect(profile.kycStatus).toBe('VERIFIED');
    expect(profile.membershipStatus).toBe('ENROLMENT_PENDING');
    expect(profile.lifecycleStage).toBe('ENROLMENT_PENDING');
    expect((await as('u-ops').post(`/memberships/applications/${app1.body.id}/decision`, { decision: 'REJECTED', comment: 'x' })).status).toBe(409);
  });
  it('approver role cannot create applications (separation of duties)', async () => {
    const { customer } = await verifiedCustomer();
    expect((await as('u-ops').post('/memberships/applications', { customerId: customer.id, preferredScheme: 'A' })).status).toBe(403);
  });
});

describe('customers', () => {
  it('registers staff-assisted with duplicate warning', async () => {
    const body = { name: 'Direct Customer', phone: '9222222222', branchId: 'CHN' };
    expect((await crm.post('/customers', body)).status).toBe(201);
    expect((await crm.post('/customers', body)).body.error.code).toBe('DUPLICATE_WARNING');
  });
  it('rejects a future date of birth', async () => {
    const res = await crm.post('/customers', { name: 'Future', phone: '9333333333', branchId: 'CHN', dob: '2999-01-01' });
    expect(res.status).toBe(400);
  });
});

describe('audit log', () => {
  it('is restricted to audit permission', async () => {
    expect((await crm.get('/audit-logs')).status).toBe(403);
    expect((await as('u-audit').get('/audit-logs')).status).toBe(200);
  });
});
