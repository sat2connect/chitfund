import { PAYOUT_CHANNELS, payoutTransitions } from '../domain/rules.js';
import type { Payout, PayoutStatus, User } from '../domain/types.js';
import { badRequest, conflict, forbidden, notFound } from '../errors/AppError.js';
import { assertBranch, hasPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import type { AccountingService } from './accountingService.js';
import type { ApprovalService } from './approvalService.js';
import type { AuctionService } from './auctionService.js';
import { audit, changeStatus, inScope, logActivity, matches, paginate, userName } from './common.js';
import type { InstalmentService } from './instalmentService.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

export const createPayoutService = (
  s: Store, approvals: ApprovalService, accounting: AccountingService, auctions: AuctionService, instalments: InstalmentService,
) => {
  const get = (id: string) => {
    const p = s.payouts.find((x) => x.id === id);
    if (!p) throw notFound('Payout');
    return p;
  };
  const scoped = (u: User, id: string) => {
    const p = get(id);
    assertBranch(u, p.branchId);
    return p;
  };
  const openRequest = (p: Payout) =>
    s.approvals.find((r) => r.entityType === 'PAYOUT' && r.entityId === p.id && (r.status === 'PENDING' || r.status === 'IN_REVIEW'));
  const approverOf = (p: Payout) => s.approvals.filter((r) => r.entityType === 'PAYOUT' && r.entityId === p.id && r.status === 'APPROVED').pop()?.checkerId;
  const accountByCode = (code: string) => {
    const a = s.accounts.find((x) => x.code === code);
    if (!a) throw conflict('POSTING_RULE_INVALID', `Posting rule refers to unknown account ${code}`);
    return a;
  };

  /** System checks come from data; document confirmations are manual and need a reference. */
  const eligibility = (p: Payout) => {
    const a = s.auctions.find((x) => x.id === p.auctionId)!;
    const customer = s.customers.find((c) => c.id === p.customerId)!;
    const ticket = s.groups.find((g) => g.id === p.groupId)?.tickets.find((t) => t.no === p.ticketNo);
    const overdue = s.instalments.filter((i) => i.customerId === p.customerId).map(instalments.present).filter((i) => i.status === 'OVERDUE');
    const items = [
      { key: 'AUCTION_APPROVED', label: 'Auction result is approved', automatic: true, met: ['APPROVED', 'SETTLED'].includes(a.status), detail: `Auction status: ${a.status}` },
      { key: 'NO_DISPUTE', label: 'No open dispute on the auction', automatic: true, met: !a.disputes.some((d) => d.status === 'OPEN'), detail: `${a.disputes.filter((d) => d.status === 'OPEN').length} open` },
      { key: 'KYC', label: 'Winner KYC is verified', automatic: true, met: customer.kycStatus === 'VERIFIED', detail: `KYC status: ${customer.kycStatus}` },
      { key: 'TICKET_HOLDER', label: 'Winning ticket is still held by the winner', automatic: true, met: ticket?.customerId === p.customerId, detail: `Ticket ${p.ticketNo}` },
      ...p.documents.map((d) => ({
        key: d.id, label: `Document: ${d.title}`, automatic: false, met: d.status === 'CONFIRMED',
        detail: d.status === 'CONFIRMED' ? `Confirmed by ${userName(s, d.confirmedBy)} (ref: ${d.reference})` : 'Awaiting confirmation',
      })),
    ];
    return {
      items,
      allMet: items.every((i) => i.met),
      // Informational only: no rule has been approved that blocks payout on dues.
      info: { overdueInstalments: overdue.length, overduePaise: overdue.reduce((x, i) => x + i.outstandingPaise, 0) },
    };
  };

  const present = (p: Payout, u: User) => {
    const status = p.status;
    const req = openRequest(p);
    const stage = (...st: PayoutStatus[]) => st.includes(status);
    return {
      ...p,
      customerName: s.customers.find((c) => c.id === p.customerId)?.name,
      createdByName: userName(s, p.createdBy),
      eligibility: eligibility(p),
      history: p.history.map((h) => ({ ...h, actorName: userName(s, h.actorId) })),
      documents: p.documents.map((d) => ({ ...d, confirmedByName: userName(s, d.confirmedBy) })),
      approvalRequests: s.approvals.filter((r) => r.entityType === 'PAYOUT' && r.entityId === p.id),
      reconciliation: s.reconResults.filter((r) => r.paymentId === p.id),
      amountNotice: 'Amount entered manually by Finance. It is not calculated by the system; the calculation engine has not been approved.',
      notificationNotice: 'Customer notification is not sent: no notification provider has been selected.',
      actions: {
        canEdit: hasPermission(u, 'payout:create') && status === 'DRAFT' && p.createdBy === u.id,
        canSubmitForReview: hasPermission(u, 'payout:create') && status === 'DRAFT',
        canConfirmDocuments: hasPermission(u, 'payout:review') && status === 'ELIGIBILITY_REVIEW',
        canRequestApproval: hasPermission(u, 'payout:review') && status === 'ELIGIBILITY_REVIEW',
        canSendBack: hasPermission(u, 'payout:review') && status === 'ELIGIBILITY_REVIEW',
        canWithdraw: req?.makerId === u.id,
        canInitiate: hasPermission(u, 'payout:disburse') && stage('APPROVED', 'FAILED'),
        canRecordDisbursement: hasPermission(u, 'payout:disburse') && status === 'DISBURSEMENT_PENDING',
        canHold: hasPermission(u, 'payout:hold') && !stage('PAID', 'ON_HOLD'),
        canRelease: hasPermission(u, 'payout:hold') && status === 'ON_HOLD',
      },
    };
  };

  approvals.register('PAYOUT', {
    permission: 'payout:approve',
    requiresReview: false,
    currentRevision: (r) => get(r.entityId).revision,
    onDecision(r, decision, u, comment) {
      const p = get(r.entityId);
      if (decision === 'APPROVED') {
        // Whoever entered the amount may not approve it, even if they also hold the approver role.
        if (p.createdBy === u.id) throw forbidden('You entered this payout amount and cannot approve it', 'MAKER_CHECKER');
        if (!eligibility(p).allMet) throw conflict('NOT_ELIGIBLE', 'Eligibility conditions are no longer satisfied');
        changeStatus(s, u, p, 'APPROVED', payoutTransitions, comment);
        audit(s, u, 'payout.approve', 'payout', p.id);
      } else if (decision === 'RETURNED') {
        changeStatus(s, u, p, 'ELIGIBILITY_REVIEW', payoutTransitions, comment);
      } else {
        changeStatus(s, u, p, 'DRAFT', payoutTransitions, `Rejected: ${comment}`);
      }
    },
    onCancel: (r, u) => changeStatus(s, u, get(r.entityId), 'ELIGIBILITY_REVIEW', payoutTransitions, 'Request withdrawn'),
  });

  const parseAmount = (c: Check, a: ReturnType<AuctionService['get']>) => {
    const amountPaise = c.int('amountPaise', { required: true, min: 1 });
    const amountBasis = c.str('amountBasis', { required: true, min: 10, max: 500 });
    c.done();
    const chit = s.schemeVersions.find((v) => v.id === a.schemeVersionId)!.config.chitValuePaise;
    if (amountPaise! > chit) throw badRequest('Validation failed', { amountPaise: 'Amount cannot exceed the chit value' }); // sanity ceiling, not a formula
    return { amountPaise: amountPaise!, amountBasis: amountBasis! };
  };

  return {
    meta: () => ({ channels: PAYOUT_CHANNELS }),

    list(u: User, q: Query) {
      const rows = inScope(u, s.payouts)
        .filter((p) => (!q.status || p.status === q.status) && (!q.groupId || p.groupId === q.groupId))
        .map((p) => ({ ...p, customerName: s.customers.find((c) => c.id === p.customerId)?.name }))
        .filter((p) => matches(q.q, p.id, p.customerName, p.groupCode, p.auctionId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => ({
          id: p.id, auctionId: p.auctionId, groupCode: p.groupCode, ticketNo: p.ticketNo, customerId: p.customerId, customerName: p.customerName,
          amountPaise: p.amountPaise, status: p.status, channel: p.channel, reconciliationStatus: p.reconciliationStatus, createdAt: p.createdAt,
        }));
      return paginate(rows, q);
    },

    getForUser: (u: User, id: string) => present(scoped(u, id), u),

    create(u: User, body: Body) {
      const c = new Check(body);
      const auctionId = c.str('auctionId', { required: true });
      const clientRequestId = c.str('clientRequestId', { required: true, min: 8, max: 100 });
      c.done();
      const a = auctions.get(auctionId!);
      const existingByRequest = s.payouts.find((p) => p.clientRequestId === clientRequestId && p.createdBy === u.id);
      if (existingByRequest) return { payout: present(existingByRequest, u), duplicate: true };
      assertBranch(u, a.branchId);
      if (a.status !== 'APPROVED' || a.result?.outcome !== 'AWARDED') throw conflict('AUCTION_NOT_APPROVED', 'A payout needs an approved auction result with a winner');
      if (a.disputes.some((d) => d.status === 'OPEN')) throw conflict('OPEN_DISPUTE', 'Resolve open disputes first');
      if (s.payouts.some((p) => p.auctionId === a.id)) throw conflict('PAYOUT_EXISTS', 'A payout already exists for this auction');
      const money = parseAmount(new Check(body), a);
      const g = s.groups.find((x) => x.id === a.groupId)!;
      const cfg = s.schemeVersions.find((v) => v.id === a.schemeVersionId)!.config;
      const p: Payout = {
        id: s.nextId('PYT'), auctionId: a.id, groupId: g.id, groupCode: g.code, branchId: a.branchId, ticketNo: a.result!.winnerTicketNo!,
        customerId: a.result!.winnerCustomerId!, status: 'DRAFT', ...money,
        documents: cfg.requiredDocuments.map((title) => ({ id: s.nextId('PDOC'), title, status: 'PENDING' as const })),
        reconciliationStatus: 'PENDING', clientRequestId, revision: 1, history: [], createdBy: u.id, createdAt: s.now().toISOString(),
      };
      s.payouts.push(p);
      audit(s, u, 'payout.create', 'payout', p.id, { auctionId: a.id, amountPaise: p.amountPaise });
      return { payout: present(p, u), duplicate: false };
    },

    update(u: User, id: string, body: Body) {
      const p = scoped(u, id);
      if (p.status !== 'DRAFT') throw conflict('READ_ONLY', 'Only draft payouts can be edited');
      if (p.createdBy !== u.id) throw forbidden('Only the creator can edit a draft', 'MAKER_ONLY');
      const money = parseAmount(new Check(body), s.auctions.find((x) => x.id === p.auctionId)!);
      Object.assign(p, money);
      p.revision += 1;
      audit(s, u, 'payout.edit', 'payout', id, { amountPaise: p.amountPaise });
      return present(p, u);
    },

    submitForReview(u: User, id: string) {
      const p = scoped(u, id);
      changeStatus(s, u, p, 'ELIGIBILITY_REVIEW', payoutTransitions);
      return present(p, u);
    },

    sendBack(u: User, id: string, body: Body) {
      const p = scoped(u, id);
      const c = new Check(body);
      const comment = c.str('comment', { required: true, min: 5, max: 300 });
      c.done();
      changeStatus(s, u, p, 'DRAFT', payoutTransitions, comment);
      return present(p, u);
    },

    confirmDocument(u: User, id: string, docId: string, body: Body) {
      const p = scoped(u, id);
      if (p.status !== 'ELIGIBILITY_REVIEW') throw conflict('INVALID_STATE', 'Documents are confirmed during eligibility review');
      const d = p.documents.find((x) => x.id === docId);
      if (!d) throw notFound('Document');
      const c = new Check(body);
      const reference = c.str('reference', { required: true, max: 200 });
      c.done();
      Object.assign(d, { status: 'CONFIRMED', reference, confirmedBy: u.id, confirmedAt: s.now().toISOString() });
      audit(s, u, 'payout.document', 'payout', id, { document: d.title, reference });
      return present(p, u);
    },

    requestApproval(u: User, id: string) {
      const p = scoped(u, id);
      if (p.status !== 'ELIGIBILITY_REVIEW') throw conflict('INVALID_TRANSITION', 'Payout must be in eligibility review');
      const e = eligibility(p);
      if (!e.allMet) throw conflict('NOT_ELIGIBLE', 'Eligibility conditions are not met', e.items.filter((i) => !i.met));
      changeStatus(s, u, p, 'PENDING_APPROVAL', payoutTransitions);
      approvals.submit(u, { entityType: 'PAYOUT', entityId: p.id, entityLabel: `Payout ${p.id} - ${p.groupCode} ticket ${p.ticketNo}`, branchId: p.branchId, revision: p.revision });
      return present(p, u);
    },

    withdraw(u: User, id: string) {
      const p = scoped(u, id);
      const r = openRequest(p);
      if (!r) throw conflict('INVALID_STATE', 'No open approval request');
      approvals.withdraw(u, r.id);
      return present(p, u);
    },

    initiateDisbursement(u: User, id: string, body: Body) {
      const p = scoped(u, id);
      const c = new Check(body);
      const channel = c.oneOf('channel', PAYOUT_CHANNELS);
      c.done();
      if (approverOf(p) === u.id) throw forbidden('The approver cannot also initiate the disbursement', 'MAKER_CHECKER');
      changeStatus(s, u, p, 'DISBURSEMENT_PENDING', payoutTransitions, p.status === 'FAILED' ? 'Retry after failure' : undefined);
      p.channel = channel;
      p.failureReason = undefined;
      audit(s, u, 'payout.initiate', 'payout', id, { channel });
      return present(p, u);
    },

    /** Records that Finance has paid the member outside this system. Nothing here moves money. */
    recordDisbursement(u: User, id: string, body: Body) {
      const p = scoped(u, id);
      const c = new Check(body);
      const reference = c.str('reference', { required: true, min: 3, max: 100 });
      const paidDate = c.date('paidDate', true);
      c.done();
      if (p.status !== 'DISBURSEMENT_PENDING') throw conflict('INVALID_TRANSITION', 'Payout is not awaiting disbursement');
      if (paidDate! > s.today()) throw badRequest('Validation failed', { paidDate: 'Paid date cannot be in the future' });
      if (s.payouts.some((x) => x.id !== p.id && x.disbursement?.reference.toLowerCase() === reference!.toLowerCase())) {
        throw conflict('DUPLICATE_REFERENCE', `Disbursement reference ${reference} is already used by another payout`);
      }
      const journal = accounting.postSystemJournal(u, {
        date: paidDate!, memo: `Prize payout ${p.id} to ${p.customerId}`, simulated: false, source: { type: 'PAYOUT', id: p.id },
        lines: [
          { accountId: accountByCode(s.postingRules.payoutDebitCode).id, debitPaise: p.amountPaise, creditPaise: 0 },
          { accountId: accountByCode(s.postingRules.payoutCreditByChannel[p.channel!] ?? '').id, debitPaise: 0, creditPaise: p.amountPaise },
        ],
      });
      changeStatus(s, u, p, 'PAID', payoutTransitions, `Reference ${reference}`);
      p.disbursement = { reference: reference!, paidDate: paidDate!, recordedBy: u.id, recordedAt: s.now().toISOString() };
      p.journalId = journal.id;
      auctions.settle(u, p.auctionId);
      logActivity(s, u, 'customer', p.customerId, 'PAYOUT_PAID', `Prize payout ${p.id} recorded as paid (${p.channel}). Customer notification not sent: no provider selected.`);
      audit(s, u, 'payout.paid', 'payout', id, { reference, amountPaise: p.amountPaise });
      return present(p, u);
    },

    recordFailure(u: User, id: string, body: Body) {
      const p = scoped(u, id);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, min: 5, max: 300 });
      c.done();
      changeStatus(s, u, p, 'FAILED', payoutTransitions, reason);
      p.failureReason = reason;
      audit(s, u, 'payout.failed', 'payout', id, { reason });
      return present(p, u);
    },

    hold(u: User, id: string, body: Body) {
      const p = scoped(u, id);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, min: 5, max: 300 });
      c.done();
      let prev = p.status;
      if (p.status === 'PENDING_APPROVAL') {
        approvals.forceCancel(u, 'PAYOUT', p.id, 'Payout put on hold');
        prev = 'ELIGIBILITY_REVIEW';
        changeStatus(s, u, p, 'ELIGIBILITY_REVIEW', payoutTransitions, 'Approval request cancelled (payout held)'); // hold resumes from review
      }
      changeStatus(s, u, p, 'ON_HOLD', payoutTransitions, reason);
      p.holdPrevious = prev;
      p.holdReason = reason;
      audit(s, u, 'payout.hold', 'payout', id, { reason });
      return present(p, u);
    },

    release(u: User, id: string, body: Body) {
      const p = scoped(u, id);
      const c = new Check(body);
      const comment = c.str('comment', { required: true, min: 5, max: 300 });
      c.done();
      if (p.status !== 'ON_HOLD') throw conflict('INVALID_STATE', 'Payout is not on hold');
      changeStatus(s, u, p, p.holdPrevious ?? 'DRAFT', payoutTransitions, comment);
      p.holdPrevious = undefined;
      p.holdReason = undefined;
      audit(s, u, 'payout.release', 'payout', id);
      return present(p, u);
    },

    // ---- Reconciliation against bank DEBIT statement lines ----
    reconciliationQueue(u: User, q: Query) {
      const rows = inScope(u, s.payouts)
        .filter((p) => p.status === 'PAID' && p.reconciliationStatus !== 'MATCHED')
        .filter((p) => !q.reconciliationStatus || p.reconciliationStatus === q.reconciliationStatus)
        .map((p) => {
          const line = s.bankLines.find((l) => l.status === 'UNMATCHED' && l.direction === 'DEBIT' && p.disbursement && l.reference.toLowerCase() === p.disbursement.reference.toLowerCase());
          return {
            id: p.id, customerName: s.customers.find((c) => c.id === p.customerId)?.name, amountPaise: p.amountPaise, channel: p.channel,
            reference: p.disbursement?.reference, paidDate: p.disbursement?.paidDate, reconciliationStatus: p.reconciliationStatus,
            suggestion: line ? { bankLineId: line.id, amountPaise: line.amountPaise, differencePaise: line.amountPaise - p.amountPaise } : null,
          };
        })
        .sort((a, b) => (a.paidDate ?? '').localeCompare(b.paidDate ?? ''));
      return paginate(rows, q);
    },

    match(u: User, body: Body) {
      const c = new Check(body);
      const payoutId = c.str('payoutId', { required: true });
      const bankLineId = c.str('bankLineId', { required: true });
      const comment = c.str('comment', { max: 300 });
      c.done();
      const p = scoped(u, payoutId!);
      const line = s.bankLines.find((l) => l.id === bankLineId);
      if (!line) throw notFound('Bank statement line');
      if (p.status !== 'PAID') throw conflict('INVALID_STATE', 'Only paid payouts can be reconciled');
      if (p.reconciliationStatus !== 'PENDING') throw conflict('INVALID_STATE', `Payout reconciliation status is ${p.reconciliationStatus}`);
      if (line.direction !== 'DEBIT') throw conflict('WRONG_DIRECTION', 'Payouts are matched to debit statement lines');
      if (line.status !== 'UNMATCHED') throw conflict('LINE_ALREADY_MATCHED', 'This statement line is already matched');
      const diff = line.amountPaise - p.amountPaise;
      if (diff !== 0 && !comment) throw badRequest('Validation failed', { comment: 'A comment is required when the amounts differ' });
      line.status = 'MATCHED';
      line.payoutId = p.id;
      p.reconciliationStatus = diff === 0 ? 'MATCHED' : 'EXCEPTION';
      const result = { id: s.nextId('REC'), paymentId: p.id, bankLineId: line.id, result: diff === 0 ? ('MATCHED' as const) : ('EXCEPTION' as const), differencePaise: diff, comment, by: u.id, at: s.now().toISOString() };
      s.reconResults.push(result);
      audit(s, u, 'payout.reconcile', 'payout', p.id, { bankLineId, differencePaise: diff });
      return result;
    },
  };
};

export type PayoutService = ReturnType<typeof createPayoutService>;
