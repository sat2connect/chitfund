import {
  AUCTION_MODES, INSTALMENT_FREQUENCIES, JURISDICTIONS, schemeVersionTransitions,
} from '../domain/rules.js';
import type { OverdueRules, SchemeConfig, SchemeVersion, User } from '../domain/types.js';
import { badRequest, conflict, forbidden, notFound } from '../errors/AppError.js';
import { hasPermission } from '../policies/access.js';
import type { Store } from '../repositories/store.js';
import { Check } from '../validators/input.js';
import type { ApprovalService } from './approvalService.js';
import { audit, changeStatus, matches, paginate, userName } from './common.js';

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;
const OPEN: SchemeVersion['status'][] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates the instalment overdue / grace configuration. Every field is optional; defaults reproduce the current behaviour. */
export const parseOverdueRules = (raw: unknown, errors: Record<string, string>): OverdueRules => {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Body;
  const c = new Check(body);
  const graceDays = c.int('graceDays', { min: 0, max: 365 });
  const cutoffTime = c.str('cutoffTime', { pattern: /^([01]\d|2[0-3]):[0-5]\d$/, msg: 'Use 24-hour HH:MM' });
  const timezone = c.str('timezone', { max: 60 });
  if (timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { c.errors.timezone = 'Unknown timezone (use an IANA name such as Asia/Kolkata)'; }
  }
  if (body.partialPaymentStopsOverdue !== undefined && typeof body.partialPaymentStopsOverdue !== 'boolean') c.errors.partialPaymentStopsOverdue = 'Must be true or false';
  const holidayPolicy = c.oneOf('holidayPolicy', ['NONE', 'NEXT_UNLISTED_DAY'] as const, false) ?? 'NONE';
  const nonWorkingDates = c.list('nonWorkingDates', { max: 400, itemMax: 10 });
  if (nonWorkingDates.some((d) => !DATE.test(d) || Number.isNaN(Date.parse(d)))) c.errors.nonWorkingDates = 'Each item must be a date (YYYY-MM-DD)';
  const days = (field: 'reminderDaysBefore' | 'reminderDaysAfter') => {
    const v = body[field];
    if (v === undefined || v === null) return [] as number[];
    if (!Array.isArray(v) || v.some((x) => !Number.isInteger(x) || x < 0 || x > 365) || v.length > 10) {
      c.errors[field] = 'Must be up to 10 whole numbers of days (0–365)';
      return [];
    }
    return [...new Set(v as number[])].sort((x, y) => x - y);
  };
  const reminderDaysBefore = days('reminderDaysBefore');
  const reminderDaysAfter = days('reminderDaysAfter');
  const lateFeeText = c.str('lateFeeText', { max: 2000 });
  const escalationText = c.str('escalationText', { max: 2000 });
  const disputedPaymentText = c.str('disputedPaymentText', { max: 2000 });
  const policyConfirmationRef = c.str('policyConfirmationRef', { max: 200 });
  for (const [k, v] of Object.entries(c.errors)) errors[`overdueRules.${k}`] = v;
  return {
    graceDays, cutoffTime, timezone, partialPaymentStopsOverdue: body.partialPaymentStopsOverdue === true, holidayPolicy,
    nonWorkingDates: [...new Set(nonWorkingDates)].sort(), reminderDaysBefore, reminderDaysAfter,
    lateFeeText, escalationText, disputedPaymentText, policyConfirmationRef,
  };
};

/** Validates and normalises a scheme configuration. Returns non-blocking warnings separately. */
export const parseSchemeConfig = (raw: unknown): { config: SchemeConfig; warnings: string[] } => {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Body;
  const c = new Check(body);
  const name = c.str('name', { required: true, min: 3, max: 120 });
  const jurisdiction = c.oneOf('jurisdiction', JURISDICTIONS);
  const chitValuePaise = c.int('chitValuePaise', { required: true, min: 1 });
  const memberCount = c.int('memberCount', { required: true, min: 2, max: 1000 });
  const installmentAmountPaise = c.int('installmentAmountPaise', { required: true, min: 1 });
  const frequency = c.oneOf('frequency', INSTALMENT_FREQUENCIES);
  const tenureMonths = c.int('tenureMonths', { required: true, min: 1, max: 600 });
  const maxTicketsPerMember = c.int('maxTicketsPerMember', { min: 1, max: 100 }) ?? 1;
  const minEnrolmentToActivate = c.int('minEnrolmentToActivate', { min: 1, max: memberCount ?? 1000 }) ?? memberCount;
  const effectiveFrom = c.date('effectiveFrom', true);
  const effectiveTo = c.date('effectiveTo');
  const dividendRuleText = c.str('dividendRuleText', { max: 2000 });
  const commissionRuleText = c.str('commissionRuleText', { max: 2000 });
  const eligibilityRequirements = c.str('eligibilityRequirements', { max: 2000 });
  const requiredDocuments = c.list('requiredDocuments', { max: 20, itemMax: 80 });
  const complianceChecklist = c.list('complianceChecklist', { max: 30, itemMax: 200 });

  const schemeType = c.str('schemeType', { max: 80 });
  const description = c.str('description', { max: 2000 });
  const permittedBranchIds = c.list('permittedBranchIds', { max: 50, itemMax: 40 });
  const discountPolicyText = c.str('discountPolicyText', { max: 2000 });
  const roundingPolicyText = c.str('roundingPolicyText', { max: 1000 });
  const overdueRules = parseOverdueRules(body.overdueRules, c.errors);

  const a = ((body.auction ?? {}) as Body);
  const ac = new Check(a);
  const mode = ac.oneOf('mode', AUCTION_MODES);
  const minBidPaise = ac.int('minBidPaise', { min: 0 });
  const maxBidPaise = ac.int('maxBidPaise', { min: 0 });
  const bidIncrementPaise = ac.int('bidIncrementPaise', { min: 1 });
  const tieBreakRule = ac.str('tieBreakRule', { max: 500 });
  const notes = ac.str('notes', { max: 1000 });
  for (const [k, v] of Object.entries(ac.errors)) c.errors[`auction.${k}`] = v;

  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) c.errors.effectiveTo = 'Must not be before the effective-from date';
  if (minBidPaise !== undefined && maxBidPaise !== undefined && maxBidPaise < minBidPaise) c.errors['auction.maxBidPaise'] = 'Must not be below the minimum bid';
  if (chitValuePaise && maxBidPaise && maxBidPaise > chitValuePaise) c.errors['auction.maxBidPaise'] = 'Must not exceed the chit value';
  c.done();

  const warnings: string[] = [];
  if (memberCount && installmentAmountPaise && chitValuePaise && memberCount * installmentAmountPaise !== chitValuePaise) {
    warnings.push('Chit value differs from instalment × member count. Confirm this matches the approved scheme terms.');
  }
  if (memberCount && tenureMonths && memberCount !== tenureMonths) {
    warnings.push('Tenure (months) differs from the member count. Confirm this matches the approved scheme terms.');
  }
  if (!dividendRuleText) warnings.push('No dividend rule description recorded.');
  if (!commissionRuleText) warnings.push('No commission rule description recorded.');
  if (!discountPolicyText) warnings.push('No discount policy description recorded.');
  if (!roundingPolicyText) warnings.push('No rounding policy description recorded.');
  if (!overdueRules.policyConfirmationRef) {
    warnings.push('Overdue and grace-period rules are UNAPPROVED: no business/compliance confirmation reference is recorded.');
  }

  return {
    warnings,
    config: {
      name: name!, jurisdiction: jurisdiction!, chitValuePaise: chitValuePaise!, memberCount: memberCount!,
      installmentAmountPaise: installmentAmountPaise!, frequency: frequency!, tenureMonths: tenureMonths!,
      auction: { mode: mode!, minBidPaise, maxBidPaise, bidIncrementPaise, tieBreakRule, notes },
      dividendRuleText, commissionRuleText, eligibilityRequirements, requiredDocuments, complianceChecklist,
      maxTicketsPerMember, minEnrolmentToActivate: minEnrolmentToActivate!, effectiveFrom: effectiveFrom!, effectiveTo,
      schemeType, description, permittedBranchIds, discountPolicyText, roundingPolicyText, overdueRules,
    },
  };
};

export const createSchemeService = (s: Store, approvals: ApprovalService) => {
  const getVersion = (id: string) => {
    const v = s.schemeVersions.find((x) => x.id === id);
    if (!v) throw notFound('Scheme version');
    return v;
  };
  const assertBranches = (config: SchemeConfig) => {
    const unknown = (config.permittedBranchIds ?? []).filter((id) => !s.branches.some((b) => b.id === id));
    if (unknown.length) throw badRequest('Validation failed', { permittedBranchIds: `Unknown branch: ${unknown.join(', ')}` });
  };
  const versionsOf = (schemeId: string) => s.schemeVersions.filter((v) => v.schemeId === schemeId).sort((a, b) => a.version - b.version);
  const label = (v: SchemeVersion) => `${s.schemes.find((x) => x.id === v.schemeId)!.code} v${v.version} – ${v.config.name}`;
  const openRequest = (v: SchemeVersion) =>
    s.approvals.find((r) => r.entityType === 'SCHEME_VERSION' && r.entityId === v.id && (r.status === 'PENDING' || r.status === 'IN_REVIEW'));

  const present = (v: SchemeVersion, u: User) => {
    const maker = hasPermission(u, 'scheme:edit');
    return {
      ...v,
      createdByName: userName(s, v.createdBy),
      history: v.history.map((h) => ({ ...h, actorName: userName(s, h.actorId) })),
      approvalRequests: s.approvals.filter((r) => r.entityType === 'SCHEME_VERSION' && r.entityId === v.id),
      actions: {
        canEdit: maker && v.status === 'DRAFT',
        canSubmit: hasPermission(u, 'scheme:submit') && v.status === 'DRAFT',
        canWithdraw: openRequest(v)?.makerId === u.id,
        canPublish: hasPermission(u, 'scheme:publish') && v.status === 'APPROVED',
        canRetire: hasPermission(u, 'scheme:retire') && v.status === 'PUBLISHED',
      },
    };
  };

  approvals.register('SCHEME_VERSION', {
    permission: 'scheme:approve',
    requiresReview: true,
    currentRevision: (r) => getVersion(r.entityId).revision,
    onStartReview: (r, u) => changeStatus(s, u, getVersion(r.entityId), 'UNDER_REVIEW', schemeVersionTransitions),
    onDecision(r, decision, u, comment) {
      const v = getVersion(r.entityId);
      const to = decision === 'APPROVED' ? 'APPROVED' : decision === 'RETURNED' ? 'DRAFT' : 'REJECTED';
      changeStatus(s, u, v, to, schemeVersionTransitions, comment);
      v.updatedAt = s.now().toISOString();
    },
    onCancel: (r, u) => changeStatus(s, u, getVersion(r.entityId), 'DRAFT', schemeVersionTransitions, 'Submission withdrawn'),
  });

  return {
    meta: () => ({
      jurisdictions: JURISDICTIONS, frequencies: INSTALMENT_FREQUENCIES, auctionModes: AUCTION_MODES,
      branches: s.branches.map((b) => ({ id: b.id, name: b.name })),
    }),

    list(u: User, q: Query) {
      const rows = s.schemes
        .map((sc) => {
          const vs = versionsOf(sc.id);
          const latest = vs[vs.length - 1]!;
          const published = [...vs].reverse().find((v) => v.status === 'PUBLISHED');
          return {
            id: sc.id, code: sc.code, name: latest.config.name,
            latestVersion: { id: latest.id, version: latest.version, status: latest.status },
            publishedVersion: published ? { id: published.id, version: published.version } : null,
            chitValuePaise: latest.config.chitValuePaise, memberCount: latest.config.memberCount,
            installmentAmountPaise: latest.config.installmentAmountPaise, createdAt: sc.createdAt,
          };
        })
        .filter((r) => !q.status || r.latestVersion.status === q.status)
        .filter((r) => matches(q.q, r.code, r.name))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(rows, q);
    },

    get(u: User, id: string) {
      const sc = s.schemes.find((x) => x.id === id);
      if (!sc) throw notFound('Scheme');
      const vs = versionsOf(id);
      const latest = vs[vs.length - 1]!;
      return {
        scheme: sc,
        versions: vs.map((v) => present(v, u)),
        canCreateVersion: hasPermission(u, 'scheme:create') && !vs.some((v) => OPEN.includes(v.status)),
        warnings: parseSchemeConfig(latest.config).warnings,
      };
    },

    create(u: User, body: Body) {
      const c = new Check(body);
      const code = c.str('code', { required: true, pattern: /^[A-Z0-9-]{3,20}$/, msg: 'Use 3–20 capital letters, digits or hyphens' });
      let parsed: ReturnType<typeof parseSchemeConfig> | undefined;
      try { parsed = parseSchemeConfig(body.config); } catch (e) {
        if (!c.errors.code) c.done();
        const err = e as { details?: Record<string, string> };
        throw badRequest('Validation failed', { ...(err.details ?? {}), ...c.errors });
      }
      c.done();
      assertBranches(parsed.config);
      if (s.schemes.some((x) => x.code === code)) throw conflict('DUPLICATE_CODE', `Scheme code ${code} already exists`);
      const now = s.now().toISOString();
      const sc = { id: s.nextId('SCH'), code: code!, createdBy: u.id, createdAt: now };
      s.schemes.push(sc);
      const v: SchemeVersion = {
        id: s.nextId('SCV'), schemeId: sc.id, version: 1, status: 'DRAFT', config: parsed.config, revision: 1,
        createdBy: u.id, createdAt: now, updatedAt: now, history: [],
      };
      s.schemeVersions.push(v);
      audit(s, u, 'scheme.create', 'scheme', sc.id, { code });
      return { scheme: sc, version: present(v, u), warnings: parsed.warnings };
    },

    updateDraft(u: User, versionId: string, body: Body) {
      const v = getVersion(versionId);
      if (v.status !== 'DRAFT') throw conflict('READ_ONLY', 'Only draft versions can be edited. Create a new version to change approved terms.');
      const parsed = parseSchemeConfig(body.config);
      assertBranches(parsed.config);
      v.config = parsed.config;
      v.revision += 1;
      v.updatedAt = s.now().toISOString();
      audit(s, u, 'scheme.edit', 'scheme_version', v.id, { revision: v.revision });
      return { version: present(v, u), warnings: parsed.warnings };
    },

    submit(u: User, versionId: string) {
      const v = getVersion(versionId);
      changeStatus(s, u, v, 'SUBMITTED', schemeVersionTransitions);
      const req = approvals.submit(u, { entityType: 'SCHEME_VERSION', entityId: v.id, entityLabel: label(v), revision: v.revision });
      audit(s, u, 'scheme.submit', 'scheme_version', v.id, { requestId: req.id });
      return { version: present(v, u), request: req };
    },

    withdraw(u: User, versionId: string) {
      const v = getVersion(versionId);
      const req = openRequest(v);
      if (!req) throw conflict('INVALID_STATE', 'No open approval request to withdraw');
      approvals.withdraw(u, req.id);
      return present(v, u);
    },

    createVersion(u: User, schemeId: string) {
      const vs = versionsOf(schemeId);
      if (!vs.length) throw notFound('Scheme');
      if (vs.some((v) => OPEN.includes(v.status))) throw conflict('OPEN_VERSION_EXISTS', 'Finish or withdraw the open version before creating a new one');
      const base = vs[vs.length - 1]!;
      const now = s.now().toISOString();
      const v: SchemeVersion = {
        id: s.nextId('SCV'), schemeId, version: base.version + 1, status: 'DRAFT', config: structuredClone(base.config),
        revision: 1, createdBy: u.id, createdAt: now, updatedAt: now, history: [],
      };
      s.schemeVersions.push(v);
      audit(s, u, 'scheme.new_version', 'scheme_version', v.id, { basedOn: base.id });
      return present(v, u);
    },

    publish(u: User, versionId: string) {
      const v = getVersion(versionId);
      const req = s.approvals.filter((r) => r.entityType === 'SCHEME_VERSION' && r.entityId === v.id && r.status === 'APPROVED').pop();
      if (!req || req.submittedRevision !== v.revision) throw conflict('NOT_APPROVED', 'This exact version has no valid approval');
      if (req.makerId === u.id) throw forbidden('The submitter cannot publish their own scheme', 'MAKER_CHECKER');
      changeStatus(s, u, v, 'PUBLISHED', schemeVersionTransitions);
      audit(s, u, 'scheme.publish', 'scheme_version', v.id);
      return present(v, u);
    },

    retire(u: User, versionId: string, body: Body) {
      const v = getVersion(versionId);
      const c = new Check(body);
      const comment = c.str('comment', { required: true, max: 500 });
      c.done();
      changeStatus(s, u, v, 'RETIRED', schemeVersionTransitions, comment);
      audit(s, u, 'scheme.retire', 'scheme_version', v.id, { comment });
      return present(v, u);
    },

    /** Published versions available for new groups. */
    publishedVersions: () =>
      s.schemeVersions.filter((v) => v.status === 'PUBLISHED').map((v) => ({
        id: v.id, label: label(v), schemeId: v.schemeId, config: v.config,
      })),
  };
};

export type SchemeService = ReturnType<typeof createSchemeService>;
