import { SUPPORT_CATEGORIES, supportTransitions } from '../domain/rules.js';
import type { SupportCase, User } from '../domain/types.js';
import { conflict, forbidden, notFound } from '../errors/AppError.js';
import { assertBranch } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import { audit, changeStatus, inScope, matches, paginate, userName } from './common.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

export const createSupportService = (s: Store) => {
  const find = (id: string) => {
    const c = s.supportCases.find((x) => x.id === id);
    if (!c) throw notFound('Support case');
    return c;
  };
  const mine = (u: User, id: string) => {
    const c = s.supportCases.find((x) => x.id === id && x.customerId === u.customerId);
    if (!c) throw notFound('Support case'); // same answer for "not yours" and "does not exist"
    return c;
  };
  const summary = (c: SupportCase, staff: boolean) => ({
    id: c.id, category: c.category, subject: c.subject, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
    ...(staff ? { customerId: c.customerId, customerName: s.customers.find((x) => x.id === c.customerId)?.name, branchId: c.branchId, assignedTo: c.assignedTo, assignedToName: userName(s, c.assignedTo) } : {}),
    messageCount: c.messages.filter((m) => staff || !m.internal).length,
  });
  const detail = (c: SupportCase, staff: boolean) => ({
    ...summary(c, staff),
    messages: c.messages.filter((m) => staff || !m.internal).map((m) => ({
      id: m.id, at: m.at, authorType: m.authorType, body: m.body,
      ...(staff ? { internal: m.internal, authorName: userName(s, m.authorId) } : { authorName: m.authorType === 'STAFF' ? 'Support team' : 'You' }),
    })),
    history: c.history.map((h) => ({ at: h.at, from: h.from, to: h.to, ...(staff ? { actorName: userName(s, h.actorId), comment: h.comment } : {}) })),
  });
  const addMessage = (u: User, c: SupportCase, body: string, authorType: 'MEMBER' | 'STAFF', internal = false) => {
    c.messages.push({ id: s.nextId('MSG'), at: s.now().toISOString(), authorId: u.id, authorType, internal, body });
    c.updatedAt = s.now().toISOString();
  };

  return {
    meta: () => ({ categories: SUPPORT_CATEGORIES }),

    // ---- Member ----
    listMine(u: User, q: Query) {
      const rows = s.supportCases.filter((c) => c.customerId === u.customerId && (!q.status || c.status === q.status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((c) => summary(c, false));
      return paginate(rows, q);
    },
    getMine: (u: User, id: string) => detail(mine(u, id), false),

    create(u: User, body: Body) {
      const customer = s.customers.find((x) => x.id === u.customerId);
      if (!customer) throw notFound('Customer');
      const c = new Check(body);
      const category = c.oneOf('category', SUPPORT_CATEGORIES);
      const subject = c.str('subject', { required: true, min: 5, max: 120 });
      const description = c.str('description', { required: true, min: 10, max: 2000 });
      const clientRequestId = c.str('clientRequestId', { required: true, min: 8, max: 100 });
      c.done();
      const dup = s.supportCases.find((x) => x.clientRequestId === clientRequestId && x.customerId === u.customerId);
      if (dup) return { case: detail(dup, false), duplicate: true };
      const now = s.now().toISOString();
      const sc: SupportCase = {
        id: s.nextId('SUP'), customerId: customer.id, branchId: customer.branchId, category: category!, subject: subject!, status: 'OPEN',
        messages: [], history: [], clientRequestId, createdBy: u.id, createdAt: now, updatedAt: now,
      };
      addMessage(u, sc, description!, 'MEMBER');
      s.supportCases.push(sc);
      audit(s, u, 'support.create', 'support', sc.id, { category });
      return { case: detail(sc, false), duplicate: false };
    },

    memberReply(u: User, id: string, body: Body) {
      const sc = mine(u, id);
      const c = new Check(body);
      const text = c.str('body', { required: true, min: 1, max: 2000 });
      c.done();
      if (sc.status === 'CLOSED') throw conflict('CASE_CLOSED', 'This request is closed. Please raise a new request.');
      if (sc.status === 'RESOLVED') changeStatus(s, u, sc, 'OPEN', supportTransitions, 'Reopened by member reply');
      addMessage(u, sc, text!, 'MEMBER');
      return detail(sc, false);
    },

    // ---- Staff ----
    list(u: User, q: Query) {
      const rows = inScope(u, s.supportCases)
        .filter((c) => (!q.status || c.status === q.status) && (!q.category || c.category === q.category) && (!q.assignedTo || c.assignedTo === (q.assignedTo === 'me' ? u.id : q.assignedTo)))
        .filter((c) => matches(q.q, c.id, c.subject, s.customers.find((x) => x.id === c.customerId)?.name, c.customerId))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .map((c) => summary(c, true));
      return paginate(rows, q);
    },
    get(u: User, id: string) {
      const c = find(id);
      assertBranch(u, c.branchId);
      return detail(c, true);
    },
    staffReply(u: User, id: string, body: Body) {
      const sc = find(id);
      assertBranch(u, sc.branchId);
      const c = new Check(body);
      const text = c.str('body', { required: true, min: 1, max: 2000 });
      c.done();
      if (sc.status === 'CLOSED') throw conflict('CASE_CLOSED', 'The case is closed');
      const internal = body.internal === true;
      addMessage(u, sc, text!, 'STAFF', internal);
      audit(s, u, internal ? 'support.note' : 'support.reply', 'support', id);
      return detail(sc, true);
    },
    assignToMe(u: User, id: string) {
      const sc = find(id);
      assertBranch(u, sc.branchId);
      if (sc.status === 'CLOSED') throw conflict('CASE_CLOSED', 'The case is closed');
      sc.assignedTo = u.id;
      if (sc.status === 'OPEN') changeStatus(s, u, sc, 'IN_PROGRESS', supportTransitions, 'Assigned');
      sc.updatedAt = s.now().toISOString();
      audit(s, u, 'support.assign', 'support', id);
      return detail(sc, true);
    },
    setStatus(u: User, id: string, body: Body) {
      const sc = find(id);
      assertBranch(u, sc.branchId);
      const c = new Check(body);
      const to = c.oneOf('status', ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const);
      const comment = c.str('comment', { required: true, min: 5, max: 500 });
      c.done();
      if (to === 'RESOLVED' && !sc.messages.some((m) => m.authorType === 'STAFF' && !m.internal)) {
        throw conflict('REPLY_REQUIRED', 'Reply to the member before marking the case resolved');
      }
      if (sc.assignedTo && sc.assignedTo !== u.id && !mayActOnColleagueCase(u)) throw forbidden('This case is assigned to another colleague', 'ASSIGNED_ELSEWHERE');
      changeStatus(s, u, sc, to!, supportTransitions, comment);
      sc.updatedAt = s.now().toISOString();
      audit(s, u, 'support.status', 'support', id, { to, comment });
      return detail(sc, true);
    },
  };
};

// Branch managers may act on a colleague's case; other staff must reassign it first.
const mayActOnColleagueCase = (u: User) => u.roles.includes('BRANCH_MANAGER') || u.roles.includes('OPS_HEAD');

export type SupportService = ReturnType<typeof createSupportService>;
