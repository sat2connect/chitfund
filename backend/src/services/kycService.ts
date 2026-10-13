import { kycTransitions, KYC_DOCUMENT_TYPES, KYC_REQUIRED_DOCUMENT_TYPES } from '../domain/rules.js';
import type { KycCase, KycStatus, User } from '../domain/types.js';
import { conflict, forbidden, notFound } from '../errors/AppError.js';
import { assertBranch, hasPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import { audit, inScope, logActivity, matches, paginate, userName } from './common.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

export const createKycService = (s: Store) => {
  const getCase = (u: User, id: string) => {
    const k = s.kycCases.find((x) => x.id === id);
    if (!k) throw notFound('KYC case');
    assertBranch(u, k.branchId);
    return k;
  };
  const move = (u: User, k: KycCase, to: KycStatus, comment?: string) => {
    if (!kycTransitions[k.status].includes(to)) throw conflict('INVALID_TRANSITION', `Cannot move KYC from ${k.status} to ${to}`);
    k.history.push({ id: s.nextId('KEV'), at: s.now().toISOString(), actorId: u.id, from: k.status, to, comment });
    k.status = to;
    const customer = s.customers.find((c) => c.id === k.customerId)!;
    customer.kycStatus = to; // mirrored for listing; membership status is untouched
  };
  const view = (u: User, k: KycCase) => {
    const customer = s.customers.find((c) => c.id === k.customerId)!;
    const canSeeDocs = hasPermission(u, 'kyc:document:view');
    return {
      ...k,
      customerName: customer.name,
      // Restricted: users without document access only see counts, never file details.
      documents: canSeeDocs ? k.documents.map((d) => ({ ...d, uploadedByName: userName(s, d.uploadedBy) })) : null,
      documentCount: k.documents.filter((d) => d.active).length,
      history: k.history.map((h) => ({ ...h, actorName: userName(s, h.actorId) })),
      requiredDocuments: KYC_REQUIRED_DOCUMENT_TYPES,
      missingDocuments: KYC_REQUIRED_DOCUMENT_TYPES.filter((t) => !k.documents.some((d) => d.active && d.type === t)),
      storageNotice: 'Document metadata only. File storage has not been selected, so no files are stored.',
    };
  };

  return {
    list(u: User, q: Query) {
      const rows = inScope(u, s.kycCases)
        .filter((k) => !q.status || k.status === q.status)
        .map((k) => ({ ...k, customerName: s.customers.find((c) => c.id === k.customerId)?.name }))
        .filter((k) => matches(q.q, k.customerName, k.customerId, k.id))
        .map((k) => ({
          id: k.id, customerId: k.customerId, customerName: k.customerName, branchId: k.branchId,
          status: k.status, submittedAt: k.submittedAt, documentCount: k.documents.filter((d) => d.active).length,
        }))
        .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
      return paginate(rows, q);
    },

    get: (u: User, id: string) => view(u, getCase(u, id)),

    addDocument(u: User, id: string, body: Body) {
      const k = getCase(u, id);
      const c = new Check(body);
      const type = c.oneOf('type', KYC_DOCUMENT_TYPES);
      const fileName = c.str('fileName', { required: true, max: 150 });
      const note = c.str('note', { max: 300 });
      c.done();
      if (k.status === 'UNDER_REVIEW' || k.status === 'VERIFIED' || k.status === 'REJECTED') {
        throw conflict('INVALID_STATE', `Documents cannot be changed while KYC is ${k.status}`);
      }
      const prev = k.documents.find((d) => d.active && d.type === type);
      if (prev) prev.active = false; // superseded, never deleted: full document history is preserved
      k.documents.push({
        id: s.nextId('DOC'), type: type!, fileName: fileName!, note, version: (prev?.version ?? 0) + 1,
        active: true, uploadedBy: u.id, uploadedAt: s.now().toISOString(),
      });
      if (k.status === 'NOT_STARTED' || k.status === 'CORRECTION_REQUIRED') move(u, k, 'DOCUMENTS_PENDING', `Document added: ${type}`);
      logActivity(s, u, 'customer', k.customerId, 'KYC_DOCUMENT', `KYC document recorded: ${type} (${fileName})`);
      audit(s, u, 'kyc.document.add', 'kyc', k.id, { type, version: (prev?.version ?? 0) + 1 });
      return view(u, k);
    },

    submit(u: User, id: string) {
      const k = getCase(u, id);
      const missing = KYC_REQUIRED_DOCUMENT_TYPES.filter((t) => !k.documents.some((d) => d.active && d.type === t));
      if (!['DOCUMENTS_PENDING', 'CORRECTION_REQUIRED'].includes(k.status)) {
        throw conflict('INVALID_TRANSITION', `KYC in status ${k.status} cannot be submitted for review`);
      }
      if (missing.length) throw conflict('DOCUMENTS_MISSING', `Required documents missing: ${missing.join(', ')}`, missing);
      move(u, k, 'UNDER_REVIEW', 'Submitted for review');
      k.submittedBy = u.id;
      k.submittedAt = s.now().toISOString();
      logActivity(s, u, 'customer', k.customerId, 'KYC_SUBMITTED', 'KYC submitted for manual review');
      audit(s, u, 'kyc.submit', 'kyc', k.id);
      return view(u, k);
    },

    decide(u: User, id: string, body: Body) {
      const k = getCase(u, id);
      const c = new Check(body);
      const decision = c.oneOf('decision', ['VERIFIED', 'REJECTED', 'CORRECTION_REQUIRED'] as const);
      const comment = c.str('comment', { max: 500 });
      if (decision && decision !== 'VERIFIED' && !comment) c.errors.comment = 'A comment is required for this decision';
      c.done();
      if (k.status !== 'UNDER_REVIEW') throw conflict('INVALID_TRANSITION', 'Only cases under review can be decided');
      if (k.submittedBy === u.id) throw forbidden('The person who submitted a KYC case cannot decide it', 'MAKER_CHECKER');
      move(u, k, decision!, comment);
      logActivity(s, u, 'customer', k.customerId, 'KYC_DECISION', `KYC decision: ${decision}${comment ? ` (${comment})` : ''}`);
      audit(s, u, 'kyc.decide', 'kyc', k.id, { decision, comment });
      return view(u, k);
    },
  };
};
