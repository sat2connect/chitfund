import type { KycStatus, LeadStatus, Permission, Role } from './types.js';

export const rolePermissions: Record<Role, Permission[]> = {
  SUPER_ADMIN: ['lead:view', 'customer:view', 'kyc:view', 'application:view', 'audit:view', 'user:view', 'user:manage', 'scheme:view', 'group:view', 'approval:view',
    'instalment:view', 'payment:view', 'receipt:view', 'reconcile:view', 'accounting:view', 'payment:simulate',
    'auction:view', 'payout:view', 'support:view'],
  OPS_HEAD: [
    'lead:view', 'customer:view', 'kyc:view', 'application:view', 'application:approve', 'audit:view',
    'scheme:view', 'scheme:approve', 'scheme:publish', 'scheme:retire',
    'group:view', 'group:approve', 'group:open-enrolment', 'group:suspend', 'approval:view',
    'instalment:view', 'payment:view', 'receipt:view', 'reconcile:view', 'accounting:view',
    'auction:view', 'auction:approve', 'dispute:resolve', 'payout:view', 'payout:hold', 'support:view',
  ],
  BRANCH_MANAGER: [
    'lead:view', 'lead:create', 'lead:edit', 'lead:convert', 'followup:manage',
    'customer:view', 'customer:create', 'customer:edit',
    'kyc:view', 'kyc:submit', 'kyc:document:view', 'application:view', 'application:create',
    'scheme:view', 'group:view', 'group:allocate',
    'instalment:view', 'payment:view', 'receipt:view', 'collection:record',
    'auction:view', 'dispute:raise', 'support:view', 'support:manage',
  ],
  CRM_EXEC: [
    'lead:view', 'lead:create', 'lead:edit', 'lead:convert', 'followup:manage',
    'customer:view', 'customer:create', 'customer:edit',
    'kyc:view', 'kyc:submit', 'kyc:document:view', 'application:view', 'application:create',
    'scheme:view', 'group:view', 'support:view', 'support:manage',
  ],
  KYC_OFFICER: ['customer:view', 'kyc:view', 'kyc:submit', 'kyc:decide', 'kyc:document:view'],
  CHIT_OPS: [
    'customer:view', 'kyc:view', 'application:view', 'application:create',
    'scheme:view', 'scheme:create', 'scheme:edit', 'scheme:submit',
    'group:view', 'group:create', 'group:edit', 'group:submit', 'group:allocate', 'group:attest', 'approval:view',
    'auction:view', 'auction:create', 'auction:prepare', 'payout:view', 'payout:review',
  ],
  AUDITOR: [
    'lead:view', 'customer:view', 'kyc:view', 'kyc:document:view', 'application:view', 'audit:view',
    'scheme:view', 'group:view', 'approval:view',
    'instalment:view', 'payment:view', 'receipt:view', 'reconcile:view', 'accounting:view',
    'auction:view', 'payout:view', 'support:view',
  ],
  COLLECTION_OFFICER: [
    'customer:view', 'group:view', 'instalment:view', 'payment:view', 'receipt:view', 'collection:record', 'payment:initiate',
  ],
  FINANCE_MAKER: [
    'customer:view', 'group:view', 'instalment:view', 'payment:view', 'receipt:view', 'reconcile:view', 'reconcile:manage',
    'accounting:view', 'account:manage', 'journal:create', 'journal:submit', 'payment:reverse-request', 'payment:simulate', 'approval:view',
    'auction:view', 'payout:view', 'payout:create', 'payout:disburse', 'payout:reconcile',
  ],
  FINANCE_CHECKER: [
    'customer:view', 'group:view', 'instalment:view', 'payment:view', 'receipt:view', 'reconcile:view', 'accounting:view',
    'journal:approve', 'payment:reverse-approve', 'period:manage', 'approval:view',
    'payout:view', 'payout:approve',
  ],
  AUCTION_OFFICER: [
    'customer:view', 'group:view', 'approval:view', 'auction:view', 'auction:create', 'auction:prepare', 'auction:operate', 'dispute:raise',
  ],
  CHIT_MEMBER: ['auction:view', 'bid:submit', 'dispute:raise', 'portal:access'],
};

// Lead transitions. CONVERTED is reachable only through the convert workflow.
export const leadTransitions: Record<LeadStatus, LeadStatus[]> = {
  NEW: ['CONTACTED', 'LOST'],
  CONTACTED: ['INTERESTED', 'LOST'],
  INTERESTED: ['REGISTRATION_PENDING', 'LOST'],
  REGISTRATION_PENDING: ['LOST'],
  CONVERTED: [],
  LOST: ['CONTACTED'],
};

export const kycTransitions: Record<KycStatus, KycStatus[]> = {
  NOT_STARTED: ['DOCUMENTS_PENDING'],
  DOCUMENTS_PENDING: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED', 'CORRECTION_REQUIRED'],
  CORRECTION_REQUIRED: ['DOCUMENTS_PENDING', 'UNDER_REVIEW'],
  VERIFIED: [],
  REJECTED: [],
};

// PLACEHOLDER lists: the real required documents come from compliance / scheme configuration.
export const KYC_DOCUMENT_TYPES = ['IDENTITY_PROOF', 'ADDRESS_PROOF', 'PHOTO', 'OTHER'] as const;
export const KYC_REQUIRED_DOCUMENT_TYPES = ['IDENTITY_PROOF', 'ADDRESS_PROOF'] as const;
export const LEAD_SOURCES = ['WALK_IN', 'REFERRAL', 'PHONE', 'SOCIAL', 'CAMPAIGN', 'OTHER'] as const;

// PLACEHOLDER option lists: extendable without code changes elsewhere.
export const JURISDICTIONS = ['TAMIL_NADU'] as const;
export const INSTALMENT_FREQUENCIES = ['MONTHLY'] as const;
// The auction operating model is undecided; all three are modelled, none is declared approved.
export const AUCTION_MODES = ['STAFF_ASSISTED', 'MEMBER_BIDS', 'HYBRID'] as const;

export const schemeVersionTransitions: Record<string, string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT', 'REJECTED'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['RETIRED'],
  RETIRED: [],
  REJECTED: [],
};

export const groupTransitions: Record<string, string[]> = {
  DRAFT: ['APPROVAL_PENDING'],
  APPROVAL_PENDING: ['APPROVED', 'DRAFT', 'CLOSED'],
  APPROVED: ['ENROLMENT_OPEN', 'CLOSED'],
  ENROLMENT_OPEN: ['READY_TO_START'],
  READY_TO_START: ['ACTIVE', 'ENROLMENT_OPEN'],
  ACTIVE: ['SUSPENDED', 'COMPLETED'],
  SUSPENDED: ['ACTIVE'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
};

export const journalTransitions: Record<string, string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['DRAFT', 'APPROVED'],
  APPROVED: ['POSTED'],
  POSTED: ['REVERSED'],
  REVERSED: [],
};

export const PAYMENT_MODES = ['CASH', 'CHEQUE', 'UPI', 'BANK_TRANSFER'] as const;

export const auctionTransitions: Record<string, string[]> = {
  SCHEDULED: ['READY', 'CANCELLED'],
  READY: ['OPEN', 'SCHEDULED', 'CANCELLED'],
  OPEN: ['CLOSED', 'CANCELLED'],
  CLOSED: ['VALIDATION', 'CANCELLED'],
  VALIDATION: ['APPROVAL_PENDING', 'CANCELLED'],
  APPROVAL_PENDING: ['APPROVED', 'VALIDATION', 'CANCELLED'],
  APPROVED: ['SETTLED', 'CANCELLED'],
  SETTLED: [],
  CANCELLED: [],
};

export const payoutTransitions: Record<string, string[]> = {
  DRAFT: ['ELIGIBILITY_REVIEW', 'ON_HOLD'],
  ELIGIBILITY_REVIEW: ['PENDING_APPROVAL', 'DRAFT', 'ON_HOLD'],
  PENDING_APPROVAL: ['APPROVED', 'ELIGIBILITY_REVIEW', 'DRAFT', 'ON_HOLD'],
  APPROVED: ['DISBURSEMENT_PENDING', 'ON_HOLD'],
  DISBURSEMENT_PENDING: ['PAID', 'FAILED', 'ON_HOLD'],
  FAILED: ['DISBURSEMENT_PENDING', 'ON_HOLD'],
  ON_HOLD: ['DRAFT', 'ELIGIBILITY_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'DISBURSEMENT_PENDING', 'FAILED'],
  PAID: [],
};

// PLACEHOLDER: permitted payout channels. Providers are undecided; this list is configuration, not integration.
export const PAYOUT_CHANNELS = ['BANK_TRANSFER', 'CHEQUE'] as const;
export const supportTransitions: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED', 'OPEN'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};

export const SUPPORT_CATEGORIES = ['PAYMENT', 'AUCTION', 'PAYOUT', 'KYC', 'ACCOUNT', 'COMPLAINT', 'OTHER'] as const;