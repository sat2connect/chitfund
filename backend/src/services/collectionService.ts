import { PAYMENT_MODES } from '../domain/rules.js';
import type { Allocation, Instalment, InstalmentStatus, Payment, PaymentAttempt, PaymentMode, User } from '../domain/types.js';
import { badRequest, conflict, forbidden, notFound } from '../errors/AppError.js';
import { assertBranch, canAccessBranch } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import type { AccountingService } from './accountingService.js';
import type { ApprovalService } from './approvalService.js';
import { audit, inScope, logActivity, matches, paginate, userName } from './common.js';
import type { InstalmentService } from './instalmentService.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

export const createCollectionService = (
  s: Store, approvals: ApprovalService, instalments: InstalmentService, accounting: AccountingService,
) => {
  const getPayment = (id: string) => {
    const p = s.payments.find((x) => x.id === id);
    if (!p) throw notFound('Payment');
    return p;
  };
  const accountByCode = (code: string) => {
    const a = s.accounts.find((x) => x.code === code);
    if (!a) throw conflict('POSTING_RULE_INVALID', `Posting rule refers to unknown account ${code}`);
    return a;
  };
  const openReversal = (paymentId: string) =>
    s.approvals.find((r) => r.entityType === 'PAYMENT_REVERSAL' && r.entityId === paymentId && (r.status === 'PENDING' || r.status === 'IN_REVIEW'));

  /**
   * Plans how an amount is allocated to instalments (read-only).
   * Only instalments that have fallen due can be paid. Default order is oldest due first (PLACEHOLDER policy).
   */
  const plan = (customerId: string, amountPaise: number, instalmentIds?: string[]) => {
    const eligible = s.instalments
      .filter((i) => i.customerId === customerId)
      .map(instalments.present)
      .filter((i) => i.status !== 'SCHEDULED' && i.outstandingPaise > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.groupCode.localeCompare(b.groupCode) || a.ticketNo - b.ticketNo);
    let targets = eligible;
    if (instalmentIds?.length) {
      targets = instalmentIds.map((id) => {
        const t = eligible.find((i) => i.id === id);
        if (!t) throw conflict('INSTALMENT_NOT_PAYABLE', `Instalment ${id} is not payable (not due, already paid, or not this customer's)`);
        return t;
      });
    }
    const totalOutstanding = targets.reduce((a, i) => a + i.outstandingPaise, 0);
    if (amountPaise > totalOutstanding) {
      throw conflict('EXCEEDS_OUTSTANDING', 'Amount exceeds the outstanding balance of the selected dues', { outstandingPaise: totalOutstanding });
    }
    const out: { instalmentId: string; branchId: string; amountPaise: number }[] = [];
    let left = amountPaise;
    for (const t of targets) {
      if (left <= 0) break;
      const a = Math.min(left, t.outstandingPaise);
      out.push({ instalmentId: t.id, branchId: t.branchId, amountPaise: a });
      left -= a;
    }
    return out;
  };

  /**
   * An instalment's status is derived, so it is recomputed by itself whenever its paid amount changes. This leaves the
   * audit trail: what it was, what it is now, and which payment (with which effective receipt date) caused it.
   */
  const recordRecompute = (u: User, inst: Instalment, before: InstalmentStatus, why: { paymentId: string; cause: string; effectiveReceiptDate: string }) => {
    const after = instalments.statusOf(inst);
    if (before !== after) audit(s, u, 'instalment.status_recomputed', 'instalment', inst.id, { from: before, to: after, paidPaise: inst.paidPaise, ...why });
  };

  /** Creates the confirmed payment, receipt, allocations and journal together; nothing is changed if validation fails. */
  const confirmPayment = (u: User, p: {
    customerId: string; mode: PaymentMode; amountPaise: number; reference?: string; receivedDate: string; instalmentIds?: string[];
    simulated: boolean; attemptId?: string; clientRequestId?: string;
  }) => {
    const allocs = plan(p.customerId, p.amountPaise, p.instalmentIds);
    const branchId = allocs[0]!.branchId;
    const paymentId = s.nextId('PAY');
    const receiptId = s.nextId('RCP');
    const debitCode = s.postingRules.debitByMode[p.mode];
    if (!debitCode) throw conflict('POSTING_RULE_MISSING', `No posting rule for payment mode ${p.mode}`);
    const journal = accounting.postSystemJournal(u, {
      date: p.receivedDate, memo: `Collection ${receiptId} from ${p.customerId}`, simulated: p.simulated,
      source: { type: 'PAYMENT', id: paymentId },
      lines: [
        { accountId: accountByCode(debitCode).id, debitPaise: p.amountPaise, creditPaise: 0 },
        { accountId: accountByCode(s.postingRules.creditAccountCode).id, debitPaise: 0, creditPaise: p.amountPaise },
      ],
    });
    const payment: Payment = {
      id: paymentId, customerId: p.customerId, branchId, mode: p.mode, amountPaise: p.amountPaise, reference: p.reference,
      receivedDate: p.receivedDate, status: 'SUCCESSFUL', simulated: p.simulated, attemptId: p.attemptId, clientRequestId: p.clientRequestId,
      receiptId, journalId: journal.id, reconciliationStatus: p.mode === 'CASH' || p.simulated ? 'NOT_APPLICABLE' : 'PENDING',
      recordedBy: u.id, createdAt: s.now().toISOString(),
    };
    s.payments.push(payment);
    s.receipts.push({ id: receiptId, paymentId, customerId: p.customerId, branchId, amountPaise: p.amountPaise, issuedAt: s.now().toISOString(), status: 'ISSUED' });
    for (const a of allocs) {
      const inst = instalments.byId(a.instalmentId)!;
      const before = instalments.statusOf(inst);
      s.allocations.push({ id: s.nextId('ALC'), paymentId, instalmentId: a.instalmentId, amountPaise: a.amountPaise, status: 'ACTIVE' });
      inst.paidPaise += a.amountPaise;
      recordRecompute(u, inst, before, { paymentId, cause: 'PAYMENT_CONFIRMED', effectiveReceiptDate: p.receivedDate });
    }
    logActivity(s, u, 'customer', p.customerId, 'PAYMENT', `Payment ${paymentId} of ${p.amountPaise / 100} INR received (${p.mode}${p.simulated ? ', simulated' : ''}); receipt ${receiptId}`);
    audit(s, u, 'payment.confirm', 'payment', paymentId, { mode: p.mode, amountPaise: p.amountPaise, simulated: p.simulated });
    return payment;
  };

  const reversePayment = (u: User, pay: Payment) => {
    if (pay.status !== 'SUCCESSFUL') throw conflict('INVALID_STATE', 'Payment is not in a reversible state');
    if (pay.reconciliationStatus === 'MATCHED' || pay.reconciliationStatus === 'EXCEPTION') {
      throw conflict('RECONCILED', 'Reconciled payments cannot be reversed; raise an adjustment instead');
    }
    const journal = s.journals.find((j) => j.id === pay.journalId)!;
    accounting.reverseJournal(u, journal, pay.reversalReason ?? 'Payment reversed', 'PAYMENT_REVERSAL', pay.id);
    for (const a of s.allocations.filter((x) => x.paymentId === pay.id && x.status === 'ACTIVE')) {
      const inst = instalments.byId(a.instalmentId)!;
      const before = instalments.statusOf(inst);
      a.status = 'REVERSED';
      inst.paidPaise -= a.amountPaise;
      recordRecompute(u, inst, before, { paymentId: pay.id, cause: 'PAYMENT_REVERSED', effectiveReceiptDate: pay.receivedDate });
    }
    const r = s.receipts.find((x) => x.id === pay.receiptId);
    if (r) r.status = 'VOID';
    pay.status = 'REVERSED';
    pay.reversedAt = s.now().toISOString();
    logActivity(s, u, 'customer', pay.customerId, 'PAYMENT_REVERSED', `Payment ${pay.id} reversed`);
  };

  approvals.register('PAYMENT_REVERSAL', {
    permission: 'payment:reverse-approve',
    requiresReview: false,
    currentRevision: () => 1,
    onDecision(r, decision, u) {
      const pay = getPayment(r.entityId);
      if (decision === 'APPROVED') reversePayment(u, pay);
      else pay.reversalReason = undefined;
    },
    onCancel(r) {
      getPayment(r.entityId).reversalReason = undefined;
    },
  });

  const presentPayment = (p: Payment) => {
    const customer = s.customers.find((c) => c.id === p.customerId);
    return {
      ...p,
      customerName: customer?.name,
      recordedByName: userName(s, p.recordedBy),
      receiptNumber: p.receiptId,
      reversalPending: Boolean(openReversal(p.id)),
    };
  };

  const validateModeFields = (c: Check, body: Body) => {
    const customerId = c.str('customerId', { required: true });
    const amountPaise = c.int('amountPaise', { required: true, min: 1 });
    const instalmentIds = Array.isArray(body.instalmentIds) ? (body.instalmentIds as unknown[]).map(String) : undefined;
    return { customerId, amountPaise, instalmentIds };
  };

  return {
    meta: () => ({ modes: PAYMENT_MODES, today: s.today() }),

    recordOffline(u: User, body: Body) {
      const c = new Check(body);
      const { customerId, amountPaise, instalmentIds } = validateModeFields(c, body);
      const mode = c.oneOf('mode', PAYMENT_MODES);
      const reference = c.str('reference', { max: 100 });
      const receivedDate = c.date('receivedDate') ?? s.today();
      const clientRequestId = c.str('clientRequestId', { required: true, min: 8, max: 100 });
      if (mode && mode !== 'CASH' && !reference) c.errors.reference = 'Reference is required for non-cash payments';
      c.done();
      if (receivedDate > s.today()) throw badRequest('Validation failed', { receivedDate: 'Received date cannot be in the future' });

      // Idempotent retry: the same client request returns the original result and posts nothing new.
      const existing = s.payments.find((p) => p.clientRequestId === clientRequestId && p.recordedBy === u.id);
      if (existing) return { payment: presentPayment(existing), duplicate: true };

      const customer = s.customers.find((x) => x.id === customerId);
      if (!customer) throw notFound('Customer');
      assertBranch(u, customer.branchId);
      if (reference && s.payments.some((p) => p.mode === mode && p.reference?.toLowerCase() === reference.toLowerCase() && p.status === 'SUCCESSFUL')) {
        throw conflict('DUPLICATE_REFERENCE', `A ${mode} payment with reference ${reference} is already recorded`);
      }
      if (mode === 'CASH' && body.confirmDuplicate !== true) {
        const dup = s.payments.find((p) => p.customerId === customerId && p.mode === 'CASH' && p.amountPaise === amountPaise && p.receivedDate === receivedDate && p.status === 'SUCCESSFUL');
        if (dup) throw conflict('DUPLICATE_WARNING', 'A cash payment of the same amount for this customer today already exists', [{ id: dup.id, receiptId: dup.receiptId }]);
      }
      // The actor must be able to access every branch the allocation touches.
      for (const a of plan(customerId!, amountPaise!, instalmentIds)) assertBranch(u, a.branchId);
      const payment = confirmPayment(u, { customerId: customerId!, mode: mode!, amountPaise: amountPaise!, reference, receivedDate, instalmentIds, simulated: false, clientRequestId });
      return { payment: presentPayment(payment), duplicate: false };
    },

    // ---- Online (SIMULATED gateway: no provider is connected and no real money moves) ----
    initiateOnline(u: User, body: Body) {
      const c = new Check(body);
      // A member session can only ever pay its own dues; staff are limited by branch.
      const { customerId, amountPaise, instalmentIds } = validateModeFields(c, body);
      c.done();
      const customer = s.customers.find((x) => x.id === customerId);
      if (!customer) throw notFound('Customer');
      if (u.customerId) {
        if (customerId !== u.customerId) throw forbidden('You can only pay your own dues', 'FORBIDDEN_NOT_OWNER');
      } else assertBranch(u, customer.branchId);
      const allocs = plan(customerId!, amountPaise!, instalmentIds);
      const id = s.nextId('ATT');
      const attempt: PaymentAttempt = {
        id, customerId: customerId!, branchId: allocs[0]!.branchId, instalmentIds: allocs.map((a) => a.instalmentId), amountPaise: amountPaise!,
        status: 'PENDING_CONFIRMATION', simulated: true, providerRef: `SIM-${id}`, initiatedBy: u.id, createdAt: s.now().toISOString(), callbacks: [],
      };
      s.attempts.push(attempt);
      audit(s, u, 'payment.attempt', 'attempt', id, { amountPaise });
      return attempt;
    },

    listAttempts(u: User, q: Query) {
      const rows = inScope(u, s.attempts).filter((a) => !q.status || a.status === q.status)
        .map((a) => ({ ...a, customerName: s.customers.find((c) => c.id === a.customerId)?.name }))
        .filter((a) => matches(q.q, a.id, a.customerName, a.customerId, a.providerRef))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(rows, q);
    },

    cancelAttempt(u: User, id: string) {
      const a = s.attempts.find((x) => x.id === id);
      if (!a) throw notFound('Payment attempt');
      assertBranch(u, a.branchId);
      if (a.status !== 'PENDING_CONFIRMATION' && a.status !== 'INITIATED') throw conflict('INVALID_STATE', 'Only pending attempts can be cancelled');
      a.status = 'CANCELLED';
      audit(s, u, 'payment.attempt.cancel', 'attempt', id);
      return a;
    },

    /** Stands in for the provider's server-to-server callback. Success is only ever set here, never by the browser. */
    simulateCallback(u: User, id: string, body: Body) {
      const a = s.attempts.find((x) => x.id === id);
      if (!a) throw notFound('Payment attempt');
      const c = new Check(body);
      const eventId = c.str('eventId', { required: true, min: 4, max: 100 });
      const outcome = c.oneOf('outcome', ['SUCCESS', 'FAILURE'] as const);
      // Effective receipt date as reported by the provider; a late confirmation may carry an earlier date than today.
      const effectiveDate = c.date('effectiveDate');
      if (effectiveDate && effectiveDate > s.today()) c.errors.effectiveDate = 'Effective date cannot be in the future';
      c.done();
      if (a.callbacks.some((cb) => cb.eventId === eventId)) {
        return { attempt: a, payment: a.paymentId ? presentPayment(getPayment(a.paymentId)) : null, duplicate: true }; // replay: no side effects
      }
      if (a.status !== 'PENDING_CONFIRMATION') {
        a.callbacks.push({ eventId: eventId!, outcome: outcome!, at: s.now().toISOString(), applied: false });
        throw conflict('ATTEMPT_FINALIZED', `Attempt is already ${a.status}; callback recorded but not applied`);
      }
      if (outcome === 'FAILURE') {
        a.callbacks.push({ eventId: eventId!, outcome: 'FAILURE', at: s.now().toISOString(), applied: true });
        a.status = 'FAILED';
        audit(s, u, 'payment.attempt.failed', 'attempt', id);
        return { attempt: a, payment: null, duplicate: false };
      }
      const payment = confirmPayment(u, {
        customerId: a.customerId, mode: 'ONLINE_SIMULATED', amountPaise: a.amountPaise, reference: a.providerRef, receivedDate: effectiveDate ?? s.today(),
        instalmentIds: a.instalmentIds, simulated: true, attemptId: a.id,
      });
      a.callbacks.push({ eventId: eventId!, outcome: 'SUCCESS', at: s.now().toISOString(), applied: true });
      a.status = 'SUCCESSFUL';
      a.paymentId = payment.id;
      return { attempt: a, payment: presentPayment(payment), duplicate: false };
    },

    // ---- Payments and receipts ----
    listPayments(u: User, q: Query) {
      const rows = inScope(u, s.payments)
        .filter((p) => (!q.status || p.status === q.status) && (!q.mode || p.mode === q.mode) && (!q.customerId || p.customerId === q.customerId))
        .filter((p) => !q.reconciliationStatus || p.reconciliationStatus === q.reconciliationStatus)
        .filter((p) => (!q.from || p.receivedDate >= String(q.from)) && (!q.to || p.receivedDate <= String(q.to)))
        .map(presentPayment)
        .filter((p) => matches(q.q, p.id, p.customerName, p.customerId, p.reference, p.receiptId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(rows, q);
    },

    getPayment(u: User, id: string) {
      const p = getPayment(id);
      assertBranch(u, p.branchId);
      const journal = s.journals.find((j) => j.id === p.journalId);
      return {
        payment: presentPayment(p),
        receipt: s.receipts.find((r) => r.id === p.receiptId),
        allocations: s.allocations.filter((a) => a.paymentId === id).map((a: Allocation) => {
          const i = instalments.byId(a.instalmentId)!;
          return { ...a, groupCode: i.groupCode, ticketNo: i.ticketNo, seq: i.seq, dueDate: i.dueDate };
        }),
        attempt: p.attemptId ? s.attempts.find((a) => a.id === p.attemptId) : null,
        journal: journal ? { id: journal.id, number: journal.number, status: journal.status, simulated: journal.simulated, reversedBy: journal.reversedBy } : null,
        reconciliation: s.reconResults.filter((r) => r.paymentId === id),
        reversalRequests: s.approvals.filter((r) => r.entityType === 'PAYMENT_REVERSAL' && r.entityId === id),
        notice: p.simulated ? 'SIMULATED payment: no real money moved. Shown for workflow testing only.' : undefined,
      };
    },

    requestReversal(u: User, id: string, body: Body) {
      const p = getPayment(id);
      assertBranch(u, p.branchId);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, min: 5, max: 300 });
      c.done();
      if (p.status !== 'SUCCESSFUL') throw conflict('INVALID_STATE', 'Only successful payments can be reversed');
      if (openReversal(id)) throw conflict('DUPLICATE_REQUEST', 'A reversal request is already open');
      if (p.reconciliationStatus === 'MATCHED' || p.reconciliationStatus === 'EXCEPTION') throw conflict('RECONCILED', 'Reconciled payments cannot be reversed; raise an adjustment instead');
      p.reversalReason = reason;
      return approvals.submit(u, { entityType: 'PAYMENT_REVERSAL', entityId: id, entityLabel: `Reverse ${p.id} (${p.receiptId}): ${reason}`, branchId: p.branchId, revision: 1 });
    },

    listReceipts(u: User, q: Query) {
      const rows = inScope(u, s.receipts)
        .filter((r) => (!q.status || r.status === q.status) && (!q.customerId || r.customerId === q.customerId))
        .map((r) => ({ ...r, customerName: s.customers.find((c) => c.id === r.customerId)?.name, simulated: s.payments.find((p) => p.id === r.paymentId)?.simulated }))
        .filter((r) => matches(q.q, r.id, r.customerName, r.customerId, r.paymentId))
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
      return paginate(rows, q);
    },

    // ---- Reconciliation ----
    importBankLines(u: User, body: Body) {
      if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 500) throw badRequest('Validation failed', { lines: 'Provide 1-500 statement lines' });
      const errors: Record<string, string> = {};
      const added: string[] = [];
      const skipped: string[] = [];
      (body.lines as Body[]).forEach((raw, i) => {
        const c = new Check(raw);
        const date = c.date('date', true);
        const amountPaise = c.int('amountPaise', { required: true, min: 1 });
        const reference = c.str('reference', { required: true, max: 100 });
        const description = c.str('description', { max: 200 });
        const direction = c.oneOf('direction', ['CREDIT', 'DEBIT'] as const, false) ?? 'CREDIT';
        for (const [k, v] of Object.entries(c.errors)) errors[`lines[${i}].${k}`] = v;
        if (Object.keys(c.errors).length) return;
        if (s.bankLines.some((l) => l.reference.toLowerCase() === reference!.toLowerCase() && l.amountPaise === amountPaise && l.date === date && (l.direction ?? 'CREDIT') === direction)) {
          skipped.push(reference!);
          return;
        }
        const line = { id: s.nextId('BNK'), date: date!, amountPaise: amountPaise!, reference: reference!, description, direction, status: 'UNMATCHED' as const, createdBy: u.id };
        s.bankLines.push(line);
        added.push(line.id);
      });
      if (Object.keys(errors).length) throw badRequest('Validation failed', errors);
      audit(s, u, 'bank.import', 'bank', 'statement', { added: added.length, skipped: skipped.length });
      return { added: added.length, skipped };
    },

    listBankLines(_u: User, q: Query) {
      const rows = s.bankLines.filter((l) => (!q.status || l.status === q.status) && (!q.direction || (l.direction ?? 'CREDIT') === q.direction)).sort((a, b) => b.date.localeCompare(a.date));
      return paginate(rows, q);
    },

    reconciliationQueue(u: User, q: Query) {
      const rows = inScope(u, s.payments)
        .filter((p) => p.status === 'SUCCESSFUL' && (p.reconciliationStatus === 'PENDING' || p.reconciliationStatus === 'EXCEPTION'))
        .filter((p) => !q.reconciliationStatus || p.reconciliationStatus === q.reconciliationStatus)
        .map((p) => {
          const suggestion = p.reference ? s.bankLines.find((l) => l.status === 'UNMATCHED' && (l.direction ?? 'CREDIT') === 'CREDIT' && l.reference.toLowerCase() === p.reference!.toLowerCase()) : undefined;
          return {
            ...presentPayment(p),
            suggestion: suggestion ? { bankLineId: suggestion.id, amountPaise: suggestion.amountPaise, differencePaise: suggestion.amountPaise - p.amountPaise } : null,
            results: s.reconResults.filter((r) => r.paymentId === p.id),
          };
        })
        .filter((p) => matches(q.q, p.id, p.customerName, p.reference))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return paginate(rows, q);
    },

    match(u: User, body: Body) {
      const c = new Check(body);
      const paymentId = c.str('paymentId', { required: true });
      const bankLineId = c.str('bankLineId', { required: true });
      const comment = c.str('comment', { max: 300 });
      c.done();
      const p = getPayment(paymentId!);
      if (!canAccessBranch(u, p.branchId)) throw forbidden('This payment belongs to a branch you cannot access', 'FORBIDDEN_BRANCH');
      const line = s.bankLines.find((l) => l.id === bankLineId);
      if (!line) throw notFound('Bank statement line');
      if (p.status !== 'SUCCESSFUL') throw conflict('INVALID_STATE', 'Only successful payments can be reconciled');
      if (p.reconciliationStatus !== 'PENDING') throw conflict('INVALID_STATE', `Payment reconciliation status is ${p.reconciliationStatus}`);
      if ((line.direction ?? 'CREDIT') !== 'CREDIT') throw conflict('WRONG_DIRECTION', 'Collections are matched to credit statement lines');
      if (line.status !== 'UNMATCHED') throw conflict('LINE_ALREADY_MATCHED', 'This statement line is already matched');
      const diff = line.amountPaise - p.amountPaise;
      if (diff !== 0 && !comment) throw badRequest('Validation failed', { comment: 'A comment is required when the amounts differ' });
      line.status = 'MATCHED';
      line.paymentId = p.id;
      p.reconciliationStatus = diff === 0 ? 'MATCHED' : 'EXCEPTION';
      const result = { id: s.nextId('REC'), paymentId: p.id, bankLineId: line.id, result: diff === 0 ? ('MATCHED' as const) : ('EXCEPTION' as const), differencePaise: diff, comment, by: u.id, at: s.now().toISOString() };
      s.reconResults.push(result);
      audit(s, u, 'reconcile.match', 'payment', p.id, { bankLineId, differencePaise: diff });
      return result;
    },

    listResults: (_u: User) => ({ items: [...s.reconResults].reverse().map((r) => ({ ...r, byName: userName(s, r.by) })) }),
  };
};

export type CollectionService = ReturnType<typeof createCollectionService>;
