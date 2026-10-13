import type { ChitGroup, Instalment, InstalmentStatus, User } from '../domain/types.js';
import { assertBranch } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { inScope, matches, paginate } from './common.js';

type Query = Record<string, unknown>;

/** Adds calendar months to a YYYY-MM-DD date, clamping to the month's last day. */
export const addMonths = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const createInstalmentService = (s: Store) => {
  /**
   * Status is derived on read from dates and paid amount, so it can never go stale.
   * PLACEHOLDER rule: overdue once today is past dueDate + graceDays with an outstanding balance.
   */
  const statusOf = (i: Instalment, today = s.today()): InstalmentStatus => {
    if (i.paidPaise >= i.amountPaise) return 'PAID';
    if (today > addDays(i.dueDate, s.settings.graceDays)) return 'OVERDUE';
    if (today >= i.dueDate) return i.paidPaise > 0 ? 'PARTIALLY_PAID' : 'DUE';
    return 'SCHEDULED';
  };
  const present = (i: Instalment) => ({
    ...i,
    outstandingPaise: Math.max(i.amountPaise - i.paidPaise, 0),
    status: statusOf(i),
    customerName: s.customers.find((c) => c.id === i.customerId)?.name,
  });

  return {
    statusOf,
    present,
    byId: (id: string) => s.instalments.find((i) => i.id === id),

    /**
     * Generates one instalment per tenure month for every allocated ticket.
     * PLACEHOLDER rules: first due date = planned start date, then the same day each month; amount = scheme instalment.
     * Dividend adjustments to dues are not applied (they need the approved calculation engine).
     */
    generateForGroup(g: ChitGroup, config: { tenureMonths: number; installmentAmountPaise: number }) {
      if (s.instalments.some((i) => i.groupId === g.id)) return; // idempotent
      for (const t of g.tickets) {
        if (!t.customerId) continue;
        for (let seq = 1; seq <= config.tenureMonths; seq += 1) {
          s.instalments.push({
            id: s.nextId('INS'), groupId: g.id, groupCode: g.code, branchId: g.branchId, ticketNo: t.no, customerId: t.customerId,
            seq, dueDate: addMonths(g.plannedStartDate, seq - 1), amountPaise: config.installmentAmountPaise, paidPaise: 0,
          });
        }
      }
    },

    list(u: User, q: Query) {
      const rows = inScope(u, s.instalments)
        .filter((i) => (!q.groupId || i.groupId === q.groupId) && (!q.customerId || i.customerId === q.customerId) && (!q.branchId || i.branchId === q.branchId))
        .filter((i) => (!q.dueFrom || i.dueDate >= String(q.dueFrom)) && (!q.dueTo || i.dueDate <= String(q.dueTo)))
        .map(present)
        .filter((i) => !q.status || i.status === q.status)
        .filter((i) => !q.outstandingOnly || i.outstandingPaise > 0)
        .filter((i) => matches(q.q, i.customerName, i.customerId, i.groupCode, i.id))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.groupCode.localeCompare(b.groupCode) || a.ticketNo - b.ticketNo);
      return paginate(rows, q);
    },

    summary(u: User, q: Query) {
      const rows = inScope(u, s.instalments)
        .filter((i) => (!q.groupId || i.groupId === q.groupId) && (!q.branchId || i.branchId === q.branchId))
        .map(present);
      const dueNow = rows.filter((i) => i.status !== 'SCHEDULED');
      const sum = (xs: { outstandingPaise: number }[]) => xs.reduce((a, i) => a + i.outstandingPaise, 0);
      return {
        today: s.today(),
        graceDays: s.settings.graceDays,
        graceNotice: 'Overdue grace days are a placeholder setting pending approved business rules.',
        dueToDatePaise: dueNow.reduce((a, i) => a + i.amountPaise, 0),
        collectedAgainstDuePaise: dueNow.reduce((a, i) => a + i.paidPaise, 0),
        outstandingDuePaise: sum(dueNow),
        overduePaise: sum(rows.filter((i) => i.status === 'OVERDUE')),
        overdueCount: rows.filter((i) => i.status === 'OVERDUE').length,
        scheduledPaise: rows.filter((i) => i.status === 'SCHEDULED').reduce((a, i) => a + i.amountPaise, 0),
      };
    },

    /** Overdue balances grouped by customer for follow-up. */
    arrears(u: User, q: Query) {
      const overdue = inScope(u, s.instalments).map(present).filter((i) => i.status === 'OVERDUE');
      const map = new Map<string, { customerId: string; customerName?: string; phone?: string; branchId: string; overduePaise: number; count: number; oldestDueDate: string }>();
      for (const i of overdue) {
        const cur = map.get(i.customerId) ?? {
          customerId: i.customerId, customerName: i.customerName, phone: s.customers.find((c) => c.id === i.customerId)?.phone,
          branchId: i.branchId, overduePaise: 0, count: 0, oldestDueDate: i.dueDate,
        };
        cur.overduePaise += i.outstandingPaise;
        cur.count += 1;
        if (i.dueDate < cur.oldestDueDate) cur.oldestDueDate = i.dueDate;
        map.set(i.customerId, cur);
      }
      const rows = [...map.values()]
        .filter((r) => matches(q.q, r.customerName, r.customerId, r.phone))
        .sort((a, b) => a.oldestDueDate.localeCompare(b.oldestDueDate));
      return paginate(rows, q);
    },

    assertAccess: (u: User, i: Instalment) => assertBranch(u, i.branchId),
  };
};

export type InstalmentService = ReturnType<typeof createInstalmentService>;
