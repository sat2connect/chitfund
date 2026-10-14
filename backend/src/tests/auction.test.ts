import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Store } from '../repositories/store.js';
import { createSeededStore } from '../seed/crmSeed.js';

const T0 = Date.parse('2026-12-01T04:00:00.000Z');
let nowMs = T0;
let store: Store;
let app: ReturnType<typeof createApp>;
const at = (ms: number) => new Date(ms).toISOString();
const HOUR = 3600_000;
const advance = (ms: number) => { nowMs += ms; };

beforeEach(() => {
  nowMs = T0;
  store = createSeededStore();
  store.now = () => new Date(nowMs);
  store.today = () => new Date(nowMs).toISOString().slice(0, 10);
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
const officer = as('u-auction');
const fm = as('u-fin-maker');
const fc = as('u-fin-checker');
const both = as('u-fin-both');

const CHIT = 30000000;
const schemeBody = (mode = 'MEMBER_BIDS') => ({
  code: 'SCH-A',
  config: {
    name: 'Auction Scheme', jurisdiction: 'TAMIL_NADU', chitValuePaise: CHIT, memberCount: 3, installmentAmountPaise: 10000000, frequency: 'MONTHLY',
    tenureMonths: 3, auction: { mode, minBidPaise: 100000, maxBidPaise: 5000000, bidIncrementPaise: 100000 },
    requiredDocuments: ['Prize claim form'], complianceChecklist: [], effectiveFrom: '2026-01-01',
  },
});

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

async function activeGroup(mode = 'MEMBER_BIDS') {
  const created = await maker.post('/schemes', schemeBody(mode));
  const vId = created.body.version.id;
  const rid = (await maker.post(`/scheme-versions/${vId}/submit`)).body.request.id;
  await head.post(`/approvals/${rid}/start-review`);
  await head.post(`/approvals/${rid}/decision`, { decision: 'APPROVED' });
  await head.post(`/scheme-versions/${vId}/publish`);
  const g = await maker.post('/groups', { code: 'GRP-A', name: 'Auction Group', schemeVersionId: vId, branchId: 'CHN', plannedStartDate: '2026-12-01' });
  await maker.post(`/groups/${g.body.id}/submit`);
  const open = (await head.get('/approvals?scope=queue&type=GROUP_OPEN')).body.items[0];
  await head.post(`/approvals/${open.id}/decision`, { decision: 'APPROVED' });
  await head.post(`/groups/${g.body.id}/open-enrolment`);
  const cs = [await verifiedCustomer('9888888881'), await verifiedCustomer('9888888882'), await verifiedCustomer('9888888883')];
  for (const c of cs) await maker.post(`/groups/${g.body.id}/tickets`, { customerId: c });
  await maker.post(`/groups/${g.body.id}/ready`);
  await maker.post(`/groups/${g.body.id}/activation-request`);
  const act = (await head.get('/approvals?scope=queue&type=GROUP_ACTIVATION')).body.items[0];
  await head.post(`/approvals/${act.id}/decision`, { decision: 'APPROVED' });
  const members = cs.map((c) => as(`u-member-${c}`));
  return { groupId: g.body.id as string, cs, members };
}

const auctionBody = (groupId: string, over: Record<string, unknown> = {}) => ({
  groupId, cycleNo: 1, scheduledOpenAt: at(nowMs + HOUR), scheduledCloseAt: at(nowMs + 3 * HOUR),
  winnerSelection: 'HIGHEST_BID', tieBreak: 'EARLIEST_BID', bidPolicy: 'SINGLE', excludePriorWinners: true, requireNoOverdue: false, ...over,
});

/** Schedules, readies and opens an auction using the server clock. */
async function openAuction(groupId: string, over: Record<string, unknown> = {}) {
  const a = await officer.post('/auctions', auctionBody(groupId, over));
  expect(a.status).toBe(201);
  const ready = await officer.post(`/auctions/${a.body.id}/ready`);
  expect(ready.status).toBe(200);
  advance(HOUR + 1000);
  return a.body.id as string;
}

let n = 0;
const bid = (m: ReturnType<typeof as>, auctionId: string, ticketNo: number, amountPaise: number, over: Record<string, unknown> = {}) =>
  m.post(`/auctions/${auctionId}/bids`, { ticketNo, amountPaise, clientRequestId: `bid-${++n}-xxxxxxxx`, ...over });

/** Runs an auction to an approved result. */
async function approvedAuction(groupId: string, members: ReturnType<typeof as>[], bids: [number, number][], over: Record<string, unknown> = {}) {
  const id = await openAuction(groupId, over);
  for (const [t, amt] of bids) await bid(members[t - 1]!, id, t, amt);
  advance(3 * HOUR);
  await officer.post(`/auctions/${id}/compute`);
  await officer.post(`/auctions/${id}/validate`);
  await officer.post(`/auctions/${id}/submit`);
  const req = (await head.get('/approvals?scope=queue&type=AUCTION_RESULT')).body.items[0];
  const res = await head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' });
  return { id, res };
}

describe('auction scheduling and preparation', () => {
  it('requires every rule choice explicitly and a valid future schedule', async () => {
    const { groupId } = await activeGroup();
    const bad = await officer.post('/auctions', { groupId, cycleNo: 1, scheduledOpenAt: at(nowMs - HOUR), scheduledCloseAt: at(nowMs - 2 * HOUR) });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details)).toEqual(expect.arrayContaining(['winnerSelection', 'tieBreak', 'bidPolicy', 'excludePriorWinners', 'requireNoOverdue']));
    const times = await officer.post('/auctions', auctionBody(groupId, { scheduledOpenAt: at(nowMs - HOUR), scheduledCloseAt: at(nowMs - 2 * HOUR) }));
    expect(times.body.error.details.scheduledCloseAt).toBeTruthy();
    expect(times.body.error.details.scheduledOpenAt).toBeTruthy();
  });
  it('snapshots scheme bid limits, rejects duplicate cycles, and needs permission', async () => {
    const { groupId } = await activeGroup();
    const a = await officer.post('/auctions', auctionBody(groupId));
    expect(a.body.rules.minBidPaise).toBe(100000);
    expect(a.body.rules.maxBidPaise).toBe(5000000);
    expect((await officer.post('/auctions', auctionBody(groupId))).body.error.code).toBe('DUPLICATE_CYCLE');
    expect((await crm.post('/auctions', auctionBody(groupId, { cycleNo: 2 }))).status).toBe(403);
  });
  it('blocks readiness when the scheme does not allow member bids', async () => {
    const { groupId } = await activeGroup('STAFF_ASSISTED');
    const a = await officer.post('/auctions', auctionBody(groupId));
    const res = await officer.post(`/auctions/${a.body.id}/ready`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_READY');
  });
  it('reschedules back to Scheduled and cancels with a reason', async () => {
    const { groupId } = await activeGroup();
    const a = (await officer.post('/auctions', auctionBody(groupId))).body;
    await officer.post(`/auctions/${a.id}/ready`);
    const re = await officer.post(`/auctions/${a.id}/reschedule`, { scheduledOpenAt: at(nowMs + 5 * HOUR), scheduledCloseAt: at(nowMs + 6 * HOUR) });
    expect(re.body.status).toBe('SCHEDULED');
    expect((await officer.post(`/auctions/${a.id}/cancel`, {})).status).toBe(400);
    const cancelled = await officer.post(`/auctions/${a.id}/cancel`, { reason: 'Venue change' });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await officer.post(`/auctions/${a.id}/ready`)).status).toBe(409);
  });
});

describe('server-controlled bidding window', () => {
  it('opens and closes on the server clock and records server timestamps', async () => {
    const { groupId, members } = await activeGroup();
    const a = (await officer.post('/auctions', auctionBody(groupId))).body;
    await officer.post(`/auctions/${a.id}/ready`);
    const early = await bid(members[0]!, a.id, 1, 500000);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('AUCTION_NOT_OPEN');
    advance(HOUR + 5000);
    expect((await officer.get(`/auctions/${a.id}`)).body.status).toBe('OPEN');
    const ok = await bid(members[0]!, a.id, 1, 500000, { clientTimestamp: '1999-01-01T00:00:00Z' });
    expect(ok.status).toBe(201);
    expect(ok.body.accepted).toBe(true);
    expect(ok.body.bid.serverTimestamp).toBe(at(nowMs)); // client time is ignored
    expect(ok.body.bid.sequence).toBe(1);
    advance(2 * HOUR);
    expect((await officer.get(`/auctions/${a.id}`)).body.status).toBe('CLOSED');
    const late = await bid(members[1]!, a.id, 2, 600000);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('AUCTION_NOT_OPEN');
    expect((await officer.get(`/auctions/${a.id}`)).body.bidCount).toBe(1);
  });
  it('never opens an auction that was not marked ready', async () => {
    const { groupId, members } = await activeGroup();
    const a = (await officer.post('/auctions', auctionBody(groupId))).body;
    advance(HOUR + 5000);
    expect((await officer.get(`/auctions/${a.id}`)).body.status).toBe('SCHEDULED');
    expect((await bid(members[0]!, a.id, 1, 500000)).status).toBe(409);
  });
  it('closing early needs a reason and is recorded', async () => {
    const { groupId } = await activeGroup();
    const id = await openAuction(groupId);
    expect((await officer.post(`/auctions/${id}/close`, {})).status).toBe(400);
    const r = await officer.post(`/auctions/${id}/close`, { reason: 'All members have bid' });
    expect(r.body.status).toBe('CLOSED');
    expect(r.body.history.at(-1).comment).toMatch(/Closed early/);
  });
});

describe('bid validation', () => {
  it('only members can bid, only for their own tickets, within limits', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    expect((await bid(officer, id, 1, 500000)).status).toBe(403); // staff cannot place member bids
    const other = await bid(members[1]!, id, 1, 500000);
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('NOT_YOUR_TICKET');
    expect((await bid(members[0]!, id, 1, 50000)).status).toBe(400); // below minimum
    expect((await bid(members[0]!, id, 1, 6000000)).status).toBe(400); // above maximum
    const step = await bid(members[0]!, id, 1, 150000); // not on the 1,00,000 step
    expect(step.status).toBe(400);
    expect(step.body.error.details.amountPaise).toMatch(/steps/);
    expect((await bid(members[0]!, id, 1, 150.5)).status).toBe(400);
  });
  it('enforces the single-bid policy and treats a retry as the same bid', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    const body = { ticketNo: 1, amountPaise: 500000, clientRequestId: 'retry-0001-abcd' };
    const first = await members[0]!.post(`/auctions/${id}/bids`, body);
    const again = await members[0]!.post(`/auctions/${id}/bids`, body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.bid.id).toBe(first.body.bid.id);
    const second = await bid(members[0]!, id, 1, 600000);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_BID');
    expect((await officer.get(`/auctions/${id}`)).body.bidCount).toBe(1);
  });
  it('allows multiple bids when the auction policy says so', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId, { bidPolicy: 'MULTIPLE' });
    expect((await bid(members[0]!, id, 1, 500000)).status).toBe(201);
    expect((await bid(members[0]!, id, 1, 700000)).status).toBe(201);
    expect((await officer.get(`/auctions/${id}`)).body.bidCount).toBe(2);
  });
  it('keeps other members\' bids hidden from members but visible to staff', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[0]!, id, 1, 500000);
    await bid(members[1]!, id, 2, 600000);
    const mine = (await members[0]!.get(`/auctions/${id}`)).body;
    expect(mine.view).toBe('MEMBER');
    expect(mine.myBids).toHaveLength(1);
    expect(mine.bids).toBeUndefined();
    expect(mine.eligibility).toBeUndefined();
    expect((await officer.get(`/auctions/${id}`)).body.bids).toHaveLength(2);
  });
  it('keeps non-members and other branches out', async () => {
    const { groupId } = await activeGroup();
    const id = await openAuction(groupId);
    store.users.push({ id: 'u-member-x', name: 'Stranger', roles: ['CHIT_MEMBER'], branchIds: [], customerId: 'CU-9999' });
    expect((await as('u-member-x').get(`/auctions/${id}`)).status).toBe(403);
    expect((await as('u-member-x').get('/auctions')).body.total).toBe(0);
    expect((await as('u-crm-cbe').get(`/auctions/${id}`)).status).toBe(403);
  });
  it('applies eligibility choices: prior winners are excluded when configured', async () => {
    const { groupId, members } = await activeGroup();
    const first = await approvedAuction(groupId, members, [[1, 500000], [2, 400000]]);
    expect(first.res.status).toBe(200);
    const second = await officer.post('/auctions', auctionBody(groupId, { cycleNo: 2, scheduledOpenAt: at(nowMs + HOUR), scheduledCloseAt: at(nowMs + 3 * HOUR) }));
    await officer.post(`/auctions/${second.body.id}/ready`);
    advance(HOUR + 1000);
    const blocked = await bid(members[0]!, second.body.id, 1, 500000);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('NOT_ELIGIBLE');
    expect(blocked.body.error.message).toMatch(/cycle 1/);
    expect((await bid(members[1]!, second.body.id, 2, 500000)).status).toBe(201);
  });
});

describe('result, tie-break and validation', () => {
  it('awards to the highest bid under HIGHEST_BID and the lowest under LOWEST_BID', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[0]!, id, 1, 300000);
    await bid(members[1]!, id, 2, 900000);
    await bid(members[2]!, id, 3, 500000);
    advance(3 * HOUR);
    const hi = (await officer.post(`/auctions/${id}/compute`)).body;
    expect(hi.status).toBe('VALIDATION');
    expect(hi.result.winnerTicketNo).toBe(2);
    expect(hi.result.winningAmountPaise).toBe(900000);
  });
  it('applies LOWEST_BID when chosen', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId, { winnerSelection: 'LOWEST_BID' });
    await bid(members[0]!, id, 1, 300000);
    await bid(members[1]!, id, 2, 900000);
    advance(3 * HOUR);
    expect((await officer.post(`/auctions/${id}/compute`)).body.result.winnerTicketNo).toBe(1);
  });
  it('breaks ties by the earliest server-recorded bid when configured', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[2]!, id, 3, 800000);
    advance(1000);
    await bid(members[0]!, id, 1, 800000);
    advance(3 * HOUR);
    const r = (await officer.post(`/auctions/${id}/compute`)).body.result;
    expect(r.winnerTicketNo).toBe(3);
    expect(r.tiedTicketNos).toEqual([3, 1]);
    expect(r.tieBreakApplied).toBe('EARLIEST_BID');
  });
  it('requires a recorded manual decision for MANUAL tie-breaks', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId, { tieBreak: 'MANUAL' });
    await bid(members[0]!, id, 1, 800000);
    await bid(members[1]!, id, 2, 800000);
    advance(3 * HOUR);
    const r = (await officer.post(`/auctions/${id}/compute`)).body;
    expect(r.result.needsManualDecision).toBe(true);
    expect(r.result.winnerTicketNo).toBeUndefined();
    expect((await officer.post(`/auctions/${id}/validate`)).body.error.code).toBe('TIE_UNRESOLVED');
    expect((await officer.post(`/auctions/${id}/tie-decision`, { ticketNo: 3, reason: 'Not tied here' })).status).toBe(400);
    expect((await officer.post(`/auctions/${id}/tie-decision`, { ticketNo: 2, reason: 'Per scheme rule 4' })).body.result.tieBreakApplied).toBe('MANUAL');
    expect((await officer.post(`/auctions/${id}/validate`)).status).toBe(200);
  });
  it('records NO_VALID_BID and settles it on approval', async () => {
    const { groupId } = await activeGroup();
    const { res, id } = await approvedAuction(groupId, [], []);
    expect(res.status).toBe(200);
    const a = (await officer.get(`/auctions/${id}`)).body;
    expect(a.result.outcome).toBe('NO_VALID_BID');
    expect(a.status).toBe('SETTLED');
  });
  it('needs validation, independent approval, and cannot be approved by its operator', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[0]!, id, 1, 500000);
    advance(3 * HOUR);
    await officer.post(`/auctions/${id}/compute`);
    expect((await officer.post(`/auctions/${id}/submit`)).body.error.code).toBe('NOT_VALIDATED');
    await officer.post(`/auctions/${id}/validate`);
    const sub = await officer.post(`/auctions/${id}/submit`);
    expect(sub.body.status).toBe('APPROVAL_PENDING');
    const req = sub.body.approvalRequests[0];
    expect((await officer.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' })).status).toBe(403);
    expect((await crm.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' })).status).toBe(403);
    expect((await head.post(`/approvals/${req.id}/decision`, { decision: 'RETURNED' })).status).toBe(400);
    await head.post(`/approvals/${req.id}/decision`, { decision: 'RETURNED', comment: 'Recheck bid log' });
    expect((await officer.get(`/auctions/${id}`)).body.status).toBe('VALIDATION');
    expect((await officer.get(`/auctions/${id}`)).body.result.validatedBy).toBeUndefined();
  });
  it('keeps the bid log append-only through every stage', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[0]!, id, 1, 500000);
    advance(3 * HOUR);
    await officer.post(`/auctions/${id}/compute`);
    const before = (await officer.get(`/auctions/${id}`)).body.bids;
    expect((await bid(members[1]!, id, 2, 600000)).status).toBe(409);
    await officer.post(`/auctions/${id}/compute`); // recompute does not alter bids
    expect((await officer.get(`/auctions/${id}`)).body.bids).toEqual(before);
  });
});

describe('disputes', () => {
  it('lets a member raise a dispute, blocks progress while open, and resumes after dismissal', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[0]!, id, 1, 500000);
    advance(3 * HOUR);
    await officer.post(`/auctions/${id}/compute`);
    const d = await members[1]!.post(`/auctions/${id}/disputes`, { reason: 'My bid was not shown' });
    expect(d.status).toBe(201);
    expect((await officer.post(`/auctions/${id}/validate`)).body.error.code).toBe('OPEN_DISPUTE');
    const disputeId = (await officer.get(`/auctions/${id}`)).body.disputes[0].id;
    expect((await officer.post(`/auctions/${id}/disputes/${disputeId}/resolve`, { resolution: 'DISMISSED', comment: 'Checked log' })).status).toBe(403);
    const resolved = await head.post(`/auctions/${id}/disputes/${disputeId}/resolve`, { resolution: 'DISMISSED', comment: 'Bid log checked; no bid recorded' });
    expect(resolved.body.disputes[0].status).toBe('DISMISSED');
    expect((await officer.post(`/auctions/${id}/validate`)).status).toBe(200);
  });
  it('cancels the auction and its approval request when a dispute is upheld', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[0]!, id, 1, 500000);
    advance(3 * HOUR);
    await officer.post(`/auctions/${id}/compute`);
    await officer.post(`/auctions/${id}/validate`);
    await officer.post(`/auctions/${id}/submit`);
    await members[2]!.post(`/auctions/${id}/disputes`, { reason: 'Bid window closed early for me' });
    const req = (await head.get('/approvals?scope=queue&type=AUCTION_RESULT')).body.items[0];
    expect((await head.post(`/approvals/${req.id}/decision`, { decision: 'APPROVED' })).body.error.code).toBe('OPEN_DISPUTE');
    const disputeId = (await officer.get(`/auctions/${id}`)).body.disputes[0].id;
    const up = await head.post(`/auctions/${id}/disputes/${disputeId}/resolve`, { resolution: 'UPHELD', comment: 'Upheld after review' });
    expect(up.body.status).toBe('CANCELLED');
    expect((await head.get('/approvals?scope=history')).body.items.find((r: { id: string }) => r.id === req.id).status).toBe('CANCELLED');
  });
  it('does not accept disputes before the auction has closed or from non-members', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    expect((await members[0]!.post(`/auctions/${id}/disputes`, { reason: 'Too early to dispute' })).status).toBe(409);
    advance(3 * HOUR);
    store.users.push({ id: 'u-member-y', name: 'Stranger', roles: ['CHIT_MEMBER'], branchIds: [], customerId: 'CU-9999' });
    expect((await as('u-member-y').post(`/auctions/${id}/disputes`, { reason: 'Not even my group' })).status).toBe(403);
  });
});

describe('prize payout workflow (manual amounts, no calculation engine)', () => {
  async function awarded() {
    const { groupId, members, cs } = await activeGroup();
    const { id } = await approvedAuction(groupId, members, [[1, 500000], [2, 900000]]);
    return { auctionId: id, winner: cs[1]!, groupId, members };
  }
  const payoutBody = (auctionId: string, over: Record<string, unknown> = {}) => ({
    auctionId, amountPaise: 25000000, amountBasis: 'Per approved calc sheet CS-2026-12 (manual entry)', clientRequestId: `pyt-${++n}-abcdefgh`, ...over,
  });

  it('can only be created by finance from an approved awarded auction, with sanity limits', async () => {
    const { auctionId } = await awarded();
    expect((await maker.post('/payouts', payoutBody(auctionId))).status).toBe(403);
    expect((await fm.post('/payouts', payoutBody(auctionId, { amountPaise: CHIT + 1 }))).status).toBe(400);
    expect((await fm.post('/payouts', payoutBody(auctionId, { amountBasis: 'short' }))).status).toBe(400);
    const ok = await fm.post('/payouts', payoutBody(auctionId));
    expect(ok.status).toBe(201);
    expect(ok.body.payout.status).toBe('DRAFT');
    expect(ok.body.payout.amountNotice).toMatch(/not calculated/i);
    expect(ok.body.payout.documents.map((d: { title: string }) => d.title)).toEqual(['Prize claim form']);
    expect((await fm.post('/payouts', payoutBody(auctionId))).body.error.code).toBe('PAYOUT_EXISTS');
  });
  it('refuses payouts for auctions that are not approved or are disputed', async () => {
    const { groupId, members } = await activeGroup();
    const id = await openAuction(groupId);
    await bid(members[0]!, id, 1, 500000);
    advance(3 * HOUR);
    await officer.post(`/auctions/${id}/compute`);
    expect((await fm.post('/payouts', payoutBody(id))).body.error.code).toBe('AUCTION_NOT_APPROVED');
  });
  it('is idempotent on the client request id', async () => {
    const { auctionId } = await awarded();
    const body = payoutBody(auctionId, { clientRequestId: 'same-payout-req-1' });
    const a = await fm.post('/payouts', body);
    const b = await fm.post('/payouts', body);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.payout.id).toBe(a.body.payout.id);
    expect((await fm.get('/payouts')).body.total).toBe(1);
  });
  it('requires confirmed documents before approval, and independent approval', async () => {
    const { auctionId } = await awarded();
    const p = (await fm.post('/payouts', payoutBody(auctionId))).body.payout;
    await fm.post(`/payouts/${p.id}/submit-review`);
    const early = await maker.post(`/payouts/${p.id}/request-approval`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_ELIGIBLE');
    const doc = (await maker.get(`/payouts/${p.id}`)).body.documents[0];
    expect((await maker.post(`/payouts/${p.id}/documents/${doc.id}/confirm`, {})).status).toBe(400);
    await maker.post(`/payouts/${p.id}/documents/${doc.id}/confirm`, { reference: 'FORM-123' });
    const sub = await maker.post(`/payouts/${p.id}/request-approval`);
    expect(sub.body.status).toBe('PENDING_APPROVAL');
    const reqId = sub.body.approvalRequests[0].id;
    expect((await fm.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' })).status).toBe(403); // creator lacks approver permission
    expect((await maker.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' })).status).toBe(403);
    expect((await fc.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' })).status).toBe(200);
    expect((await fc.get(`/payouts/${p.id}`)).body.status).toBe('APPROVED');
  });
  it('stops a user who entered the amount from approving it, even holding both roles', async () => {
    const { auctionId } = await awarded();
    const p = (await both.post('/payouts', payoutBody(auctionId))).body.payout;
    await both.post(`/payouts/${p.id}/submit-review`);
    const doc = (await maker.get(`/payouts/${p.id}`)).body.documents[0];
    await maker.post(`/payouts/${p.id}/documents/${doc.id}/confirm`, { reference: 'FORM-9' });
    const reqId = (await maker.post(`/payouts/${p.id}/request-approval`)).body.approvalRequests[0].id;
    const self = await both.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('MAKER_CHECKER');
    expect((await fc.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' })).status).toBe(200);
  });
  async function approvedPayout(creator = fm, approver = fc) {
    const { auctionId, winner } = await awarded();
    const p = (await creator.post('/payouts', payoutBody(auctionId))).body.payout;
    await creator.post(`/payouts/${p.id}/submit-review`);
    const doc = (await maker.get(`/payouts/${p.id}`)).body.documents[0];
    await maker.post(`/payouts/${p.id}/documents/${doc.id}/confirm`, { reference: 'FORM-1' });
    const reqId = (await maker.post(`/payouts/${p.id}/request-approval`)).body.approvalRequests[0].id;
    await approver.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' });
    return { id: p.id as string, auctionId, winner };
  }
  it('records disbursement manually, posts a balanced journal, and settles the auction', async () => {
    const { id, auctionId } = await approvedPayout();
    expect((await fm.post(`/payouts/${id}/disbursement`, { reference: 'UTR-P1', paidDate: '2026-12-01' })).status).toBe(409); // not initiated
    expect((await fm.post(`/payouts/${id}/initiate`, { channel: 'CASH' })).status).toBe(400);
    expect((await fm.post(`/payouts/${id}/initiate`, { channel: 'BANK_TRANSFER' })).body.status).toBe('DISBURSEMENT_PENDING');
    expect((await fm.post(`/payouts/${id}/disbursement`, { reference: 'UTR-P1', paidDate: '2999-01-01' })).status).toBe(400);
    const paid = await fm.post(`/payouts/${id}/disbursement`, { reference: 'UTR-P1', paidDate: '2026-12-01' });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.notificationNotice).toMatch(/not sent/i);
    const tb = (await fm.get('/accounting/trial-balance')).body;
    expect(tb.balanced).toBe(true);
    expect(tb.items.find((r: { code: string }) => r.code === '2200').debitPaise).toBe(25000000);
    expect(tb.items.find((r: { code: string }) => r.code === '1020').creditPaise).toBe(25000000);
    expect((await officer.get(`/auctions/${auctionId}`)).body.status).toBe('SETTLED');
    expect((await fm.post(`/payouts/${id}/failure`, { reason: 'Already paid' })).status).toBe(409);
  });
  it('rejects a reused disbursement reference and a payment dated in a closed period', async () => {
    const a = await approvedPayout();
    await fm.post(`/payouts/${a.id}/initiate`, { channel: 'BANK_TRANSFER' });
    const dec = (await fm.get('/accounting/periods')).body.items.find((p: { name: string }) => p.name === 'Dec 2026');
    await fc.post(`/accounting/periods/${dec.id}/close`);
    const closed = await fm.post(`/payouts/${a.id}/disbursement`, { reference: 'UTR-C1', paidDate: '2026-12-01' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('PERIOD_CLOSED');
    expect((await fm.get(`/payouts/${a.id}`)).body.status).toBe('DISBURSEMENT_PENDING');
  });
  it('blocks the approver from also initiating the disbursement', async () => {
    const a = await approvedPayout(fm, both);
    const res = await both.post(`/payouts/${a.id}/initiate`, { channel: 'BANK_TRANSFER' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MAKER_CHECKER');
  });
  it('records a failed disbursement and allows a retry', async () => {
    const { id } = await approvedPayout();
    await fm.post(`/payouts/${id}/initiate`, { channel: 'BANK_TRANSFER' });
    expect((await fm.post(`/payouts/${id}/failure`, { reason: 'Account closed' })).body.status).toBe('FAILED');
    expect((await fm.post(`/payouts/${id}/initiate`, { channel: 'CHEQUE' })).body.status).toBe('DISBURSEMENT_PENDING');
    expect((await fm.post(`/payouts/${id}/disbursement`, { reference: 'CHQ-0001', paidDate: '2026-12-01' })).body.status).toBe('PAID');
  });
  it('puts payouts on hold with a reason and releases them to where they were', async () => {
    const { auctionId } = await awarded();
    const p = (await fm.post('/payouts', payoutBody(auctionId))).body.payout;
    expect((await fm.post(`/payouts/${p.id}/hold`, { reason: 'Legal query on claim' })).status).toBe(403);
    const held = await head.post(`/payouts/${p.id}/hold`, { reason: 'Legal query on claim' });
    expect(held.body.status).toBe('ON_HOLD');
    expect((await head.post(`/payouts/${p.id}/release`, {})).status).toBe(400);
    expect((await head.post(`/payouts/${p.id}/release`, { comment: 'Query closed' })).body.status).toBe('DRAFT');
  });
  it('cancels the open approval request when a payout is held', async () => {
    const { auctionId } = await awarded();
    const p = (await fm.post('/payouts', payoutBody(auctionId))).body.payout;
    await fm.post(`/payouts/${p.id}/submit-review`);
    const doc = (await maker.get(`/payouts/${p.id}`)).body.documents[0];
    await maker.post(`/payouts/${p.id}/documents/${doc.id}/confirm`, { reference: 'F' });
    const reqId = (await maker.post(`/payouts/${p.id}/request-approval`)).body.approvalRequests[0].id;
    await head.post(`/payouts/${p.id}/hold`, { reason: 'Awaiting court order' });
    expect((await fc.post(`/approvals/${reqId}/decision`, { decision: 'APPROVED' })).status).toBe(409);
    expect((await head.post(`/payouts/${p.id}/release`, { comment: 'Order received' })).body.status).toBe('ELIGIBILITY_REVIEW');
  });
  it('reconciles a payout against a debit statement line only', async () => {
    const { id } = await approvedPayout();
    await fm.post(`/payouts/${id}/initiate`, { channel: 'BANK_TRANSFER' });
    await fm.post(`/payouts/${id}/disbursement`, { reference: 'UTR-R1', paidDate: '2026-12-01' });
    await fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 25000000, reference: 'UTR-R1', direction: 'CREDIT' }] });
    const creditLine = (await fm.get('/reconciliation/bank-lines')).body.items[0];
    const wrong = await fm.post('/payouts/reconciliation/match', { payoutId: id, bankLineId: creditLine.id });
    expect(wrong.body.error.code).toBe('WRONG_DIRECTION');
    await fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 25000000, reference: 'UTR-R1', direction: 'DEBIT' }] });
    const q = (await fm.get('/payouts/reconciliation')).body;
    expect(q.items[0].suggestion.differencePaise).toBe(0);
    expect((await fm.post('/payouts/reconciliation/match', { payoutId: id, bankLineId: q.items[0].suggestion.bankLineId })).body.result).toBe('MATCHED');
    expect((await fm.get(`/payouts/${id}`)).body.reconciliationStatus).toBe('MATCHED');
    expect((await fm.get('/payouts/reconciliation')).body.total).toBe(0);
  });
  it('keeps collections from matching debit lines', async () => {
    await fm.post('/reconciliation/bank-lines', { lines: [{ date: '2026-12-01', amountPaise: 100, reference: 'D-1', direction: 'DEBIT' }] });
    expect((await fm.get('/reconciliation/bank-lines?direction=DEBIT')).body.total).toBe(1);
    expect((await fm.get('/reconciliation/bank-lines?direction=CREDIT')).body.total).toBe(0);
  });
  it('limits visibility by permission', async () => {
    expect((await crm.get('/payouts')).status).toBe(403);
    expect((await as('u-audit').get('/payouts')).status).toBe(200);
    expect((await as('u-audit').post('/payouts', {})).status).toBe(403);
  });
});
