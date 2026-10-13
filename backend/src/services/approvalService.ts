import type { ApprovalEntityType, ApprovalRequest, Permission, User } from '../domain/types.js';
import { conflict, forbidden, notFound } from '../errors/AppError.js';
import { assertPermission, canAccessBranch, hasPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import { audit, matches, paginate, userName } from './common.js';

type Decision = 'APPROVED' | 'RETURNED' | 'REJECTED';

/** Each approvable entity registers how its state changes when a request is reviewed or decided. */
export interface ApprovalHandler {
  /** Approval policy (currently fixed in code; configurable policies come with Administration). */
  permission: Permission;
  requiresReview: boolean;
  currentRevision(req: ApprovalRequest): number;
  onStartReview?(req: ApprovalRequest, actor: User): void;
  onDecision(req: ApprovalRequest, decision: Decision, actor: User, comment?: string): void;
  onCancel(req: ApprovalRequest, actor: User): void;
}

type Query = Record<string, unknown>;

export const createApprovalService = (s: Store) => {
  const handlers = new Map<ApprovalEntityType, ApprovalHandler>();
  const handler = (t: ApprovalEntityType) => handlers.get(t)!;

  const find = (u: User, id: string) => {
    const r = s.approvals.find((x) => x.id === id);
    if (!r) throw notFound('Approval request');
    if (r.branchId && !canAccessBranch(u, r.branchId)) throw forbidden('This request belongs to a branch you cannot access', 'FORBIDDEN_BRANCH');
    return r;
  };

  const present = (r: ApprovalRequest, u: User) => {
    const h = handler(r.entityType);
    const open = r.status === 'PENDING' || r.status === 'IN_REVIEW';
    const eligible = open && hasPermission(u, h.permission) && r.makerId !== u.id;
    return {
      ...r,
      subjectPath: r.entityType === 'SCHEME_VERSION'
        ? `/schemes/${s.schemeVersions.find((v) => v.id === r.entityId)?.schemeId}`
        : r.entityType === 'JOURNAL' || r.entityType === 'JOURNAL_REVERSAL'
          ? `/accounting/journals/${r.entityId}`
          : r.entityType === 'PAYMENT_REVERSAL'
            ? `/collections/payments/${r.entityId}`
            : r.entityType === 'AUCTION_RESULT'
              ? `/auctions/${r.entityId}`
              : r.entityType === 'PAYOUT'
                ? `/payouts/${r.entityId}`
                : `/schemes/groups/${r.entityId}`,
      makerName: userName(s, r.makerId),
      reviewerName: userName(s, r.reviewerId),
      checkerName: userName(s, r.checkerId),
      actions: {
        canStartReview: eligible && h.requiresReview && r.status === 'PENDING',
        canDecide: eligible && (h.requiresReview ? r.status === 'IN_REVIEW' : true),
        isOwnSubmission: r.makerId === u.id,
      },
    };
  };

  const service = {
    register: (t: ApprovalEntityType, h: ApprovalHandler) => handlers.set(t, h),

    /** Creates a request bound to the exact revision submitted. */
    submit(actor: User, p: { entityType: ApprovalEntityType; entityId: string; entityLabel: string; branchId?: string; revision: number }) {
      const req: ApprovalRequest = {
        id: s.nextId('APR'), entityType: p.entityType, entityId: p.entityId, entityLabel: p.entityLabel, branchId: p.branchId,
        makerId: actor.id, submittedRevision: p.revision, submittedAt: s.now().toISOString(), status: 'PENDING',
      };
      s.approvals.push(req);
      audit(s, actor, 'approval.submit', p.entityType, p.entityId, { requestId: req.id, revision: p.revision });
      return req;
    },

    /** Cancels any open request for an entity whose state is being changed by another workflow (e.g. a dispute upheld). */
    forceCancel(actor: User, entityType: ApprovalEntityType, entityId: string, reason: string) {
      for (const r of s.approvals.filter((x) => x.entityType === entityType && x.entityId === entityId && (x.status === 'PENDING' || x.status === 'IN_REVIEW'))) {
        r.status = 'CANCELLED';
        r.decidedAt = s.now().toISOString();
        r.comment = reason;
        audit(s, actor, 'approval.cancel', entityType, entityId, { requestId: r.id, reason });
      }
    },

    /** Maker withdraws an open request. */
    withdraw(actor: User, requestId: string) {
      const r = s.approvals.find((x) => x.id === requestId)!;
      if (r.makerId !== actor.id) throw forbidden('Only the submitter can withdraw a request', 'MAKER_ONLY');
      if (r.status !== 'PENDING' && r.status !== 'IN_REVIEW') throw conflict('INVALID_STATE', 'Request is no longer open');
      handler(r.entityType).onCancel(r, actor);
      r.status = 'CANCELLED';
      r.decidedAt = s.now().toISOString();
      audit(s, actor, 'approval.withdraw', r.entityType, r.entityId, { requestId: r.id });
    },

    list(u: User, q: Query) {
      const open = (r: ApprovalRequest) => r.status === 'PENDING' || r.status === 'IN_REVIEW';
      const rows = s.approvals
        .filter((r) => !r.branchId || canAccessBranch(u, r.branchId))
        .filter((r) => !q.type || r.entityType === q.type)
        .filter((r) => {
          switch (q.scope) {
            case 'mine': return r.makerId === u.id;
            case 'history': return !open(r);
            case 'returned': return r.status === 'RETURNED' || r.status === 'REJECTED';
            case 'queue': return open(r) && hasPermission(u, handler(r.entityType).permission);
            default: return true;
          }
        })
        .filter((r) => matches(q.q, r.entityLabel, r.id, r.entityId))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((r) => present(r, u));
      return paginate(rows, q);
    },

    get: (u: User, id: string) => present(find(u, id), u),

    startReview(u: User, id: string) {
      const r = find(u, id);
      const h = handler(r.entityType);
      assertPermission(u, h.permission);
      if (!h.requiresReview) throw conflict('INVALID_STATE', 'This request type has no review step');
      if (r.status !== 'PENDING') throw conflict('INVALID_TRANSITION', 'Only pending requests can be taken into review');
      if (r.makerId === u.id) throw forbidden('You cannot review your own submission', 'MAKER_CHECKER');
      h.onStartReview?.(r, u);
      r.status = 'IN_REVIEW';
      r.reviewerId = u.id;
      audit(s, u, 'approval.review', r.entityType, r.entityId, { requestId: r.id });
      return present(r, u);
    },

    decide(u: User, id: string, body: Record<string, unknown>) {
      const r = find(u, id);
      const h = handler(r.entityType);
      assertPermission(u, h.permission);
      const c = new Check(body);
      const decision = c.oneOf('decision', ['APPROVED', 'RETURNED', 'REJECTED'] as const);
      const comment = c.str('comment', { max: 500 });
      if (decision && decision !== 'APPROVED' && !comment) c.errors.comment = 'A comment is required for this decision';
      c.done();

      if (r.makerId === u.id) throw forbidden('You cannot decide your own submission', 'MAKER_CHECKER');
      if (r.status !== 'PENDING' && r.status !== 'IN_REVIEW') throw conflict('INVALID_TRANSITION', 'Request has already been decided');
      if (h.requiresReview && r.status !== 'IN_REVIEW') throw conflict('REVIEW_REQUIRED', 'Start the review before deciding');
      // A material edit after submission invalidates the request.
      if (h.currentRevision(r) !== r.submittedRevision) {
        h.onCancel(r, u);
        r.status = 'CANCELLED';
        r.decidedAt = s.now().toISOString();
        throw conflict('STALE_SUBMISSION', 'The record changed after submission; the request was cancelled and must be resubmitted');
      }
      h.onDecision(r, decision!, u, comment); // may throw (e.g. guard conditions); request stays open then
      r.status = decision!;
      r.checkerId = u.id;
      r.decidedAt = s.now().toISOString();
      r.comment = comment;
      audit(s, u, 'approval.decide', r.entityType, r.entityId, { requestId: r.id, decision, comment });
      return present(r, u);
    },
  };
  return service;
};

export type ApprovalService = ReturnType<typeof createApprovalService>;

