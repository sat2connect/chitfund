import { journalTransitions } from '../domain/rules.js';
import type { Account, AccountType, Journal, JournalLine, User } from '../domain/types.js';
import { conflict, forbidden, notFound } from '../errors/AppError.js';
import { hasPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import type { ApprovalService } from './approvalService.js';
import { audit, changeStatus, matches, paginate, userName } from './common.js';
import { badRequest } from '../errors/AppError.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;
const DEBIT_NORMAL: AccountType[] = ['ASSET', 'EXPENSE'];
const ACCOUNT_TYPES: readonly AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

export const createAccountingService = (s: Store, approvals: ApprovalService) => {
  const account = (id: string) => s.accounts.find((a) => a.id === id);
  const periodFor = (date: string) => s.periods.find((p) => date >= p.startDate && date <= p.endDate);
  const getJournal = (id: string) => {
    const j = s.journals.find((x) => x.id === id);
    if (!j) throw notFound('Journal');
    return j;
  };
  const openRequest = (type: 'JOURNAL' | 'JOURNAL_REVERSAL', id: string) =>
    s.approvals.find((r) => r.entityType === type && r.entityId === id && (r.status === 'PENDING' || r.status === 'IN_REVIEW'));

  /** Double-entry validation. Throws a field-level error list; returns normalised lines. */
  const validateLines = (raw: unknown): JournalLine[] => {
    const errors: Record<string, string> = {};
    if (!Array.isArray(raw) || raw.length < 2) throw badRequest('Validation failed', { lines: 'A journal needs at least two lines' });
    const lines: JournalLine[] = raw.map((l: Record<string, unknown>, i) => {
      const debit = l.debitPaise === undefined || l.debitPaise === '' ? 0 : l.debitPaise;
      const credit = l.creditPaise === undefined || l.creditPaise === '' ? 0 : l.creditPaise;
      const key = `lines[${i}]`;
      if (typeof l.accountId !== 'string' || !account(l.accountId)) errors[`${key}.accountId`] = 'Unknown account';
      else if (!account(l.accountId)!.active) errors[`${key}.accountId`] = 'Account is inactive';
      if (!Number.isInteger(debit) || !Number.isInteger(credit) || (debit as number) < 0 || (credit as number) < 0) {
        errors[key] = 'Amounts must be whole, non-negative paise';
      } else if (((debit as number) > 0) === ((credit as number) > 0)) {
        errors[key] = 'Enter either a debit or a credit amount on each line';
      }
      return { accountId: String(l.accountId), debitPaise: debit as number, creditPaise: credit as number, memo: typeof l.memo === 'string' ? l.memo.trim() || undefined : undefined };
    });
    if (Object.keys(errors).length) throw badRequest('Validation failed', errors);
    const d = lines.reduce((a, l) => a + l.debitPaise, 0);
    const c = lines.reduce((a, l) => a + l.creditPaise, 0);
    if (d !== c) throw badRequest('Journal does not balance', { lines: `Debits (${d}) and credits (${c}) must be equal` });
    return lines;
  };

  const assertOpenPeriod = (date: string) => {
    const p = periodFor(date);
    if (!p) throw conflict('NO_PERIOD', `No accounting period covers ${date}`);
    if (p.status !== 'OPEN') throw conflict('PERIOD_CLOSED', `Accounting period ${p.name} is closed`);
    return p;
  };

  const newJournal = (u: User, p: { date: string; memo: string; lines: JournalLine[]; source: Journal['source']; simulated: boolean }): Journal => {
    const period = assertOpenPeriod(p.date);
    return {
      id: s.nextId('JNL'), number: s.nextId('JV'), date: p.date, periodId: period.id, status: 'DRAFT', memo: p.memo, lines: p.lines,
      source: p.source, simulated: p.simulated, revision: 1, createdBy: u.id, createdAt: s.now().toISOString(), history: [],
    };
  };

  const post = (u: User, j: Journal, comment?: string) => {
    assertOpenPeriod(j.date);
    changeStatus(s, u, j, 'POSTED', journalTransitions, comment);
    j.postedAt = s.now().toISOString();
  };

  /** System-generated posting from an already-validated business event (e.g. a confirmed payment). */
  const postSystemJournal = (u: User, p: { date: string; memo: string; lines: JournalLine[]; source: Journal['source']; simulated: boolean }) => {
    const lines = validateLines(p.lines);
    const j = newJournal(u, { ...p, lines });
    j.history.push({ id: s.nextId('EV'), at: s.now().toISOString(), actorId: u.id, from: 'DRAFT', to: 'POSTED', comment: `System-generated from ${p.source.type}${p.source.id ? ` ${p.source.id}` : ''}` });
    j.status = 'POSTED';
    j.postedAt = s.now().toISOString();
    s.journals.push(j);
    return j;
  };

  /** Corrections never edit a posted journal: a new journal with swapped sides is posted and linked. */
  const reverseJournal = (u: User, original: Journal, reason: string, sourceType: 'PAYMENT_REVERSAL' | 'JOURNAL_REVERSAL', sourceId?: string) => {
    if (original.status !== 'POSTED') throw conflict('INVALID_STATE', 'Only posted journals can be reversed');
    const rev = postSystemJournal(u, {
      date: s.today(), memo: `Reversal of ${original.number}: ${reason}`, simulated: original.simulated,
      lines: original.lines.map((l) => ({ accountId: l.accountId, debitPaise: l.creditPaise, creditPaise: l.debitPaise, memo: l.memo })),
      source: { type: sourceType, id: sourceId ?? original.id },
    });
    rev.reversalOf = original.id;
    changeStatus(s, u, original, 'REVERSED', journalTransitions, reason);
    original.reversedBy = rev.id;
    audit(s, u, 'journal.reverse', 'journal', original.id, { reversal: rev.id, reason });
    return rev;
  };

  const present = (j: Journal, u: User) => ({
    ...j,
    createdByName: userName(s, j.createdBy),
    lines: j.lines.map((l) => ({ ...l, accountCode: account(l.accountId)?.code, accountName: account(l.accountId)?.name })),
    totalPaise: j.lines.reduce((a, l) => a + l.debitPaise, 0),
    history: j.history.map((h) => ({ ...h, actorName: userName(s, h.actorId) })),
    approvalRequests: s.approvals.filter((r) => ['JOURNAL', 'JOURNAL_REVERSAL'].includes(r.entityType) && r.entityId === j.id),
    actions: {
      canEdit: hasPermission(u, 'journal:create') && j.status === 'DRAFT',
      canSubmit: hasPermission(u, 'journal:submit') && j.status === 'DRAFT',
      canWithdraw: openRequest('JOURNAL', j.id)?.makerId === u.id,
      canRequestReversal: hasPermission(u, 'journal:submit') && j.status === 'POSTED' && j.source.type !== 'PAYMENT' && !openRequest('JOURNAL_REVERSAL', j.id) && !j.reversalOf,
    },
  });

  approvals.register('JOURNAL', {
    permission: 'journal:approve',
    requiresReview: false,
    currentRevision: (r) => getJournal(r.entityId).revision,
    onDecision(r, decision, u, comment) {
      const j = getJournal(r.entityId);
      if (decision === 'APPROVED') {
        assertOpenPeriod(j.date); // fail before changing anything
        validateLines(j.lines); // re-validate at the moment of posting
        changeStatus(s, u, j, 'APPROVED', journalTransitions, comment);
        post(u, j);
        audit(s, u, 'journal.post', 'journal', j.id);
      } else {
        changeStatus(s, u, j, 'DRAFT', journalTransitions, comment ?? 'Returned');
      }
    },
    onCancel: (r, u) => changeStatus(s, u, getJournal(r.entityId), 'DRAFT', journalTransitions, 'Submission withdrawn'),
  });

  approvals.register('JOURNAL_REVERSAL', {
    permission: 'journal:approve',
    requiresReview: false,
    currentRevision: (r) => getJournal(r.entityId).revision,
    onDecision(r, decision, u, comment) {
      if (decision === 'APPROVED') reverseJournal(u, getJournal(r.entityId), comment ?? 'Approved reversal', 'JOURNAL_REVERSAL');
    },
    onCancel: () => undefined,
  });

  const sign = (type: AccountType, debit: number, credit: number) => (DEBIT_NORMAL.includes(type) ? debit - credit : credit - debit);
  const postedLines = (q: { includeSimulated?: boolean; to?: string; from?: string }) =>
    s.journals
      .filter((j) => ['POSTED', 'REVERSED'].includes(j.status) && (q.includeSimulated || !j.simulated))
      .filter((j) => (!q.to || j.date <= q.to) && (!q.from || j.date >= q.from))
      .flatMap((j) => j.lines.map((l) => ({ ...l, journal: j })));
  const flag = (v: unknown) => v === 'true' || v === true;

  return {
    postSystemJournal,
    reverseJournal,
    postingRules: () => ({
      placeholder: true,
      notice: 'Placeholder mappings. They must be approved by the client accountant before real use.',
      debitByMode: Object.fromEntries(Object.entries(s.postingRules.debitByMode).map(([m, code]) => [m, s.accounts.find((a) => a.code === code)?.name ?? code])),
      credit: s.accounts.find((a) => a.code === s.postingRules.creditAccountCode)?.name,
    }),

    // ---- Chart of accounts ----
    listAccounts: () => ({ items: [...s.accounts].sort((a, b) => a.code.localeCompare(b.code)), placeholder: s.accounts.some((a) => a.placeholder) }),
    createAccount(u: User, body: Body) {
      const c = new Check(body);
      const code = c.str('code', { required: true, pattern: /^\d{3,8}$/, msg: 'Use 3-8 digits' });
      const name = c.str('name', { required: true, min: 3, max: 100 });
      const type = c.oneOf('type', ACCOUNT_TYPES);
      c.done();
      if (s.accounts.some((a) => a.code === code)) throw conflict('DUPLICATE_CODE', `Account code ${code} already exists`);
      const a: Account = { id: s.nextId('ACC'), code: code!, name: name!, type: type!, active: true, placeholder: false };
      s.accounts.push(a);
      audit(s, u, 'account.create', 'account', a.id, { code });
      return a;
    },
    setAccountActive(u: User, id: string, active: boolean) {
      const a = account(id);
      if (!a) throw notFound('Account');
      a.active = active;
      audit(s, u, active ? 'account.activate' : 'account.deactivate', 'account', id);
      return a;
    },

    // ---- Periods ----
    listPeriods: () => ({ items: s.periods }),
    closePeriod(u: User, id: string) {
      const p = s.periods.find((x) => x.id === id);
      if (!p) throw notFound('Period');
      if (p.status === 'CLOSED') throw conflict('INVALID_STATE', 'Period is already closed');
      const open = s.journals.filter((j) => j.periodId === id && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(j.status));
      if (open.length) throw conflict('OPEN_JOURNALS', `${open.length} unposted journal(s) must be posted or removed first`, open.map((j) => j.number));
      p.status = 'CLOSED';
      p.history.push({ at: s.now().toISOString(), actorId: u.id, action: 'CLOSED' });
      audit(s, u, 'period.close', 'period', id);
      return p;
    },
    reopenPeriod(u: User, id: string, body: Body) {
      const p = s.periods.find((x) => x.id === id);
      if (!p) throw notFound('Period');
      const c = new Check(body);
      const reason = c.str('reason', { required: true, max: 300 });
      c.done();
      if (p.status === 'OPEN') throw conflict('INVALID_STATE', 'Period is already open');
      p.status = 'OPEN';
      p.history.push({ at: s.now().toISOString(), actorId: u.id, action: 'REOPENED', reason });
      audit(s, u, 'period.reopen', 'period', id, { reason });
      return p;
    },

    // ---- Journals ----
    listJournals(u: User, q: Query) {
      const rows = s.journals
        .filter((j) => !q.status || j.status === q.status)
        .filter((j) => !q.sourceType || j.source.type === q.sourceType)
        .filter((j) => (!q.from || j.date >= String(q.from)) && (!q.to || j.date <= String(q.to)))
        .filter((j) => matches(q.q, j.number, j.memo, j.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((j) => ({
          id: j.id, number: j.number, date: j.date, status: j.status, memo: j.memo, source: j.source, simulated: j.simulated,
          totalPaise: j.lines.reduce((a, l) => a + l.debitPaise, 0),
        }));
      return paginate(rows, q);
    },
    getJournal: (u: User, id: string) => present(getJournal(id), u),

    createDraft(u: User, body: Body) {
      const c = new Check(body);
      const date = c.date('date', true);
      const memo = c.str('memo', { required: true, min: 3, max: 300 });
      c.done();
      const j = newJournal(u, { date: date!, memo: memo!, lines: validateLines(body.lines), source: { type: 'MANUAL' }, simulated: false });
      s.journals.push(j);
      audit(s, u, 'journal.draft', 'journal', j.id);
      return present(j, u);
    },
    updateDraft(u: User, id: string, body: Body) {
      const j = getJournal(id);
      if (j.status !== 'DRAFT') throw conflict('READ_ONLY', 'Only draft journals can be edited. Posted entries are corrected by reversal.');
      if (j.createdBy !== u.id) throw forbidden('Only the creator can edit a draft', 'MAKER_ONLY');
      const c = new Check(body);
      const date = c.date('date', true);
      const memo = c.str('memo', { required: true, min: 3, max: 300 });
      c.done();
      j.periodId = assertOpenPeriod(date!).id;
      j.date = date!;
      j.memo = memo!;
      j.lines = validateLines(body.lines);
      j.revision += 1;
      audit(s, u, 'journal.edit', 'journal', id, { revision: j.revision });
      return present(j, u);
    },
    submit(u: User, id: string) {
      const j = getJournal(id);
      if (j.source.type !== 'MANUAL') throw conflict('INVALID_STATE', 'Only manual journals are submitted for approval');
      validateLines(j.lines);
      assertOpenPeriod(j.date);
      changeStatus(s, u, j, 'SUBMITTED', journalTransitions);
      approvals.submit(u, { entityType: 'JOURNAL', entityId: j.id, entityLabel: `${j.number} - ${j.memo}`, revision: j.revision });
      return present(j, u);
    },
    withdraw(u: User, id: string) {
      const j = getJournal(id);
      const r = openRequest('JOURNAL', id);
      if (!r) throw conflict('INVALID_STATE', 'No open approval request');
      approvals.withdraw(u, r.id);
      return present(j, u);
    },
    requestReversal(u: User, id: string, body: Body) {
      const j = getJournal(id);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, max: 300 });
      c.done();
      if (j.status !== 'POSTED') throw conflict('INVALID_STATE', 'Only posted journals can be reversed');
      if (j.source.type === 'PAYMENT') throw conflict('USE_PAYMENT_REVERSAL', 'Payment journals are reversed through the payment reversal workflow');
      if (j.reversalOf) throw conflict('INVALID_STATE', 'A reversal journal cannot itself be reversed');
      if (openRequest('JOURNAL_REVERSAL', id)) throw conflict('DUPLICATE_REQUEST', 'A reversal request is already open');
      const r = approvals.submit(u, { entityType: 'JOURNAL_REVERSAL', entityId: id, entityLabel: `Reverse ${j.number}: ${reason}`, revision: j.revision });
      return { request: r };
    },

    // ---- Reports (derived from posted journals only) ----
    ledger(u: User, q: Query) {
      const a = account(String(q.accountId ?? ''));
      if (!a) throw notFound('Account');
      const inc = flag(q.includeSimulated);
      const before = q.from ? postedLines({ includeSimulated: inc, to: String(q.from) }).filter((l) => l.accountId === a.id && l.journal.date < String(q.from)) : [];
      let running = before.reduce((acc, l) => acc + sign(a.type, l.debitPaise, l.creditPaise), 0);
      const opening = running;
      const rows = postedLines({ includeSimulated: inc, from: q.from as string | undefined, to: q.to as string | undefined })
        .filter((l) => l.accountId === a.id)
        .sort((x, y) => x.journal.date.localeCompare(y.journal.date) || x.journal.number.localeCompare(y.journal.number))
        .map((l) => {
          running += sign(a.type, l.debitPaise, l.creditPaise);
          return {
            date: l.journal.date, journalId: l.journal.id, journalNumber: l.journal.number, memo: l.memo ?? l.journal.memo,
            debitPaise: l.debitPaise, creditPaise: l.creditPaise, balancePaise: running, simulated: l.journal.simulated, source: l.journal.source,
          };
        });
      return { account: a, openingPaise: opening, closingPaise: running, items: rows, includesSimulated: inc };
    },

    trialBalance(u: User, q: Query) {
      const inc = flag(q.includeSimulated);
      const lines = postedLines({ includeSimulated: inc, to: q.asOf as string | undefined });
      const rows = [...s.accounts].sort((a, b) => a.code.localeCompare(b.code)).map((a) => {
        const ls = lines.filter((l) => l.accountId === a.id);
        const debit = ls.reduce((x, l) => x + l.debitPaise, 0);
        const credit = ls.reduce((x, l) => x + l.creditPaise, 0);
        return { accountId: a.id, code: a.code, name: a.name, type: a.type, debitPaise: debit, creditPaise: credit, balancePaise: sign(a.type, debit, credit) };
      });
      const totalDebit = rows.reduce((x, r) => x + r.debitPaise, 0);
      const totalCredit = rows.reduce((x, r) => x + r.creditPaise, 0);
      return { asOf: q.asOf ?? s.today(), items: rows, totalDebitPaise: totalDebit, totalCreditPaise: totalCredit, balanced: totalDebit === totalCredit, includesSimulated: inc };
    },

    /** Provisional aggregation by account type. Statutory formats are NOT implemented and need accountant approval. */
    statements(u: User, q: Query) {
      const tb = this.trialBalance(u, { asOf: q.to, includeSimulated: q.includeSimulated });
      const incomeLines = postedLines({ includeSimulated: flag(q.includeSimulated), from: q.from as string | undefined, to: q.to as string | undefined });
      const byType = (t: AccountType, lines: typeof incomeLines) =>
        s.accounts.filter((a) => a.type === t).map((a) => {
          const ls = lines.filter((l) => l.accountId === a.id);
          return { code: a.code, name: a.name, amountPaise: sign(t, ls.reduce((x, l) => x + l.debitPaise, 0), ls.reduce((x, l) => x + l.creditPaise, 0)) };
        });
      const income = byType('INCOME', incomeLines);
      const expense = byType('EXPENSE', incomeLines);
      const totalIncome = income.reduce((x, r) => x + r.amountPaise, 0);
      const totalExpense = expense.reduce((x, r) => x + r.amountPaise, 0);
      const bal = (t: AccountType) => tb.items.filter((r) => r.type === t).map((r) => ({ code: r.code, name: r.name, amountPaise: r.balancePaise }));
      const assets = bal('ASSET'), liabilities = bal('LIABILITY'), equity = bal('EQUITY');
      const cumulativeEarnings = tb.items.filter((r) => r.type === 'INCOME').reduce((x, r) => x + r.balancePaise, 0)
        - tb.items.filter((r) => r.type === 'EXPENSE').reduce((x, r) => x + r.balancePaise, 0);
      const sum = (rows: { amountPaise: number }[]) => rows.reduce((x, r) => x + r.amountPaise, 0);
      return {
        provisional: true,
        notice: 'Provisional aggregation by account type for review only. Statutory formats and treatment are not implemented.',
        includesSimulated: flag(q.includeSimulated),
        profitAndLoss: { income, expense, totalIncomePaise: totalIncome, totalExpensePaise: totalExpense, netPaise: totalIncome - totalExpense },
        balanceSheet: {
          assets, liabilities, equity, cumulativeEarningsPaise: cumulativeEarnings,
          totalAssetsPaise: sum(assets), totalLiabilitiesAndEquityPaise: sum(liabilities) + sum(equity) + cumulativeEarnings,
          balanced: sum(assets) === sum(liabilities) + sum(equity) + cumulativeEarnings,
        },
      };
    },
  };
};

export type AccountingService = ReturnType<typeof createAccountingService>;
