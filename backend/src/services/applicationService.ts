import type { MembershipApplication, User } from '../domain/types.js';
import { conflict, forbidden, notFound } from '../errors/AppError.js';
import { assertBranch } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import { audit, inScope, logActivity, matches, paginate, userName } from './common.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

export const createApplicationService = (s: Store) => {
  const get = (u: User, id: string) => {
    const a = s.applications.find((x) => x.id === id);
    if (!a) throw notFound('Application');
    assertBranch(u, a.branchId);
    return a;
  };
  const present = (a: MembershipApplication) => ({
    ...a,
    customerName: s.customers.find((c) => c.id === a.customerId)?.name,
    submittedByName: userName(s, a.submittedBy),
    decidedByName: userName(s, a.decidedBy),
  });

  return {
    list(u: User, q: Query) {
      const rows = inScope(u, s.applications)
        .filter((a) => !q.status || a.status === q.status)
        .map(present)
        .filter((a) => matches(q.q, a.customerName, a.id, a.customerId))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return paginate(rows, q);
    },

    create(u: User, body: Body) {
      const c = new Check(body);
      const customerId = c.str('customerId', { required: true });
      const preferredScheme = c.str('preferredScheme', { required: true, max: 100 });
      const notes = c.str('notes', { max: 500 });
      c.done();
      const customer = s.customers.find((x) => x.id === customerId);
      if (!customer) throw notFound('Customer');
      assertBranch(u, customer.branchId);
      // KYC and membership are separate: an application needs verified KYC but does not change it.
      if (customer.kycStatus !== 'VERIFIED') throw conflict('KYC_NOT_VERIFIED', 'KYC must be verified before a membership application');
      if (customer.membershipStatus !== 'NONE') throw conflict('INVALID_STATE', 'Customer already has a membership in progress');
      if (s.applications.some((a) => a.customerId === customerId && a.status === 'SUBMITTED')) {
        throw conflict('DUPLICATE_APPLICATION', 'An application is already awaiting approval for this customer');
      }
      const app: MembershipApplication = {
        id: s.nextId('APP'), customerId: customerId!, branchId: customer.branchId, preferredScheme: preferredScheme!,
        notes, status: 'SUBMITTED', submittedBy: u.id, submittedAt: s.now().toISOString(),
      };
      s.applications.push(app);
      logActivity(s, u, 'customer', customer.id, 'APPLICATION', `Membership application ${app.id} submitted`);
      audit(s, u, 'application.submit', 'application', app.id);
      return present(app);
    },

    decide(u: User, id: string, body: Body) {
      const app = get(u, id);
      const c = new Check(body);
      const decision = c.oneOf('decision', ['APPROVED', 'REJECTED'] as const);
      const comment = c.str('comment', { max: 500 });
      if (decision === 'REJECTED' && !comment) c.errors.comment = 'A comment is required to reject';
      c.done();
      if (app.status !== 'SUBMITTED') throw conflict('INVALID_TRANSITION', 'Application has already been decided');
      if (app.submittedBy === u.id) throw forbidden('You cannot approve your own submission', 'MAKER_CHECKER');
      app.status = decision!;
      app.decidedBy = u.id;
      app.decidedAt = s.now().toISOString();
      app.comment = comment;
      const customer = s.customers.find((x) => x.id === app.customerId)!;
      if (decision === 'APPROVED') customer.membershipStatus = 'ENROLMENT_PENDING';
      logActivity(s, u, 'customer', customer.id, 'APPLICATION_DECISION', `Application ${app.id} ${decision}${comment ? ` (${comment})` : ''}`);
      audit(s, u, 'application.decide', 'application', app.id, { decision, comment });
      return present(app);
    },
  };
};
