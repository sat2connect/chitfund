import type { ChitGroup, Instalment, InstalmentStatus, OverdueRules, User } from '../domain/types.js';
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

/** Moves a date that falls on a listed non-working date forward to the next date that is not listed. */
export const shiftForNonWorkingDates = (date: string, rules?: OverdueRules) => {
  if (!rules || rules.holidayPolicy !== 'NEXT_UNLISTED_DAY' || !rules.nonWorkingDates.length) return date;
  const listed = new Set(rules.nonWorkingDates);
  let d = date;
  for (let guard = 0; listed.has(d) && guard < 800; guard += 1) d = addDays(d, 1);
  return d;
};

export const createInstalmentService = (s: Store) => {
  /** The overdue rules of the scheme version a group was created from (absent = placeholder defaults). */
  const rulesOf = (groupId: string): OverdueRules | undefined => {
    const g = s.groups.find((x) => x.id === groupId);
    return g ? s.schemeVersions.find((v) => v.id === g.schemeVersionId)?.config.overdueRules : undefined;
  };
  const graceOf = (rules?: OverdueRules) => rules?.graceDays ?? s.settings.graceDays;

  /**
   * Provisional state model: Scheduled -> Due -> Partially paid / Paid, and Overdue when a balance is still outstanding
   * after the (holiday-adjusted) due date plus the grace period. Derived on read so it can never go stale.
   * The rules come from the scheme and are UNAPPROVED until a confirmation reference is recorded; nothing here charges
   * a penalty or changes member eligibility.
   */
  const evaluate = (i: Instalment, paidPaise: number, today: string, rules = rulesOf(i.groupId)): InstalmentStatus => {
    if (paidPaise >= i.amountPaise) return 'PAID';
    const due = shiftForNonWorkingDates(i.dueDate, rules);
    const overdue = today > addDays(due, graceOf(rules));
    if (overdue && !(rules?.partialPaymentStopsOverdue && paidPaise > 0)) return 'OVERDUE';
    if (today >= due) return paidPaise > 0 ? 'PARTIALLY_PAID' : 'DUE';
    return 'SCHEDULED';
  };
  const statusOf = (i: Instalment, today = s.today()): InstalmentStatus => evaluate(i, i.paidPaise, today);

  /** Amount settled by successful payments whose effective receipt date is on or before `date`. */
  const paidAsOf = (i: Instalment, date: string) => {
    let sum = 0;
    for (const a of s.allocations) {
      if (a.instalmentId !== i.id || a.status !== 'ACTIVE') continue;
      const pay = s.payments.find((p) => p.id === a.paymentId);
      if (pay && pay.status === 'SUCCESSFUL' && pay.receivedDate <= date) sum += a.amountPaise;
    }
    return sum;
  };
  /** The status the instalment had (or would have had) on `date`, using only payments effective by then. */
  const statusAsOf = (i: Instalment, date: string): InstalmentStatus => evaluate(i, paidAsOf(i, date), date);

  /** Effective receipt date on which the balance was cleared, if it has been. */
  type SettlementIndex = Map<string, { date: string; amount: number }[]>;
  /** One pass over allocations, so listing many instalments stays linear. */
  const buildIndex = (): SettlementIndex => {
    const dates = new Map(s.payments.map((p) => [p.id, p.receivedDate]));
    const idx: SettlementIndex = new Map();
    for (const a of s.allocations) {
      if (a.status !== 'ACTIVE') continue;
      (idx.get(a.instalmentId) ?? idx.set(a.instalmentId, []).get(a.instalmentId)!).push({ date: dates.get(a.paymentId) ?? '', amount: a.amountPaise });
    }
    return idx;
  };
  const settledOn = (i: Instalment, idx?: SettlementIndex): string | undefined => {
    if (i.paidPaise < i.amountPaise) return undefined;
    const source = idx ? idx.get(i.id) ?? [] : buildIndex().get(i.id) ?? [];
    const rows = [...source].sort((a, b) => a.date.localeCompare(b.date));
    let sum = 0;
    for (const r of rows) {
      sum += r.amount;
      if (sum >= i.amountPaise) return r.date;
    }
    return undefined;
  };

  const presentWith = (i: Instalment, idx?: SettlementIndex) => {
    const rules = rulesOf(i.groupId);
    const due = shiftForNonWorkingDates(i.dueDate, rules);
    const lastDayInGrace = addDays(due, graceOf(rules));
    const settled = settledOn(i, idx);
    return {
      ...i,
      outstandingPaise: Math.max(i.amountPaise - i.paidPaise, 0),
      status: statusOf(i),
      customerName: s.customers.find((c) => c.id === i.customerId)?.name,
      effectiveDueDate: due,
      lastDayInGrace,
      settledOn: settled,
      paidLate: settled ? settled > lastDayInGrace : undefined,
      reminderDates: {
        before: (rules?.reminderDaysBefore ?? []).map((d) => addDays(due, -d)),
        after: (rules?.reminderDaysAfter ?? []).map((d) => addDays(due, d)),
      },
      policyStatus: rules?.policyConfirmationRef ? 'CONFIRMATION_RECORDED' : 'UNAPPROVED',
    };
  };

  return {
    statusOf,
    statusAsOf,
    paidAsOf,
    present: (i: Instalment) => presentWith(i),
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
          // The group's stored schedule wins; groups created before schedules existed fall back to the placeholder monthly rule.
          const dueDate = g.instalmentSchedule?.find((x) => x.seq === seq)?.dueDate ?? addMonths(g.plannedStartDate, seq - 1);
          s.instalments.push({
            id: s.nextId('INS'), groupId: g.id, groupCode: g.code, branchId: g.branchId, ticketNo: t.no, customerId: t.customerId,
            seq, dueDate, amountPaise: config.installmentAmountPaise, paidPaise: 0,
          });
        }
      }
    },

    list(u: User, q: Query) {
      const idx = buildIndex();
      const rows = inScope(u, s.instalments)
        .filter((i) => (!q.groupId || i.groupId === q.groupId) && (!q.customerId || i.customerId === q.customerId) && (!q.branchId || i.branchId === q.branchId))
        .filter((i) => (!q.dueFrom || i.dueDate >= String(q.dueFrom)) && (!q.dueTo || i.dueDate <= String(q.dueTo)))
        .map((i) => presentWith(i, idx))
        .filter((i) => !q.status || i.status === q.status)
        .filter((i) => !q.outstandingOnly || i.outstandingPaise > 0)
        .filter((i) => matches(q.q, i.customerName, i.customerId, i.groupCode, i.id))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.groupCode.localeCompare(b.groupCode) || a.ticketNo - b.ticketNo);
      return paginate(rows, q);
    },

    summary(u: User, q: Query) {
      const idx = buildIndex();
      const rows = inScope(u, s.instalments)
        .filter((i) => (!q.groupId || i.groupId === q.groupId) && (!q.branchId || i.branchId === q.branchId))
        .map((i) => presentWith(i, idx));
      const dueNow = rows.filter((i) => i.status !== 'SCHEDULED');
      const sum = (xs: { outstandingPaise: number }[]) => xs.reduce((a, i) => a + i.outstandingPaise, 0);
      return {
        today: s.today(),
        graceDays: s.settings.graceDays,
        graceNotice: 'Overdue and grace-period rules are UNAPPROVED. Schemes may override the placeholder grace days; no penalties are charged and member eligibility is never changed automatically.',
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
      const idx = buildIndex();
      const overdue = inScope(u, s.instalments).map((i) => presentWith(i, idx)).filter((i) => i.status === 'OVERDUE');
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
