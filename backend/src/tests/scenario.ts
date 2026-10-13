import request from 'supertest';
import type { Express } from 'express';
import type { Store } from '../repositories/store.js';

/** Test clock shared by the app's store and the scenario. */
export interface Clock {
  ms: number;
}
export const T0 = Date.parse('2026-12-01T04:00:00.000Z');
export const HOUR = 3_600_000;

export const installClock = (store: Store, clock: Clock) => {
  store.now = () => new Date(clock.ms);
  store.today = () => new Date(clock.ms).toISOString().slice(0, 10);
};

export const actor = (app: Express, user: string, headers: Record<string, string> = {}) => {
  const h = (r: request.Test) => {
    r.set('x-dev-user', user);
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r;
  };
  return {
    get: (p: string) => h(request(app).get(`/api/v1${p}`)),
    post: (p: string, b: object = {}) => h(request(app).post(`/api/v1${p}`)).send(b),
    put: (p: string, b: object = {}) => h(request(app).put(`/api/v1${p}`)).send(b),
  };
};
export type Actor = ReturnType<typeof actor>;

export const staff = (app: Express) => ({
  crm: actor(app, 'u-crm-chn'),
  maker: actor(app, 'u-chitops'),
  head: actor(app, 'u-ops'),
  col: actor(app, 'u-col-chn'),
  fm: actor(app, 'u-fin-maker'),
  fc: actor(app, 'u-fin-checker'),
  both: actor(app, 'u-fin-both'),
  officer: actor(app, 'u-auction'),
  kyc: actor(app, 'u-kyc'),
  audit: actor(app, 'u-audit'),
});
export type Staff = ReturnType<typeof staff>;

export const SCHEME = (code = 'SCH-X') => ({
  code,
  config: {
    name: 'Scenario Scheme', jurisdiction: 'TAMIL_NADU', chitValuePaise: 30000000, memberCount: 3, installmentAmountPaise: 10000000,
    frequency: 'MONTHLY', tenureMonths: 3, auction: { mode: 'MEMBER_BIDS', minBidPaise: 100000, maxBidPaise: 5000000, bidIncrementPaise: 100000 },
    requiredDocuments: ['Prize claim form'], complianceChecklist: ['Chit agreement executed'], effectiveFrom: '2026-01-01',
  },
});

export async function verifiedCustomer(s: Staff, phone: string) {
  const { body: lead } = await s.crm.post('/leads', { name: `Member ${phone}`, phone, source: 'WALK_IN', branchId: 'CHN' });
  for (const to of ['CONTACTED', 'INTERESTED', 'REGISTRATION_PENDING']) await s.crm.post(`/leads/${lead.id}/transition`, { to });
  const cid = (await s.crm.post(`/leads/${lead.id}/convert`)).body.customer.id as string;
  const kycId = (await s.crm.get(`/customers/${cid}`)).body.kycCaseId;
  await s.crm.post(`/kyc-cases/${kycId}/documents`, { type: 'IDENTITY_PROOF', fileName: 'id.pdf' });
  await s.crm.post(`/kyc-cases/${kycId}/documents`, { type: 'ADDRESS_PROOF', fileName: 'addr.pdf' });
  await s.crm.post(`/kyc-cases/${kycId}/submit`);
  await s.kyc.post(`/kyc-cases/${kycId}/decision`, { decision: 'VERIFIED' });
  const a = await s.crm.post('/memberships/applications', { customerId: cid, preferredScheme: 'Scenario' });
  await s.head.post(`/memberships/applications/${a.body.id}/decision`, { decision: 'APPROVED' });
  return cid;
}

export async function publishedScheme(s: Staff, code = 'SCH-X') {
  const created = await s.maker.post('/schemes', SCHEME(code));
  const vId = created.body.version.id as string;
  const rid = (await s.maker.post(`/scheme-versions/${vId}/submit`)).body.request.id;
  await s.head.post(`/approvals/${rid}/start-review`);
  await s.head.post(`/approvals/${rid}/decision`, { decision: 'APPROVED' });
  await s.head.post(`/scheme-versions/${vId}/publish`);
  return { schemeId: created.body.scheme.id as string, versionId: vId };
}

/** Builds an ACTIVE group of three verified members whose first instalment is due 2026-12-01. */
export async function activeGroup(app: Express, s: Staff, opts: { code?: string; phones?: string[] } = {}) {
  const { versionId } = await publishedScheme(s, opts.code ? `S-${opts.code}` : 'SCH-X');
  const g = await s.maker.post('/groups', { code: opts.code ?? 'GRP-X', name: 'Scenario Group', schemeVersionId: versionId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
  await s.maker.post(`/groups/${g.body.id}/submit`);
  const open = (await s.head.get('/approvals?scope=queue&type=GROUP_OPEN')).body.items[0];
  await s.head.post(`/approvals/${open.id}/decision`, { decision: 'APPROVED' });
  const phones = opts.phones ?? ['9555000001', '9555000002', '9555000003'];
  const cs: string[] = [];
  for (const p of phones) cs.push(await verifiedCustomer(s, p));
  for (const c of cs) await s.maker.post(`/groups/${g.body.id}/tickets`, { customerId: c });
  const detail = (await s.maker.get(`/groups/${g.body.id}`)).body;
  for (const item of detail.checklist) await s.maker.post(`/groups/${g.body.id}/checklist/${item.id}/confirm`, { reference: 'AGR-001' });
  await s.maker.post(`/groups/${g.body.id}/ready`);
  await s.maker.post(`/groups/${g.body.id}/activation-request`);
  const act = (await s.head.get('/approvals?scope=queue&type=GROUP_ACTIVATION')).body.items[0];
  await s.head.post(`/approvals/${act.id}/decision`, { decision: 'APPROVED' });
  return { groupId: g.body.id as string, cs, members: cs.map((c) => actor(app, `u-member-${c}`)) };
}

let seq = 0;
export const uniq = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 10)}`;

/** Canonical JSON (sorted keys): PostgreSQL's jsonb reorders object keys, so compare structurally. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

/** Everything that is persisted, in one comparable object. */
export const stateOf = (store: Store) => {
  const keys = ['branches', 'users', 'leads', 'followUps', 'customers', 'kycCases', 'applications', 'activities', 'audit', 'schemes', 'schemeVersions', 'groups', 'approvals', 'instalments',
    'payments', 'allocations', 'receipts', 'attempts', 'bankLines', 'reconResults', 'accounts', 'periods', 'journals', 'auctions', 'payouts', 'supportCases'] as const;
  return { ...Object.fromEntries(keys.map((k) => [k, store[k]])), counters: store.counters, settings: store.settings, postingRules: store.postingRules };
};
