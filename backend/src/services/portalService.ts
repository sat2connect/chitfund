import type { Payment, User } from '../domain/types.js';
import { conflict, forbidden, notFound } from '../errors/AppError.js';
import type { Store } from '../repositories/store.js';
import { audit, matches, paginate } from './common.js';
import type { CollectionService } from './collectionService.js';
import type { InstalmentService } from './instalmentService.js';

type Query = Record<string, unknown>;
type Body = Record<string, unknown>;

/**
 * Member-facing read models. Every function derives the customer from the signed-in session and never
 * accepts a customer id from the client, so one member can never reach another member's records.
 * Internal fields (staff identities, journals, reconciliation, approval comments) are deliberately left out.
 */
export const createPortalService = (s: Store, instalments: InstalmentService, collections: CollectionService) => {
  const me = (u: User) => {
    if (!u.customerId) throw forbidden('This area is for members only', 'MEMBER_ONLY');
    const c = s.customers.find((x) => x.id === u.customerId);
    if (!c) throw notFound('Customer');
    return c;
  };
  const myTickets = (customerId: string) =>
    s.groups.flatMap((g) => g.tickets.filter((t) => t.customerId === customerId).map((t) => ({ g, t })));
  const myInstalments = (customerId: string) => s.instalments.filter((i) => i.customerId === customerId).map(instalments.present);

  const presentPayment = (p: Payment) => ({
    id: p.id, receiptId: p.receiptId, mode: p.mode, amountPaise: p.amountPaise, receivedDate: p.receivedDate, status: p.status,
    reference: p.reference, simulated: p.simulated, reversedAt: p.reversedAt,
    receiptStatus: s.receipts.find((r) => r.id === p.receiptId)?.status,
  });

  return {
    profile(u: User) {
      const c = me(u);
      const kyc = s.kycCases.find((k) => k.customerId === c.id);
      return {
        id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, branch: s.branches.find((b) => b.id === c.branchId)?.name,
        kycStatus: c.kycStatus, membershipStatus: c.membershipStatus,
        kyc: {
          status: c.kycStatus,
          documentsOnFile: kyc ? kyc.documents.filter((d) => d.active).length : 0,
          notice: 'To change contact details or provide documents, raise a support request. Document upload is not available online yet.',
        },
      };
    },

    summary(u: User) {
      const c = me(u);
      const all = myInstalments(c.id);
      const memberships = myTickets(c.id).map(({ g, t }) => {
        const cfg = s.schemeVersions.find((v) => v.id === g.schemeVersionId)!.config;
        const mine = all.filter((i) => i.groupId === g.id && i.ticketNo === t.no);
        const upcoming = mine.filter((i) => i.outstandingPaise > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
        const dueNow = mine.filter((i) => i.status !== 'SCHEDULED');
        return {
          groupId: g.id, groupCode: g.code, groupName: g.name, groupStatus: g.status, ticketNo: t.no, schemeName: cfg.name,
          chitValuePaise: cfg.chitValuePaise, installmentAmountPaise: cfg.installmentAmountPaise, tenureMonths: cfg.tenureMonths, plannedStartDate: g.plannedStartDate,
          outstandingDuePaise: dueNow.reduce((a, i) => a + i.outstandingPaise, 0),
          overduePaise: mine.filter((i) => i.status === 'OVERDUE').reduce((a, i) => a + i.outstandingPaise, 0),
          paidPaise: mine.reduce((a, i) => a + i.paidPaise, 0),
          nextDue: upcoming ? { instalmentId: upcoming.id, dueDate: upcoming.dueDate, outstandingPaise: upcoming.outstandingPaise, status: upcoming.status } : null,
        };
      });
      const dueNow = all.filter((i) => i.status !== 'SCHEDULED');
      return {
        today: s.today(),
        customer: { id: c.id, name: c.name, kycStatus: c.kycStatus, membershipStatus: c.membershipStatus },
        totals: {
          outstandingDuePaise: dueNow.reduce((a, i) => a + i.outstandingPaise, 0),
          overduePaise: all.filter((i) => i.status === 'OVERDUE').reduce((a, i) => a + i.outstandingPaise, 0),
          paidPaise: all.reduce((a, i) => a + i.paidPaise, 0),
        },
        memberships,
        openSupportCases: s.supportCases.filter((x) => x.customerId === c.id && x.status !== 'CLOSED').length,
        pendingPaymentAttempts: s.attempts.filter((a) => a.customerId === c.id && a.status === 'PENDING_CONFIRMATION').length,
      };
    },

    instalments(u: User, q: Query) {
      const c = me(u);
      const rows = myInstalments(c.id)
        .filter((i) => (!q.groupId || i.groupId === q.groupId) && (!q.status || i.status === q.status))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.ticketNo - b.ticketNo)
        .map((i) => ({
          id: i.id, groupId: i.groupId, groupCode: i.groupCode, ticketNo: i.ticketNo, seq: i.seq, dueDate: i.dueDate,
          amountPaise: i.amountPaise, paidPaise: i.paidPaise, outstandingPaise: i.outstandingPaise, status: i.status,
        }));
      return paginate(rows, { page: q.page, pageSize: q.pageSize ?? 50 });
    },

    payments(u: User, q: Query) {
      const c = me(u);
      const rows = s.payments.filter((p) => p.customerId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(presentPayment).filter((p) => matches(q.q, p.id, p.receiptId, p.reference));
      return paginate(rows, q);
    },

    payment(u: User, id: string) {
      const c = me(u);
      const p = s.payments.find((x) => x.id === id && x.customerId === c.id);
      if (!p) throw notFound('Payment'); // identical response for "not yours" and "does not exist"
      return {
        payment: presentPayment(p),
        allocations: s.allocations.filter((a) => a.paymentId === p.id).map((a) => {
          const i = instalments.byId(a.instalmentId)!;
          return { id: a.id, groupCode: i.groupCode, ticketNo: i.ticketNo, seq: i.seq, dueDate: i.dueDate, amountPaise: a.amountPaise, status: a.status };
        }),
        notice: p.simulated ? 'SIMULATED payment: no real money moved. Shown for testing only.' : undefined,
      };
    },

    /** Operational statement of dues and payments. Not an accounting document; formats are pending approval. */
    statement(u: User, q: Query) {
      const c = me(u);
      const today = s.today();
      const inst = myInstalments(c.id).filter((i) => (!q.groupId || i.groupId === q.groupId) && i.dueDate <= today);
      const ids = new Set(inst.map((i) => i.id));
      type Line = { date: string; type: 'INSTALMENT' | 'PAYMENT' | 'PAYMENT_REVERSED'; description: string; debitPaise: number; creditPaise: number; ref?: string };
      const lines: Line[] = inst.map((i) => ({ date: i.dueDate, type: 'INSTALMENT', description: `${i.groupCode} ticket ${i.ticketNo} instalment ${i.seq}`, debitPaise: i.amountPaise, creditPaise: 0, ref: i.id }));
      for (const p of s.payments.filter((x) => x.customerId === c.id)) {
        const applied = s.allocations.filter((a) => a.paymentId === p.id && ids.has(a.instalmentId)).reduce((x, a) => x + a.amountPaise, 0);
        if (applied === 0) continue;
        lines.push({ date: p.receivedDate, type: 'PAYMENT', description: `Payment received (${p.mode.replace(/_/g, ' ').toLowerCase()}), receipt ${p.receiptId}${p.simulated ? ' [simulated]' : ''}`, debitPaise: 0, creditPaise: applied, ref: p.id });
        if (p.status === 'REVERSED') {
          lines.push({ date: (p.reversedAt ?? p.receivedDate).slice(0, 10), type: 'PAYMENT_REVERSED', description: `Payment reversed, receipt ${p.receiptId} void`, debitPaise: applied, creditPaise: 0, ref: p.id });
        }
      }
      const order = { INSTALMENT: 0, PAYMENT: 1, PAYMENT_REVERSED: 2 } as const;
      lines.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type]);
      const from = q.from ? String(q.from) : undefined;
      const to = q.to ? String(q.to) : undefined;
      let balance = 0;
      let opening = 0;
      const out = lines.map((l) => {
        balance += l.debitPaise - l.creditPaise;
        if (from && l.date < from) opening = balance;
        return { ...l, balancePaise: balance };
      }).filter((l) => (!from || l.date >= from) && (!to || l.date <= to));
      return {
        generatedAt: s.now().toISOString(),
        asOf: today,
        notice: 'Operational statement of instalments due and payments received. It is not an accounting or statutory document.',
        openingPaise: opening,
        lines: out,
        totalDebitPaise: out.reduce((a, l) => a + l.debitPaise, 0),
        totalCreditPaise: out.reduce((a, l) => a + l.creditPaise, 0),
        closingPaise: out.length ? out[out.length - 1]!.balancePaise : opening,
      };
    },

    // ---- Online payment attempts (simulated gateway) ----
    attempts(u: User) {
      const c = me(u);
      return {
        items: s.attempts.filter((a) => a.customerId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => ({
          id: a.id, amountPaise: a.amountPaise, status: a.status, createdAt: a.createdAt, simulated: true, paymentId: a.paymentId,
        })),
        notice: 'Online payment is SIMULATED: no payment provider is connected and no real money moves.',
      };
    },
    initiate(u: User, body: Body) {
      const c = me(u);
      const a = collections.initiateOnline(u, { ...body, customerId: c.id });
      return { id: a.id, amountPaise: a.amountPaise, status: a.status, simulated: true, providerRef: a.providerRef };
    },
    cancelAttempt(u: User, id: string) {
      const c = me(u);
      const a = s.attempts.find((x) => x.id === id && x.customerId === c.id);
      if (!a) throw notFound('Payment attempt');
      if (a.status !== 'PENDING_CONFIRMATION' && a.status !== 'INITIATED') throw conflict('INVALID_STATE', 'Only pending attempts can be cancelled');
      a.status = 'CANCELLED';
      audit(s, u, 'payment.attempt.cancel', 'attempt', id);
      return { id: a.id, status: a.status };
    },

    // ---- Prize payout tracking ----
    payouts(u: User) {
      const c = me(u);
      const stage = (st: string) => ({
        DRAFT: 'Being prepared', ELIGIBILITY_REVIEW: 'Documents under review', PENDING_APPROVAL: 'Awaiting approval', APPROVED: 'Approved',
        DISBURSEMENT_PENDING: 'Payment being arranged', PAID: 'Paid', ON_HOLD: 'On hold - please contact support', FAILED: 'Payment being re-arranged',
      } as Record<string, string>)[st] ?? st;
      return {
        items: s.payouts.filter((p) => p.customerId === c.id).map((p) => {
          const approved = ['APPROVED', 'DISBURSEMENT_PENDING', 'PAID', 'FAILED'].includes(p.status) || (p.status === 'ON_HOLD' && p.holdPrevious && ['APPROVED', 'DISBURSEMENT_PENDING', 'FAILED'].includes(p.holdPrevious));
          return {
            id: p.id, groupCode: p.groupCode, ticketNo: p.ticketNo, auctionId: p.auctionId, stage: stage(p.status), status: p.status,
            amountPaise: approved ? p.amountPaise : undefined, // the amount is shown only once it has been approved
            channel: p.channel, paidDate: p.disbursement?.paidDate, reference: p.status === 'PAID' ? p.disbursement?.reference : undefined,
            documents: p.documents.map((d) => ({ title: d.title, confirmed: d.status === 'CONFIRMED' })),
          };
        }),
      };
    },
  };
};

export type PortalService = ReturnType<typeof createPortalService>;
