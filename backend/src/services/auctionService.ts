import { auctionTransitions } from '../domain/rules.js';
import type { Auction, AuctionResult, AuctionStatus, Bid, ChitGroup, User } from '../domain/types.js';
import { badRequest, conflict, forbidden, notFound } from '../errors/AppError.js';
import { assertBranch, canAccessBranch, hasPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import type { ApprovalService } from './approvalService.js';
import { audit, changeStatus, matches, paginate, userName } from './common.js';
import type { InstalmentService } from './instalmentService.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

const SYSTEM: User = { id: 'system', name: 'System', roles: [], branchIds: 'ALL' };
const LIVE: AuctionStatus[] = ['SCHEDULED', 'READY', 'OPEN', 'CLOSED', 'VALIDATION', 'APPROVAL_PENDING', 'APPROVED'];
const DISPUTABLE: AuctionStatus[] = ['CLOSED', 'VALIDATION', 'APPROVAL_PENDING', 'APPROVED'];
const MEMBER_MODES = ['MEMBER_BIDS', 'HYBRID'];

export const createAuctionService = (s: Store, approvals: ApprovalService, instalments: InstalmentService) => {
  const getAuction = (id: string) => {
    const a = s.auctions.find((x) => x.id === id);
    if (!a) throw notFound('Auction');
    return a;
  };
  const group = (a: Auction) => s.groups.find((g) => g.id === a.groupId)!;
  const schemeCfg = (g: ChitGroup) => s.schemeVersions.find((v) => v.id === g.schemeVersionId)!.config;
  const openRequest = (a: Auction) =>
    s.approvals.find((r) => r.entityType === 'AUCTION_RESULT' && r.entityId === a.id && (r.status === 'PENDING' || r.status === 'IN_REVIEW'));
  const openDisputes = (a: Auction) => a.disputes.filter((d) => d.status === 'OPEN');
  const payoutFor = (a: Auction) => s.payouts.find((p) => p.auctionId === a.id);

  /** The server clock opens and closes auctions; no client action or client time is trusted. */
  const sync = (a: Auction) => {
    const now = s.now().toISOString();
    if (a.status === 'READY' && now >= a.scheduledOpenAt) changeStatus(s, SYSTEM, a, 'OPEN', auctionTransitions, 'Opened at scheduled time');
    if (a.status === 'OPEN' && now >= a.scheduledCloseAt) changeStatus(s, SYSTEM, a, 'CLOSED', auctionTransitions, 'Closed at scheduled time');
    return a;
  };

  const isMember = (u: User) => Boolean(u.customerId);
  const memberTickets = (u: User, a: Auction) => group(a).tickets.filter((t) => t.customerId === u.customerId);
  const assertAccess = (u: User, a: Auction) => {
    if (isMember(u)) {
      if (memberTickets(u, a).length === 0) throw forbidden('You do not hold a ticket in this group', 'FORBIDDEN_NOT_MEMBER');
    } else assertBranch(u, a.branchId);
  };

  const eligibility = (a: Auction) => {
    const prior = s.auctions
      .filter((x) => x.groupId === a.groupId && x.id !== a.id && ['APPROVED', 'SETTLED'].includes(x.status) && x.result?.winnerTicketNo)
      .map((x) => ({ ticketNo: x.result!.winnerTicketNo!, cycleNo: x.cycleNo }));
    return group(a).tickets.filter((t) => t.customerId).map((t) => {
      const reasons: string[] = [];
      if (a.rules.excludePriorWinners) {
        const w = prior.find((p) => p.ticketNo === t.no);
        if (w) reasons.push(`Already won in cycle ${w.cycleNo}`);
      }
      if (a.rules.requireNoOverdue) {
        const overdue = s.instalments.filter((i) => i.groupId === a.groupId && i.ticketNo === t.no).some((i) => instalments.statusOf(i) === 'OVERDUE');
        if (overdue) reasons.push('Has overdue instalments');
      }
      return { ticketNo: t.no, customerId: t.customerId!, customerName: s.customers.find((c) => c.id === t.customerId)?.name, eligible: reasons.length === 0, reasons };
    });
  };

  const readiness = (a: Auction) => {
    const g = group(a);
    const cfg = schemeCfg(g);
    const eligibleCount = eligibility(a).filter((e) => e.eligible).length;
    const now = s.now().toISOString();
    const items = [
      { key: 'GROUP_ACTIVE', label: 'Group is active', met: g.status === 'ACTIVE', detail: `Group status: ${g.status}` },
      { key: 'SCHEME_MODE', label: 'Scheme allows member-submitted bids', met: MEMBER_MODES.includes(cfg.auction.mode), detail: `Scheme auction mode: ${cfg.auction.mode}` },
      { key: 'ELIGIBLE', label: 'At least one eligible ticket', met: eligibleCount > 0, detail: `${eligibleCount} eligible` },
      { key: 'SCHEDULE', label: 'Opening time is in the future', met: ['SCHEDULED', 'READY'].includes(a.status) ? now < a.scheduledOpenAt : true, detail: `Opens ${a.scheduledOpenAt}` },
    ];
    return { items, allMet: items.every((i) => i.met) };
  };

  const parseTimes = (body: Body) => {
    const c = new Check(body);
    const open = c.date('scheduledOpenAt', true);
    const close = c.date('scheduledCloseAt', true);
    c.done();
    const o = new Date(open!).toISOString();
    const cl = new Date(close!).toISOString();
    const errors: Record<string, string> = {};
    if (cl <= o) errors.scheduledCloseAt = 'Closing time must be after opening time';
    if (o <= s.now().toISOString()) errors.scheduledOpenAt = 'Opening time must be in the future';
    if (Object.keys(errors).length) throw badRequest('Validation failed', errors);
    return { open: o, close: cl };
  };

  approvals.register('AUCTION_RESULT', {
    permission: 'auction:approve',
    requiresReview: false,
    currentRevision: (r) => getAuction(r.entityId).revision,
    onDecision(r, decision, u, comment) {
      const a = getAuction(r.entityId);
      if (decision === 'APPROVED') {
        if (openDisputes(a).length) throw conflict('OPEN_DISPUTE', 'Resolve open disputes before approving the result');
        if (!a.result?.validatedBy || a.result.needsManualDecision) throw conflict('NOT_VALIDATED', 'The result has not been validated');
        changeStatus(s, u, a, 'APPROVED', auctionTransitions, comment);
        if (a.result.outcome === 'NO_VALID_BID') changeStatus(s, SYSTEM, a, 'SETTLED', auctionTransitions, 'No award this cycle; nothing to settle');
        audit(s, u, 'auction.approve', 'auction', a.id, { outcome: a.result.outcome });
      } else if (decision === 'RETURNED') {
        changeStatus(s, u, a, 'VALIDATION', auctionTransitions, comment);
        a.result!.validatedBy = undefined;
        a.result!.validatedAt = undefined;
      } else {
        a.cancelReason = comment;
        changeStatus(s, u, a, 'CANCELLED', auctionTransitions, comment);
      }
    },
    onCancel: (r, u) => changeStatus(s, u, getAuction(r.entityId), 'VALIDATION', auctionTransitions, 'Submission withdrawn'),
  });

  const bidView = (b: Bid) => ({ ...b, customerName: s.customers.find((c) => c.id === b.customerId)?.name, submittedByName: userName(s, b.submittedBy) });

  const base = (a: Auction) => ({
    id: a.id, groupId: a.groupId, groupCode: a.groupCode, branchId: a.branchId, cycleNo: a.cycleNo, status: a.status,
    scheduledOpenAt: a.scheduledOpenAt, scheduledCloseAt: a.scheduledCloseAt, rules: a.rules, serverTime: s.now().toISOString(),
  });

  const present = (a: Auction, u: User) => {
    sync(a);
    if (isMember(u)) {
      const tickets = memberTickets(u, a);
      const elig = eligibility(a).filter((e) => tickets.some((t) => t.no === e.ticketNo));
      const decided = ['APPROVED', 'SETTLED'].includes(a.status) && a.result;
      return {
        ...base(a),
        view: 'MEMBER' as const,
        myTickets: elig,
        myBids: a.bids.filter((b) => b.customerId === u.customerId).map(bidView),
        outcome: decided ? { outcome: a.result!.outcome, winnerTicketNo: a.result!.winnerTicketNo, youWon: a.result!.winnerCustomerId === u.customerId } : null,
        actions: { canBid: hasPermission(u, 'bid:submit') && a.status === 'OPEN', canRaiseDispute: hasPermission(u, 'dispute:raise') && DISPUTABLE.includes(a.status) },
        myDisputes: a.disputes.filter((d) => d.raisedBy === u.id),
      };
    }
    const op = hasPermission(u, 'auction:operate');
    const has = (p: Parameters<typeof hasPermission>[1]) => hasPermission(u, p);
    const req = openRequest(a);
    return {
      ...base(a),
      view: 'STAFF' as const,
      bids: a.bids.map(bidView),
      bidCount: a.bids.length,
      eligibility: eligibility(a),
      readiness: readiness(a),
      result: a.result ? { ...a.result, validatedByName: userName(s, a.result.validatedBy), computedByName: userName(s, a.result.computedBy) } : null,
      disputes: a.disputes.map((d) => ({ ...d, raisedByName: userName(s, d.raisedBy), resolvedByName: userName(s, d.resolvedBy) })),
      history: a.history.map((h) => ({ ...h, actorName: userName(s, h.actorId) })),
      approvalRequests: s.approvals.filter((r) => r.entityType === 'AUCTION_RESULT' && r.entityId === a.id),
      cancelReason: a.cancelReason,
      payoutId: payoutFor(a)?.id,
      actions: {
        canReschedule: has('auction:create') && ['SCHEDULED', 'READY'].includes(a.status),
        canMarkReady: has('auction:prepare') && a.status === 'SCHEDULED',
        canCancel: op && LIVE.includes(a.status),
        canCloseEarly: op && a.status === 'OPEN',
        canCompute: op && ['CLOSED', 'VALIDATION'].includes(a.status),
        canDecideTie: op && a.status === 'VALIDATION' && Boolean(a.result?.needsManualDecision),
        canValidate: op && a.status === 'VALIDATION' && Boolean(a.result) && !a.result!.needsManualDecision && !a.result!.validatedBy,
        canSubmit: op && a.status === 'VALIDATION' && Boolean(a.result?.validatedBy),
        canWithdraw: req?.makerId === u.id,
        canRaiseDispute: has('dispute:raise') && DISPUTABLE.includes(a.status),
        canResolveDispute: has('dispute:resolve'),
        canCreatePayout: has('payout:create') && a.status === 'APPROVED' && a.result?.outcome === 'AWARDED' && !payoutFor(a),
      },
    };
  };

  return {
    present,
    /** Called when the prize payout is confirmed paid. */
    settle(u: User, auctionId: string) {
      const a = getAuction(auctionId);
      if (a.status === 'APPROVED') changeStatus(s, u, a, 'SETTLED', auctionTransitions, 'Prize payout paid');
    },
    sync,
    get: (id: string) => sync(getAuction(id)),

    meta: () => ({ winnerSelections: ['HIGHEST_BID', 'LOWEST_BID'], tieBreaks: ['EARLIEST_BID', 'MANUAL'], bidPolicies: ['SINGLE', 'MULTIPLE'], serverTime: s.now().toISOString() }),

    list(u: User, q: Query) {
      s.auctions.forEach(sync);
      const rows = s.auctions
        .filter((a) => (isMember(u) ? memberTickets(u, a).length > 0 : canAccessBranch(u, a.branchId)))
        .filter((a) => (!q.status || a.status === q.status) && (!q.groupId || a.groupId === q.groupId))
        .filter((a) => (!q.from || a.scheduledOpenAt >= String(q.from)) && (!q.to || a.scheduledOpenAt <= String(q.to)))
        .filter((a) => matches(q.q, a.id, a.groupCode))
        .sort((a, b) => b.scheduledOpenAt.localeCompare(a.scheduledOpenAt))
        .map((a) => ({ ...base(a), bidCount: isMember(u) ? undefined : a.bids.length, hasOpenDispute: isMember(u) ? undefined : openDisputes(a).length > 0 }));
      return paginate(rows, q);
    },

    getForUser(u: User, id: string) {
      const a = sync(getAuction(id));
      assertAccess(u, a);
      return present(a, u);
    },

    create(u: User, body: Body) {
      const c = new Check(body);
      const groupId = c.str('groupId', { required: true });
      const cycleNo = c.int('cycleNo', { required: true, min: 1, max: 1000 });
      const winnerSelection = c.oneOf('winnerSelection', ['HIGHEST_BID', 'LOWEST_BID'] as const);
      const tieBreak = c.oneOf('tieBreak', ['EARLIEST_BID', 'MANUAL'] as const);
      const bidPolicy = c.oneOf('bidPolicy', ['SINGLE', 'MULTIPLE'] as const);
      for (const k of ['excludePriorWinners', 'requireNoOverdue']) if (typeof body[k] !== 'boolean') c.errors[k] = 'Choose yes or no';
      c.done();
      const times = parseTimes(body);
      const g = s.groups.find((x) => x.id === groupId);
      if (!g) throw notFound('Group');
      assertBranch(u, g.branchId);
      if (g.status !== 'ACTIVE') throw conflict('GROUP_NOT_ACTIVE', 'Auctions can only be scheduled for active groups');
      if (s.auctions.some((x) => x.groupId === g.id && x.cycleNo === cycleNo && x.status !== 'CANCELLED')) {
        throw conflict('DUPLICATE_CYCLE', `Cycle ${cycleNo} already has a live auction for this group`);
      }
      const cfg = schemeCfg(g);
      const a: Auction = {
        id: s.nextId('AUC'), groupId: g.id, groupCode: g.code, branchId: g.branchId, schemeVersionId: g.schemeVersionId, cycleNo: cycleNo!,
        scheduledOpenAt: times.open, scheduledCloseAt: times.close, status: 'SCHEDULED',
        rules: {
          winnerSelection: winnerSelection!, tieBreak: tieBreak!, bidPolicy: bidPolicy!,
          excludePriorWinners: body.excludePriorWinners as boolean, requireNoOverdue: body.requireNoOverdue as boolean,
          minBidPaise: cfg.auction.minBidPaise, maxBidPaise: cfg.auction.maxBidPaise, bidIncrementPaise: cfg.auction.bidIncrementPaise,
          schemeAuctionMode: cfg.auction.mode,
        },
        bids: [], disputes: [], revision: 1, history: [], createdBy: u.id, createdAt: s.now().toISOString(),
      };
      s.auctions.push(a);
      audit(s, u, 'auction.create', 'auction', a.id, { groupId, cycleNo });
      return present(a, u);
    },

    reschedule(u: User, id: string, body: Body) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      if (!['SCHEDULED', 'READY'].includes(a.status)) throw conflict('INVALID_STATE', 'Only scheduled auctions can be rescheduled');
      const t = parseTimes(body);
      const from = `${a.scheduledOpenAt} - ${a.scheduledCloseAt}`;
      a.scheduledOpenAt = t.open;
      a.scheduledCloseAt = t.close;
      a.revision += 1;
      if (a.status === 'READY') changeStatus(s, u, a, 'SCHEDULED', auctionTransitions, 'Rescheduled; preparation must be re-confirmed');
      audit(s, u, 'auction.reschedule', 'auction', a.id, { from });
      return present(a, u);
    },

    markReady(u: User, id: string) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      const r = readiness(a);
      if (!r.allMet) throw conflict('NOT_READY', 'Preparation checks are not all met', r.items.filter((i) => !i.met));
      changeStatus(s, u, a, 'READY', auctionTransitions);
      audit(s, u, 'auction.ready', 'auction', a.id);
      return present(a, u);
    },

    cancel(u: User, id: string, body: Body) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, min: 5, max: 300 });
      c.done();
      if (payoutFor(a)) throw conflict('PAYOUT_EXISTS', 'A payout exists for this auction; cancel it through the payout workflow first');
      approvals.forceCancel(u, 'AUCTION_RESULT', a.id, `Auction cancelled: ${reason}`);
      a.cancelReason = reason;
      changeStatus(s, u, a, 'CANCELLED', auctionTransitions, reason);
      audit(s, u, 'auction.cancel', 'auction', a.id, { reason });
      return present(a, u);
    },

    closeEarly(u: User, id: string, body: Body) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, min: 5, max: 300 });
      c.done();
      changeStatus(s, u, a, 'CLOSED', auctionTransitions, `Closed early: ${reason}`);
      audit(s, u, 'auction.close_early', 'auction', a.id, { reason });
      return present(a, u);
    },

    // ---- Bidding (member-submitted) ----
    submitBid(u: User, id: string, body: Body) {
      if (!u.customerId) throw forbidden('Only a member session can submit bids', 'MEMBER_ONLY');
      const a = sync(getAuction(id));
      assertAccess(u, a);
      const c = new Check(body);
      const ticketNo = c.int('ticketNo', { required: true, min: 1 });
      const amountPaise = c.int('amountPaise', { required: true, min: 1 });
      const clientRequestId = c.str('clientRequestId', { required: true, min: 8, max: 100 });
      c.done();

      const dup = a.bids.find((b) => b.clientRequestId === clientRequestId && b.submittedBy === u.id);
      if (dup) return { accepted: true, duplicate: true, bid: bidView(dup) }; // retry: same result, nothing new recorded
      const now = s.now().toISOString();
      if (a.status !== 'OPEN' || now < a.scheduledOpenAt || now >= a.scheduledCloseAt) throw conflict('AUCTION_NOT_OPEN', 'This auction is not open for bids');
      const ticket = group(a).tickets.find((t) => t.no === ticketNo);
      if (!ticket || ticket.customerId !== u.customerId) throw forbidden('You can only bid for tickets you hold', 'NOT_YOUR_TICKET');
      const el = eligibility(a).find((e) => e.ticketNo === ticketNo)!;
      if (!el.eligible) throw conflict('NOT_ELIGIBLE', `Ticket ${ticketNo} cannot bid: ${el.reasons.join('; ')}`, el.reasons);
      const r = a.rules;
      const errors: Record<string, string> = {};
      if (r.minBidPaise !== undefined && amountPaise! < r.minBidPaise) errors.amountPaise = `Bid must be at least ${r.minBidPaise} paise`;
      if (r.maxBidPaise !== undefined && amountPaise! > r.maxBidPaise) errors.amountPaise = `Bid must not exceed ${r.maxBidPaise} paise`;
      if (r.bidIncrementPaise && (amountPaise! - (r.minBidPaise ?? 0)) % r.bidIncrementPaise !== 0) errors.amountPaise = `Bid must be in steps of ${r.bidIncrementPaise} paise`;
      if (Object.keys(errors).length) throw badRequest('Bid rejected', errors);
      if (r.bidPolicy === 'SINGLE' && a.bids.some((b) => b.ticketNo === ticketNo)) throw conflict('ALREADY_BID', 'This ticket has already placed a bid and only one is allowed');

      const bid: Bid = {
        id: s.nextId('BID'), auctionId: a.id, ticketNo: ticketNo!, customerId: u.customerId, amountPaise: amountPaise!, submittedBy: u.id,
        serverTimestamp: now, sequence: a.bids.length + 1, clientRequestId: clientRequestId!,
      };
      a.bids.push(bid); // bids are append-only: never edited or removed
      audit(s, u, 'bid.accept', 'auction', a.id, { bidId: bid.id, ticketNo });
      return { accepted: true, duplicate: false, bid: bidView(bid) };
    },

    // ---- Result ----
    computeResult(u: User, id: string) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      if (!['CLOSED', 'VALIDATION'].includes(a.status)) throw conflict('INVALID_STATE', 'The result can be computed once the auction is closed');
      if (a.status === 'VALIDATION' && openRequest(a)) throw conflict('INVALID_STATE', 'Withdraw the approval request before recomputing');
      const lowest = a.rules.winnerSelection === 'LOWEST_BID';
      const better = (x: number, y: number) => (lowest ? x < y : x > y);
      const bestPerTicket = new Map<number, Bid>();
      for (const b of a.bids) {
        const cur = bestPerTicket.get(b.ticketNo);
        if (!cur || better(b.amountPaise, cur.amountPaise)) bestPerTicket.set(b.ticketNo, b);
      }
      const bests = [...bestPerTicket.values()];
      const result: AuctionResult = { outcome: 'NO_VALID_BID', tiedTicketNos: [], needsManualDecision: false, computedAt: s.now().toISOString(), computedBy: u.id };
      if (bests.length) {
        const top = bests.reduce((m, b) => (better(b.amountPaise, m.amountPaise) ? b : m));
        const tied = bests.filter((b) => b.amountPaise === top.amountPaise).sort((x, y) => x.sequence - y.sequence);
        result.outcome = 'AWARDED';
        result.tiedTicketNos = tied.map((b) => b.ticketNo);
        result.winningAmountPaise = top.amountPaise;
        if (tied.length === 1 || a.rules.tieBreak === 'EARLIEST_BID') {
          const w = tied[0]!;
          result.winnerTicketNo = w.ticketNo;
          result.winnerCustomerId = w.customerId;
          result.winningBidId = w.id;
          if (tied.length > 1) result.tieBreakApplied = 'EARLIEST_BID';
        } else {
          result.needsManualDecision = true;
        }
      }
      if (a.status === 'CLOSED') changeStatus(s, u, a, 'VALIDATION', auctionTransitions, 'Result computed');
      a.result = result;
      a.revision += 1;
      audit(s, u, 'auction.compute', 'auction', a.id, { outcome: result.outcome, tied: result.tiedTicketNos });
      return present(a, u);
    },

    decideTie(u: User, id: string, body: Body) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      const c = new Check(body);
      const ticketNo = c.int('ticketNo', { required: true, min: 1 });
      const reason = c.str('reason', { required: true, min: 5, max: 300 });
      c.done();
      if (a.status !== 'VALIDATION' || !a.result?.needsManualDecision) throw conflict('INVALID_STATE', 'No manual tie decision is pending');
      if (!a.result.tiedTicketNos.includes(ticketNo!)) throw badRequest('Validation failed', { ticketNo: 'Choose one of the tied tickets' });
      const bid = a.bids.filter((b) => b.ticketNo === ticketNo && b.amountPaise === a.result!.winningAmountPaise).sort((x, y) => x.sequence - y.sequence)[0]!;
      Object.assign(a.result, { winnerTicketNo: ticketNo, winnerCustomerId: bid.customerId, winningBidId: bid.id, needsManualDecision: false, tieBreakApplied: 'MANUAL', manualReason: reason });
      a.revision += 1;
      audit(s, u, 'auction.tie_decision', 'auction', a.id, { ticketNo, reason });
      return present(a, u);
    },

    validate(u: User, id: string) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      if (a.status !== 'VALIDATION' || !a.result) throw conflict('INVALID_STATE', 'There is no result to validate');
      if (a.result.needsManualDecision) throw conflict('TIE_UNRESOLVED', 'Resolve the tie before validating');
      if (openDisputes(a).length) throw conflict('OPEN_DISPUTE', 'Resolve open disputes before validating');
      // Integrity check: the bid log must be a contiguous, append-only sequence.
      if (a.bids.some((b, i) => b.sequence !== i + 1)) throw conflict('BID_LOG_INVALID', 'The bid sequence is inconsistent');
      a.result.validatedBy = u.id;
      a.result.validatedAt = s.now().toISOString();
      a.revision += 1;
      audit(s, u, 'auction.validate', 'auction', a.id);
      return present(a, u);
    },

    submitForApproval(u: User, id: string) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      if (a.status !== 'VALIDATION' || !a.result?.validatedBy) throw conflict('NOT_VALIDATED', 'Validate the result first');
      if (openDisputes(a).length) throw conflict('OPEN_DISPUTE', 'Resolve open disputes first');
      changeStatus(s, u, a, 'APPROVAL_PENDING', auctionTransitions);
      approvals.submit(u, { entityType: 'AUCTION_RESULT', entityId: a.id, entityLabel: `Auction ${a.id} - ${a.groupCode} cycle ${a.cycleNo}`, branchId: a.branchId, revision: a.revision });
      return present(a, u);
    },

    withdraw(u: User, id: string) {
      const a = sync(getAuction(id));
      const r = openRequest(a);
      if (!r) throw conflict('INVALID_STATE', 'No open approval request');
      approvals.withdraw(u, r.id);
      return present(a, u);
    },

    // ---- Disputes ----
    raiseDispute(u: User, id: string, body: Body) {
      const a = sync(getAuction(id));
      assertAccess(u, a);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, min: 5, max: 500 });
      c.done();
      if (!DISPUTABLE.includes(a.status)) throw conflict('INVALID_STATE', 'Disputes can be raised once the auction has closed');
      const d = { id: s.nextId('DSP'), raisedBy: u.id, raisedAt: s.now().toISOString(), reason: reason!, status: 'OPEN' as const };
      a.disputes.push(d);
      audit(s, u, 'auction.dispute', 'auction', a.id, { disputeId: d.id });
      return present(a, u);
    },

    resolveDispute(u: User, id: string, disputeId: string, body: Body) {
      const a = sync(getAuction(id));
      assertBranch(u, a.branchId);
      const d = a.disputes.find((x) => x.id === disputeId);
      if (!d) throw notFound('Dispute');
      const c = new Check(body);
      const resolution = c.oneOf('resolution', ['DISMISSED', 'UPHELD'] as const);
      const comment = c.str('comment', { required: true, min: 5, max: 500 });
      c.done();
      if (d.status !== 'OPEN') throw conflict('INVALID_STATE', 'Dispute is already resolved');
      if (resolution === 'UPHELD' && payoutFor(a)) throw conflict('PAYOUT_EXISTS', 'A payout exists for this auction; stop it first');
      d.status = resolution!;
      d.resolvedBy = u.id;
      d.resolvedAt = s.now().toISOString();
      d.resolution = comment;
      if (resolution === 'UPHELD') {
        // An upheld dispute invalidates the auction. A new auction must be scheduled.
        approvals.forceCancel(u, 'AUCTION_RESULT', a.id, 'Dispute upheld');
        a.cancelReason = `Dispute upheld: ${comment}`;
        changeStatus(s, u, a, 'CANCELLED', auctionTransitions, a.cancelReason);
      }
      audit(s, u, 'auction.dispute_resolve', 'auction', a.id, { disputeId, resolution });
      return present(a, u);
    },

  };
};

export type AuctionService = ReturnType<typeof createAuctionService>;
