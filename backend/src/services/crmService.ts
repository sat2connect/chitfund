import { LEAD_SOURCES, leadTransitions } from '../domain/rules.js';
import type { Customer, Lead, LeadStatus, User } from '../domain/types.js';
import { badRequest, conflict, notFound } from '../errors/AppError.js';
import { assertBranch, assertPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check, EMAIL, PHONE, PHONE_MSG } from '../validators/input.js';
import { audit, inScope, logActivity, matches, paginate, userName } from './common.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

export const createCrmService = (s: Store) => {
  const getLead = (u: User, id: string) => {
    const lead = s.leads.find((l) => l.id === id);
    if (!lead) throw notFound('Lead');
    assertBranch(u, lead.branchId);
    return lead;
  };
  const getCustomer = (u: User, id: string) => {
    const c = s.customers.find((x) => x.id === id);
    if (!c) throw notFound('Customer');
    assertBranch(u, c.branchId);
    return c;
  };
  const validBranch = (c: Check, body: Body, u: User) => {
    const branchId = c.str('branchId', { required: true });
    if (branchId && !s.branches.some((b) => b.id === branchId)) c.errors.branchId = 'Unknown branch';
    if (branchId && !c.errors.branchId) assertBranch(u, branchId);
    return branchId!;
  };
  const duplicates = (phone: string, email: string | undefined, includeLeads: boolean, excludeLeadId?: string) => [
    ...s.customers
      .filter((c) => c.phone === phone || (email && c.email === email))
      .map((c) => ({ type: 'customer', id: c.id, name: c.name })),
    ...(includeLeads
      ? s.leads
          .filter((l) => l.id !== excludeLeadId && l.status !== 'LOST' && (l.phone === phone || (email && l.email === email)))
          .map((l) => ({ type: 'lead', id: l.id, name: l.name }))
      : []),
  ];

  return {
    meta: () => ({ branches: s.branches, leadSources: LEAD_SOURCES, leadTransitions }),

    // ---- Leads ----
    listLeads(u: User, q: Query) {
      const rows = inScope(u, s.leads)
        .filter((l) => (!q.status || l.status === q.status) && (!q.branchId || l.branchId === q.branchId))
        .filter((l) => matches(q.q, l.name, l.phone, l.email, l.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(rows, q);
    },

    getLeadDetail(u: User, id: string) {
      const lead = getLead(u, id);
      return {
        lead,
        allowedTransitions: leadTransitions[lead.status].filter((t) => t !== ('CONVERTED' as LeadStatus)),
        canConvert: lead.status === 'REGISTRATION_PENDING',
        timeline: s.activities
          .filter((a) => a.entityType === 'lead' && a.entityId === id)
          .map((a) => ({ ...a, actorName: userName(s, a.actorId) }))
          .sort((a, b) => b.at.localeCompare(a.at)),
        followUps: s.followUps.filter((f) => f.leadId === id).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      };
    },

    createLead(u: User, body: Body) {
      const c = new Check(body);
      const name = c.str('name', { required: true, min: 2, max: 100 });
      const phone = c.str('phone', { required: true, pattern: PHONE, msg: PHONE_MSG });
      const email = c.str('email', { pattern: EMAIL, msg: 'Invalid email' });
      const source = c.oneOf('source', LEAD_SOURCES);
      const interestedScheme = c.str('interestedScheme', { max: 100 });
      const branchId = validBranch(c, body, u);
      c.done();

      const dups = duplicates(phone!, email, true);
      if (dups.length && body.confirmDuplicate !== true) {
        throw conflict('DUPLICATE_WARNING', 'A lead or customer with this phone/email already exists', dups);
      }
      const now = s.now().toISOString();
      const lead: Lead = {
        id: s.nextId('LD'), name: name!, phone: phone!, email, source: source!, branchId, interestedScheme,
        status: 'NEW', assignedTo: u.id, createdBy: u.id, createdAt: now, updatedAt: now,
      };
      s.leads.push(lead);
      logActivity(s, u, 'lead', lead.id, 'CREATED', `Lead created (source: ${lead.source})`);
      audit(s, u, 'lead.create', 'lead', lead.id);
      return lead;
    },

    transitionLead(u: User, id: string, body: Body) {
      const lead = getLead(u, id);
      const c = new Check(body);
      const to = c.oneOf('to', ['CONTACTED', 'INTERESTED', 'REGISTRATION_PENDING', 'LOST'] as const);
      const reason = c.str('reason', { max: 300 });
      if (to === 'LOST' && !reason) c.errors.reason = 'A reason is required when marking a lead lost';
      c.done();
      if (!leadTransitions[lead.status].includes(to!)) {
        throw conflict('INVALID_TRANSITION', `Cannot move a lead from ${lead.status} to ${to}`);
      }
      const from = lead.status;
      lead.status = to!;
      if (to === 'LOST') lead.lostReason = reason;
      lead.updatedAt = s.now().toISOString();
      logActivity(s, u, 'lead', id, 'STATUS', `Status ${from} → ${to}${reason ? ` (${reason})` : ''}`);
      audit(s, u, 'lead.transition', 'lead', id, { from, to });
      return lead;
    },

    addLeadNote(u: User, id: string, body: Body) {
      getLead(u, id);
      const c = new Check(body);
      const note = c.str('note', { required: true, max: 1000 });
      const type = c.oneOf('type', ['NOTE', 'CALL', 'MEETING'] as const);
      c.done();
      logActivity(s, u, 'lead', id, type!, note!);
      return { ok: true };
    },

    addFollowUp(u: User, id: string, body: Body) {
      const lead = getLead(u, id);
      const c = new Check(body);
      const dueAt = c.date('dueAt', true);
      const note = c.str('note', { required: true, max: 300 });
      c.done();
      if (lead.status === 'CONVERTED' || lead.status === 'LOST') throw conflict('INVALID_STATE', 'Cannot schedule follow-ups for a closed lead');
      const f = { id: s.nextId('FU'), leadId: id, branchId: lead.branchId, dueAt: dueAt!, note: note!, assigneeId: u.id, status: 'OPEN' as const };
      s.followUps.push(f);
      logActivity(s, u, 'lead', id, 'FOLLOWUP', `Follow-up scheduled for ${dueAt}: ${note}`);
      return f;
    },

    completeFollowUp(u: User, id: string) {
      const f = s.followUps.find((x) => x.id === id);
      if (!f) throw notFound('Follow-up');
      assertBranch(u, f.branchId);
      if (f.status === 'DONE') throw conflict('INVALID_STATE', 'Follow-up already completed');
      f.status = 'DONE';
      f.completedAt = s.now().toISOString();
      logActivity(s, u, 'lead', f.leadId, 'FOLLOWUP_DONE', `Follow-up completed: ${f.note}`);
      return f;
    },

    listFollowUps(u: User, q: Query) {
      const rows = inScope(u, s.followUps)
        .filter((f) => !q.status || f.status === q.status)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .map((f) => ({ ...f, leadName: s.leads.find((l) => l.id === f.leadId)?.name }));
      return paginate(rows, q);
    },

    // ---- Customers ----
    listCustomers(u: User, q: Query) {
      const rows = inScope(u, s.customers)
        .filter((c) => (!q.kycStatus || c.kycStatus === q.kycStatus) && (!q.branchId || c.branchId === q.branchId))
        .filter((c) => matches(q.q, c.name, c.phone, c.email, c.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((c) => ({ ...c, lifecycleStage: lifecycleStage(c) }));
      return paginate(rows, q);
    },

    createCustomer(u: User, body: Body, fromLead?: Lead) {
      const c = new Check(body);
      const name = c.str('name', { required: true, min: 2, max: 100 });
      const phone = c.str('phone', { required: true, pattern: PHONE, msg: PHONE_MSG });
      const email = c.str('email', { pattern: EMAIL, msg: 'Invalid email' });
      const dob = c.date('dob');
      const address = c.str('address', { max: 300 });
      const branchId = validBranch(c, body, u);
      c.done();
      if (dob && new Date(dob) > new Date()) throw badRequest('Validation failed', { dob: 'Date of birth cannot be in the future' });

      const dups = duplicates(phone!, email, false);
      if (dups.length && body.confirmDuplicate !== true) {
        throw conflict('DUPLICATE_WARNING', 'A customer with this phone/email already exists', dups);
      }
      const customer: Customer = {
        id: s.nextId('CU'), name: name!, phone: phone!, email, dob, address, branchId,
        kycStatus: 'NOT_STARTED', membershipStatus: 'NONE', leadId: fromLead?.id, createdBy: u.id, createdAt: s.now().toISOString(),
      };
      s.customers.push(customer);
      s.kycCases.push({ id: s.nextId('KYC'), customerId: customer.id, branchId, status: 'NOT_STARTED', documents: [], history: [] });
      logActivity(s, u, 'customer', customer.id, 'CREATED', fromLead ? `Registered from lead ${fromLead.id}` : 'Customer registered (staff-assisted)');
      audit(s, u, 'customer.create', 'customer', customer.id, { leadId: fromLead?.id });
      return customer;
    },

    convertLead(u: User, id: string, body: Body) {
      const lead = getLead(u, id);
      if (lead.status !== 'REGISTRATION_PENDING') {
        throw conflict('INVALID_TRANSITION', 'Only leads in Registration Pending can be converted to customers');
      }
      assertPermission(u, 'customer:create');
      const customer = this.createCustomer(u, { name: lead.name, phone: lead.phone, email: lead.email, branchId: lead.branchId, ...body }, lead);
      lead.status = 'CONVERTED';
      lead.customerId = customer.id;
      lead.updatedAt = s.now().toISOString();
      logActivity(s, u, 'lead', id, 'CONVERTED', `Converted to customer ${customer.id}`);
      audit(s, u, 'lead.convert', 'lead', id, { customerId: customer.id });
      return { lead, customer };
    },

    getCustomerProfile(u: User, id: string) {
      const customer = getCustomer(u, id);
      return {
        customer: { ...customer, lifecycleStage: lifecycleStage(customer) },
        timeline: s.activities
          .filter((a) => a.entityType === 'customer' && a.entityId === id)
          .map((a) => ({ ...a, actorName: userName(s, a.actorId) }))
          .sort((a, b) => b.at.localeCompare(a.at)),
        applications: s.applications.filter((a) => a.customerId === id),
        kycCaseId: s.kycCases.find((k) => k.customerId === id)?.id,
      };
    },
  };
};

// Customer journey stage derived from separate KYC and membership statuses (which stay independent).
export const lifecycleStage = (c: Customer) => {
  if (c.membershipStatus === 'ACTIVE') return 'ACTIVE_MEMBER';
  if (c.membershipStatus === 'ENROLMENT_PENDING') return 'ENROLMENT_PENDING';
  if (c.kycStatus === 'VERIFIED') return 'VERIFIED';
  if (c.kycStatus === 'UNDER_REVIEW') return 'KYC_UNDER_REVIEW';
  if (c.kycStatus === 'REJECTED') return 'REJECTED';
  return 'REGISTRATION_PENDING';
};
