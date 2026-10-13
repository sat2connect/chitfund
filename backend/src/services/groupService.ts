import { groupTransitions } from '../domain/rules.js';
import type { ChitGroup, User } from '../domain/types.js';
import { conflict, notFound } from '../errors/AppError.js';
import { assertBranch, hasPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import type { ApprovalService } from './approvalService.js';
import { audit, changeStatus, inScope, logActivity, matches, paginate, userName } from './common.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

export interface GroupHooks {
  /** Called after a group becomes Active (e.g. to generate instalment schedules). */
  onActivated?: (g: ChitGroup, config: { tenureMonths: number; installmentAmountPaise: number }) => void;
}

export const createGroupService = (s: Store, approvals: ApprovalService, hooks: GroupHooks = {}) => {
  const getGroup = (id: string) => {
    const g = s.groups.find((x) => x.id === id);
    if (!g) throw notFound('Group');
    return g;
  };
  const scoped = (u: User, id: string) => {
    const g = getGroup(id);
    assertBranch(u, g.branchId);
    return g;
  };
  const versionOf = (g: ChitGroup) => s.schemeVersions.find((v) => v.id === g.schemeVersionId)!;
  const label = (g: ChitGroup) => `${g.code} – ${g.name}`;
  const openRequest = (g: ChitGroup, type: 'GROUP_OPEN' | 'GROUP_ACTIVATION') =>
    s.approvals.find((r) => r.entityType === type && r.entityId === g.id && (r.status === 'PENDING' || r.status === 'IN_REVIEW'));

  /** Server-computed readiness. Automatic checks come from data; checklist items are manually attested. */
  const readiness = (g: ChitGroup) => {
    const cfg = versionOf(g).config;
    const filled = g.tickets.filter((t) => t.customerId);
    const customers = filled.map((t) => s.customers.find((c) => c.id === t.customerId)!);
    const ineligible = customers.filter((c) => c.kycStatus !== 'VERIFIED' || !['ENROLMENT_PENDING', 'ACTIVE'].includes(c.membershipStatus));
    const items = [
      { key: 'SCHEME_PUBLISHED', label: 'Scheme version is published', automatic: true, met: versionOf(g).status === 'PUBLISHED',
        detail: `Version status: ${versionOf(g).status}` },
      { key: 'GROUP_APPROVED', label: 'Group approved for enrolment', automatic: true,
        met: ['ENROLMENT_OPEN', 'READY_TO_START', 'ACTIVE', 'SUSPENDED'].includes(g.status), detail: `Group status: ${g.status}` },
      { key: 'MIN_ENROLMENT', label: `At least ${cfg.minEnrolmentToActivate} of ${cfg.memberCount} tickets allocated`, automatic: true,
        met: filled.length >= cfg.minEnrolmentToActivate, detail: `${filled.length} allocated` },
      { key: 'MEMBERS_ELIGIBLE', label: 'All allocated members have verified KYC and an approved application', automatic: true,
        met: ineligible.length === 0, detail: ineligible.length ? `Not eligible: ${ineligible.map((c) => c.id).join(', ')}` : 'All eligible' },
      ...g.checklist.map((i) => ({
        key: i.id, label: i.title, automatic: false, met: i.status === 'CONFIRMED',
        detail: i.status === 'CONFIRMED' ? `Confirmed by ${userName(s, i.confirmedBy)}${i.reference ? ` (ref: ${i.reference})` : ''}` : 'Awaiting confirmation',
      })),
    ];
    return { items, allMet: items.every((i) => i.met) };
  };

  const present = (g: ChitGroup, u: User) => {
    const v = versionOf(g);
    const openStates = ['ENROLMENT_OPEN'];
    const act = openRequest(g, 'GROUP_ACTIVATION');
    return {
      ...g,
      scheme: { id: v.schemeId, versionId: v.id, version: v.version, name: v.config.name, status: v.status, config: v.config },
      tickets: g.tickets.map((t) => ({ ...t, customerName: s.customers.find((c) => c.id === t.customerId)?.name })),
      checklist: g.checklist.map((i) => ({ ...i, confirmedByName: userName(s, i.confirmedBy) })),
      history: g.history.map((h) => ({ ...h, actorName: userName(s, h.actorId) })),
      readiness: readiness(g),
      allocatedCount: g.tickets.filter((t) => t.customerId).length,
      approvalRequests: s.approvals.filter((r) => ['GROUP_OPEN', 'GROUP_ACTIVATION'].includes(r.entityType) && r.entityId === g.id),
      actions: {
        canEdit: hasPermission(u, 'group:edit') && g.status === 'DRAFT',
        canSubmit: hasPermission(u, 'group:submit') && g.status === 'DRAFT',
        canWithdrawOpen: openRequest(g, 'GROUP_OPEN')?.makerId === u.id,
        canAllocate: hasPermission(u, 'group:allocate') && openStates.includes(g.status),
        canAttest: hasPermission(u, 'group:attest') && ['ENROLMENT_OPEN', 'READY_TO_START'].includes(g.status),
        canMarkReady: hasPermission(u, 'group:submit') && g.status === 'ENROLMENT_OPEN',
        canReopen: hasPermission(u, 'group:submit') && g.status === 'READY_TO_START' && !act,
        canRequestActivation: hasPermission(u, 'group:submit') && g.status === 'READY_TO_START' && !act,
        canWithdrawActivation: act?.makerId === u.id,
        canSuspend: hasPermission(u, 'group:suspend') && g.status === 'ACTIVE',
        canResume: hasPermission(u, 'group:suspend') && g.status === 'SUSPENDED',
      },
    };
  };

  approvals.register('GROUP_OPEN', {
    permission: 'group:approve',
    requiresReview: false,
    currentRevision: (r) => getGroup(r.entityId).revision,
    onDecision(r, decision, u, comment) {
      const g = getGroup(r.entityId);
      changeStatus(s, u, g, decision === 'APPROVED' ? 'ENROLMENT_OPEN' : decision === 'RETURNED' ? 'DRAFT' : 'CLOSED', groupTransitions, comment);
    },
    onCancel: (r, u) => changeStatus(s, u, getGroup(r.entityId), 'DRAFT', groupTransitions, 'Submission withdrawn'),
  });

  approvals.register('GROUP_ACTIVATION', {
    permission: 'group:approve',
    requiresReview: false,
    currentRevision: (r) => getGroup(r.entityId).revision,
    onDecision(r, decision, u, comment) {
      const g = getGroup(r.entityId);
      if (decision === 'APPROVED') {
        // Conditions are re-verified at approval time: data may have changed since the request.
        if (!readiness(g).allMet) throw conflict('NOT_READY', 'Activation conditions are no longer satisfied');
        changeStatus(s, u, g, 'ACTIVE', groupTransitions, comment);
        for (const t of g.tickets) {
          const c = s.customers.find((x) => x.id === t.customerId);
          if (c) {
            c.membershipStatus = 'ACTIVE';
            logActivity(s, u, 'customer', c.id, 'GROUP_ACTIVATED', `Group ${g.code} activated; ticket ${t.no}`);
          }
        }
        hooks.onActivated?.(g, versionOf(g).config);
      }
      g.activationRequestId = undefined;
    },
    onCancel(r) {
      getGroup(r.entityId).activationRequestId = undefined;
    },
  });

  return {
    list(u: User, q: Query) {
      const rows = inScope(u, s.groups)
        .filter((g) => !q.status || g.status === q.status)
        .filter((g) => !q.branchId || g.branchId === q.branchId)
        .filter((g) => matches(q.q, g.code, g.name))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((g) => ({
          id: g.id, code: g.code, name: g.name, branchId: g.branchId, status: g.status, plannedStartDate: g.plannedStartDate,
          schemeLabel: `${versionOf(g).config.name} v${versionOf(g).version}`,
          allocated: g.tickets.filter((t) => t.customerId).length, tickets: g.tickets.length,
        }));
      return paginate(rows, q);
    },

    get: (u: User, id: string) => present(scoped(u, id), u),

    create(u: User, body: Body) {
      const c = new Check(body);
      const code = c.str('code', { required: true, pattern: /^[A-Z0-9-]{3,20}$/, msg: 'Use 3–20 capital letters, digits or hyphens' });
      const name = c.str('name', { required: true, min: 3, max: 120 });
      const schemeVersionId = c.str('schemeVersionId', { required: true });
      const branchId = c.str('branchId', { required: true });
      const plannedStartDate = c.date('plannedStartDate', true);
      if (branchId && !s.branches.some((b) => b.id === branchId)) c.errors.branchId = 'Unknown branch';
      c.done();
      assertBranch(u, branchId!);
      const v = s.schemeVersions.find((x) => x.id === schemeVersionId);
      if (!v) throw notFound('Scheme version');
      if (v.status !== 'PUBLISHED') throw conflict('SCHEME_NOT_PUBLISHED', 'Groups can only be created from a published scheme version');
      if (plannedStartDate! < v.config.effectiveFrom || (v.config.effectiveTo && plannedStartDate! > v.config.effectiveTo)) {
        throw conflict('OUTSIDE_EFFECTIVE_DATES', `Planned start must fall within the scheme's effective dates (${v.config.effectiveFrom} to ${v.config.effectiveTo ?? 'open'})`);
      }
      if (s.groups.some((g) => g.code === code)) throw conflict('DUPLICATE_CODE', `Group code ${code} already exists`);
      const g: ChitGroup = {
        id: s.nextId('GRP'), code: code!, name: name!, schemeId: v.schemeId, schemeVersionId: v.id, branchId: branchId!,
        status: 'DRAFT', plannedStartDate: plannedStartDate!, revision: 1, history: [],
        tickets: Array.from({ length: v.config.memberCount }, (_, i) => ({ no: i + 1, history: [] })),
        checklist: v.config.complianceChecklist.map((title) => ({ id: s.nextId('CHK'), title, status: 'PENDING' as const })),
        createdBy: u.id, createdAt: s.now().toISOString(),
      };
      s.groups.push(g);
      audit(s, u, 'group.create', 'group', g.id, { schemeVersionId: v.id });
      return present(g, u);
    },

    update(u: User, id: string, body: Body) {
      const g = scoped(u, id);
      if (g.status !== 'DRAFT') throw conflict('READ_ONLY', 'Only draft groups can be edited');
      const c = new Check(body);
      const name = c.str('name', { required: true, min: 3, max: 120 });
      const plannedStartDate = c.date('plannedStartDate', true);
      c.done();
      g.name = name!;
      g.plannedStartDate = plannedStartDate!;
      g.revision += 1;
      audit(s, u, 'group.edit', 'group', g.id, { revision: g.revision });
      return present(g, u);
    },

    submit(u: User, id: string) {
      const g = scoped(u, id);
      changeStatus(s, u, g, 'APPROVAL_PENDING', groupTransitions);
      approvals.submit(u, { entityType: 'GROUP_OPEN', entityId: g.id, entityLabel: label(g), branchId: g.branchId, revision: g.revision });
      return present(g, u);
    },

    withdrawOpen(u: User, id: string) {
      const g = scoped(u, id);
      const r = openRequest(g, 'GROUP_OPEN');
      if (!r) throw conflict('INVALID_STATE', 'No open request');
      approvals.withdraw(u, r.id);
      return present(g, u);
    },

    allocate(u: User, id: string, body: Body) {
      const g = scoped(u, id);
      const c = new Check(body);
      const customerId = c.str('customerId', { required: true });
      const ticketNo = c.int('ticketNo', { min: 1 });
      c.done();
      if (g.status !== 'ENROLMENT_OPEN') throw conflict('ENROLMENT_CLOSED', 'Tickets can only be allocated while enrolment is open');
      const customer = s.customers.find((x) => x.id === customerId);
      if (!customer) throw notFound('Customer');
      assertBranch(u, customer.branchId);
      if (customer.kycStatus !== 'VERIFIED') throw conflict('KYC_NOT_VERIFIED', 'Customer KYC is not verified');
      if (!['ENROLMENT_PENDING', 'ACTIVE'].includes(customer.membershipStatus)) throw conflict('NO_APPROVED_APPLICATION', 'Customer has no approved membership application');
      const cfg = versionOf(g).config;
      if (g.tickets.filter((t) => t.customerId === customerId).length >= cfg.maxTicketsPerMember) {
        throw conflict('TICKET_LIMIT', `A member can hold at most ${cfg.maxTicketsPerMember} ticket(s) in this group`);
      }
      const ticket = ticketNo ? g.tickets.find((t) => t.no === ticketNo) : g.tickets.find((t) => !t.customerId);
      if (!ticket) throw notFound('Ticket');
      if (ticket.customerId) throw conflict('TICKET_TAKEN', `Ticket ${ticket.no} is already allocated`);
      ticket.customerId = customerId;
      ticket.allocatedAt = s.now().toISOString();
      ticket.history.push({ action: 'ALLOCATED', customerId: customerId!, actorId: u.id, at: ticket.allocatedAt });
      logActivity(s, u, 'customer', customer.id, 'TICKET_ALLOCATED', `Ticket ${ticket.no} allocated in group ${g.code}`);
      audit(s, u, 'group.allocate', 'group', g.id, { ticketNo: ticket.no, customerId });
      return present(g, u);
    },

    release(u: User, id: string, ticketNo: number, body: Body) {
      const g = scoped(u, id);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, max: 300 });
      c.done();
      if (g.status !== 'ENROLMENT_OPEN') throw conflict('ENROLMENT_CLOSED', 'Tickets can only be released while enrolment is open');
      const ticket = g.tickets.find((t) => t.no === ticketNo);
      if (!ticket) throw notFound('Ticket');
      if (!ticket.customerId) throw conflict('INVALID_STATE', 'Ticket is not allocated');
      const customerId = ticket.customerId;
      ticket.history.push({ action: 'RELEASED', customerId, actorId: u.id, at: s.now().toISOString(), reason });
      ticket.customerId = undefined;
      ticket.allocatedAt = undefined;
      logActivity(s, u, 'customer', customerId, 'TICKET_RELEASED', `Ticket ${ticketNo} released in group ${g.code} (${reason})`);
      audit(s, u, 'group.release', 'group', g.id, { ticketNo, customerId, reason });
      return present(g, u);
    },

    attest(u: User, id: string, itemId: string, body: Body) {
      const g = scoped(u, id);
      if (!['ENROLMENT_OPEN', 'READY_TO_START'].includes(g.status)) throw conflict('INVALID_STATE', 'Checklist can be confirmed once enrolment is open');
      const item = g.checklist.find((i) => i.id === itemId);
      if (!item) throw notFound('Checklist item');
      const c = new Check(body);
      const reference = c.str('reference', { required: true, max: 200 });
      c.done();
      item.status = 'CONFIRMED';
      item.reference = reference;
      item.confirmedBy = u.id;
      item.confirmedAt = s.now().toISOString();
      audit(s, u, 'group.attest', 'group', g.id, { item: item.title, reference });
      return present(g, u);
    },

    markReady(u: User, id: string) {
      const g = scoped(u, id);
      if (g.status !== 'ENROLMENT_OPEN') throw conflict('INVALID_TRANSITION', 'Group is not in enrolment');
      const r = readiness(g);
      if (!r.allMet) throw conflict('NOT_READY', 'Readiness conditions are not met', r.items.filter((i) => !i.met));
      changeStatus(s, u, g, 'READY_TO_START', groupTransitions);
      audit(s, u, 'group.ready', 'group', g.id);
      return present(g, u);
    },

    reopen(u: User, id: string) {
      const g = scoped(u, id);
      if (openRequest(g, 'GROUP_ACTIVATION')) throw conflict('INVALID_STATE', 'Withdraw the activation request first');
      changeStatus(s, u, g, 'ENROLMENT_OPEN', groupTransitions, 'Enrolment reopened');
      return present(g, u);
    },

    requestActivation(u: User, id: string) {
      const g = scoped(u, id);
      if (g.status !== 'READY_TO_START') throw conflict('INVALID_TRANSITION', 'Group must be Ready to Start');
      if (openRequest(g, 'GROUP_ACTIVATION')) throw conflict('DUPLICATE_REQUEST', 'An activation request is already open');
      const r = readiness(g);
      if (!r.allMet) throw conflict('NOT_READY', 'Readiness conditions are not met', r.items.filter((i) => !i.met));
      const req = approvals.submit(u, { entityType: 'GROUP_ACTIVATION', entityId: g.id, entityLabel: label(g), branchId: g.branchId, revision: g.revision });
      g.activationRequestId = req.id;
      return present(g, u);
    },

    withdrawActivation(u: User, id: string) {
      const g = scoped(u, id);
      const r = openRequest(g, 'GROUP_ACTIVATION');
      if (!r) throw conflict('INVALID_STATE', 'No open activation request');
      approvals.withdraw(u, r.id);
      return present(g, u);
    },

    setSuspended(u: User, id: string, suspend: boolean, body: Body) {
      const g = scoped(u, id);
      const c = new Check(body);
      const reason = c.str('reason', { required: true, max: 300 });
      c.done();
      changeStatus(s, u, g, suspend ? 'SUSPENDED' : 'ACTIVE', groupTransitions, reason);
      audit(s, u, suspend ? 'group.suspend' : 'group.resume', 'group', g.id, { reason });
      return present(g, u);
    },
  };
};

export type GroupService = ReturnType<typeof createGroupService>;

