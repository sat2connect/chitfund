export type Role =
  | 'SUPER_ADMIN'
  | 'OPS_HEAD'
  | 'BRANCH_MANAGER'
  | 'CRM_EXEC'
  | 'KYC_OFFICER'
  | 'CHIT_OPS'
  | 'AUDITOR'
  | 'COLLECTION_OFFICER'
  | 'FINANCE_MAKER'
  | 'FINANCE_CHECKER'
  | 'AUCTION_OFFICER'
  | 'CHIT_MEMBER';

export type Permission =
  | 'lead:view' | 'lead:create' | 'lead:edit' | 'lead:convert'
  | 'followup:manage'
  | 'customer:view' | 'customer:create' | 'customer:edit'
  | 'kyc:view' | 'kyc:submit' | 'kyc:decide' | 'kyc:document:view'
  | 'application:view' | 'application:create' | 'application:approve'
  | 'scheme:view' | 'scheme:create' | 'scheme:edit' | 'scheme:submit' | 'scheme:approve' | 'scheme:publish' | 'scheme:retire'
  | 'group:view' | 'group:create' | 'group:edit' | 'group:submit' | 'group:approve' | 'group:allocate' | 'group:attest' | 'group:suspend' | 'group:open-enrolment'
  | 'approval:view'
  | 'instalment:view' | 'payment:view' | 'collection:record' | 'payment:initiate' | 'payment:simulate'
  | 'payment:reverse-request' | 'payment:reverse-approve' | 'receipt:view' | 'reconcile:view' | 'reconcile:manage'
  | 'auction:view' | 'auction:create' | 'auction:prepare' | 'auction:operate' | 'auction:approve' | 'bid:submit'
  | 'dispute:raise' | 'dispute:resolve'
  | 'payout:view' | 'payout:create' | 'payout:review' | 'payout:approve' | 'payout:disburse' | 'payout:hold' | 'payout:reconcile'
  | 'portal:access' | 'support:view' | 'support:manage'
  | 'accounting:view' | 'account:manage' | 'journal:create' | 'journal:submit' | 'journal:approve' | 'period:manage'
  | 'audit:view' | 'user:view' | 'user:manage';

export interface User {
  id: string;
  name: string;
  roles: Role[];
  /** 'ALL' for central roles, otherwise explicit branch ids. */
  branchIds: string[] | 'ALL';
  /** Set for member sessions; members only ever act on their own tickets. */
  customerId?: string;
  /** Disabled users cannot sign in and their sessions are rejected. */
  status?: 'ACTIVE' | 'DISABLED';
}

export interface Branch { id: string; name: string }

export type LeadStatus = 'NEW' | 'CONTACTED' | 'INTERESTED' | 'REGISTRATION_PENDING' | 'CONVERTED' | 'LOST';

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  source: string;
  branchId: string;
  assignedTo?: string;
  status: LeadStatus;
  interestedScheme?: string;
  lostReason?: string;
  customerId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: string;
  leadId: string;
  branchId: string;
  dueAt: string;
  note: string;
  assigneeId: string;
  status: 'OPEN' | 'DONE';
  completedAt?: string;
}

export type KycStatus =
  | 'NOT_STARTED' | 'DOCUMENTS_PENDING' | 'UNDER_REVIEW' | 'CORRECTION_REQUIRED' | 'VERIFIED' | 'REJECTED';
export type MembershipStatus = 'NONE' | 'ENROLMENT_PENDING' | 'ACTIVE';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  dob?: string;
  address?: string;
  branchId: string;
  kycStatus: KycStatus;
  membershipStatus: MembershipStatus;
  leadId?: string;
  createdBy: string;
  createdAt: string;
}

export interface KycDocument {
  id: string;
  type: string;
  fileName: string;
  version: number;
  active: boolean;
  note?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface KycEvent {
  id: string;
  at: string;
  actorId: string;
  from: KycStatus;
  to: KycStatus;
  comment?: string;
}

export interface KycCase {
  id: string;
  customerId: string;
  branchId: string;
  status: KycStatus;
  documents: KycDocument[];
  history: KycEvent[];
  submittedBy?: string;
  submittedAt?: string;
}

export interface MembershipApplication {
  id: string;
  customerId: string;
  branchId: string;
  preferredScheme: string;
  notes?: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedBy: string;
  submittedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
}

export interface Activity {
  id: string;
  entityType: 'lead' | 'customer';
  entityId: string;
  type: string;
  note: string;
  actorId: string;
  at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: unknown;
}

// ---------- Phase 3: schemes, groups, approvals ----------
export interface StatusEvent {
  id: string;
  at: string;
  actorId: string;
  from: string;
  to: string;
  comment?: string;
}

/** All money is stored as integer paise to avoid floating-point error. */
export interface SchemeConfig {
  name: string;
  jurisdiction: string;
  chitValuePaise: number;
  memberCount: number;
  installmentAmountPaise: number;
  frequency: string;
  tenureMonths: number;
  auction: {
    mode: string;
    minBidPaise?: number;
    maxBidPaise?: number;
    bidIncrementPaise?: number;
    tieBreakRule?: string;
    notes?: string;
  };
  /** Rule descriptions as approved by the company. Stored as text; NOT interpreted by the system yet. */
  dividendRuleText?: string;
  commissionRuleText?: string;
  eligibilityRequirements?: string;
  requiredDocuments: string[];
  /** Contractual / regulatory prerequisites that must be attested per group before activation. */
  complianceChecklist: string[];
  maxTicketsPerMember: number;
  minEnrolmentToActivate: number;
  effectiveFrom: string;
  effectiveTo?: string;
  /** Free-text classification chosen by the company (no fixed list is imposed). */
  schemeType?: string;
  description?: string;
  /** Branches allowed to run groups of this scheme. Empty or absent = no branch restriction. */
  permittedBranchIds?: string[];
  /** Policy descriptions as approved by the company. Text only: NOT interpreted by the system. */
  discountPolicyText?: string;
  roundingPolicyText?: string;
  /** Instalment overdue / grace rules. Provisional until the business and compliance team confirm them. */
  overdueRules?: OverdueRules;
}

export interface OverdueRules {
  /** Overrides the global placeholder grace days when set. */
  graceDays?: number;
  /** Recorded for the approved policy; NOT applied yet because payments carry a date, not a time. */
  cutoffTime?: string;
  timezone?: string;
  /** When true, an instalment with any successful part-payment stays "Partially paid" instead of becoming overdue. */
  partialPaymentStopsOverdue: boolean;
  /** NEXT_UNLISTED_DAY moves a due date that falls on a listed non-working date to the next date that is not listed. */
  holidayPolicy: 'NONE' | 'NEXT_UNLISTED_DAY';
  nonWorkingDates: string[];
  /** Reminder offsets in days. Shown for planning only; nothing is sent (no notification provider). */
  reminderDaysBefore: number[];
  reminderDaysAfter: number[];
  /** Descriptions only: late fees are never charged and eligibility is never changed automatically. */
  lateFeeText?: string;
  escalationText?: string;
  disputedPaymentText?: string;
  /** Reference of the business/compliance confirmation. Without it the rules are shown as UNAPPROVED. */
  policyConfirmationRef?: string;
}

export type SchemeVersionStatus =
  | 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'RETIRED' | 'REJECTED';

export interface Scheme {
  id: string;
  code: string;
  createdBy: string;
  createdAt: string;
}

export interface SchemeVersion {
  id: string;
  schemeId: string;
  version: number;
  status: SchemeVersionStatus;
  config: SchemeConfig;
  /** Incremented on every edit; approvals bind to the revision that was submitted. */
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: StatusEvent[];
}

export type GroupStatus =
  | 'DRAFT' | 'APPROVAL_PENDING' | 'APPROVED' | 'ENROLMENT_OPEN' | 'READY_TO_START' | 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'CLOSED';

export interface TicketEvent {
  action: 'ALLOCATED' | 'RELEASED';
  customerId: string;
  actorId: string;
  at: string;
  reason?: string;
}

export interface Ticket {
  no: number;
  customerId?: string;
  allocatedAt?: string;
  history: TicketEvent[];
}

export interface ChecklistItem {
  id: string;
  title: string;
  status: 'PENDING' | 'CONFIRMED';
  reference?: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface ScheduledInstalment {
  seq: number;
  dueDate: string;
}
export interface ScheduledAuction {
  cycleNo: number;
  plannedDate: string;
}
/** Metadata only: no file storage is configured. */
export interface ComplianceDocument {
  id: string;
  title: string;
  reference: string;
  addedBy: string;
  addedAt: string;
}

export interface ChitGroup {
  id: string;
  code: string;
  name: string;
  schemeId: string;
  schemeVersionId: string;
  branchId: string;
  status: GroupStatus;
  /** Commencement date: the first instalment is due on it (placeholder rule). */
  plannedStartDate: string;
  enrolmentStartDate?: string;
  enrolmentEndDate?: string;
  /** Provisional: derived from the commencement date by the placeholder monthly rule while the group is in Draft. */
  instalmentSchedule?: ScheduledInstalment[];
  auctionSchedule?: ScheduledAuction[];
  complianceDocuments?: ComplianceDocument[];
  revision: number;
  tickets: Ticket[];
  checklist: ChecklistItem[];
  history: StatusEvent[];
  activationRequestId?: string;
  createdBy: string;
  createdAt: string;
}

export type ApprovalEntityType =
  | 'SCHEME_VERSION' | 'GROUP_OPEN' | 'GROUP_ACTIVATION' | 'JOURNAL' | 'JOURNAL_REVERSAL' | 'PAYMENT_REVERSAL' | 'AUCTION_RESULT' | 'PAYOUT';
export type ApprovalStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'CANCELLED';

export interface ApprovalRequest {
  id: string;
  entityType: ApprovalEntityType;
  entityId: string;
  entityLabel: string;
  branchId?: string;
  makerId: string;
  submittedRevision: number;
  submittedAt: string;
  status: ApprovalStatus;
  reviewerId?: string;
  checkerId?: string;
  decidedAt?: string;
  comment?: string;
}


// ---------- Phase 4: collections and accounting ----------
export type InstalmentStatus = 'SCHEDULED' | 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

export interface Instalment {
  id: string;
  groupId: string;
  groupCode: string;
  branchId: string;
  ticketNo: number;
  customerId: string;
  seq: number;
  dueDate: string;
  amountPaise: number;
  /** Sum of ACTIVE allocations. Status is derived from dates + this value at read time. */
  paidPaise: number;
}

export type PaymentMode = 'CASH' | 'CHEQUE' | 'UPI' | 'BANK_TRANSFER' | 'ONLINE_SIMULATED';
export type ReconciliationStatus = 'PENDING' | 'MATCHED' | 'EXCEPTION' | 'NOT_APPLICABLE';

export interface Payment {
  id: string;
  customerId: string;
  branchId: string;
  mode: PaymentMode;
  amountPaise: number;
  reference?: string;
  receivedDate: string;
  status: 'SUCCESSFUL' | 'REVERSED';
  /** True when the money movement came from the simulated gateway (no real money moved). */
  simulated: boolean;
  attemptId?: string;
  clientRequestId?: string;
  receiptId: string;
  journalId?: string;
  reconciliationStatus: ReconciliationStatus;
  recordedBy: string;
  createdAt: string;
  reversedAt?: string;
  reversalReason?: string;
}

export interface Allocation {
  id: string;
  paymentId: string;
  instalmentId: string;
  amountPaise: number;
  status: 'ACTIVE' | 'REVERSED';
}

export interface Receipt {
  id: string;
  paymentId: string;
  customerId: string;
  branchId: string;
  amountPaise: number;
  issuedAt: string;
  status: 'ISSUED' | 'VOID';
}

export interface PaymentAttempt {
  id: string;
  customerId: string;
  branchId: string;
  instalmentIds: string[];
  amountPaise: number;
  status: 'INITIATED' | 'PENDING_CONFIRMATION' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  simulated: true;
  providerRef: string;
  initiatedBy: string;
  createdAt: string;
  callbacks: { eventId: string; outcome: 'SUCCESS' | 'FAILURE'; at: string; applied: boolean }[];
  paymentId?: string;
}

export interface BankStatementLine {
  id: string;
  date: string;
  amountPaise: number;
  reference: string;
  description?: string;
  status: 'UNMATCHED' | 'MATCHED';
  /** CREDIT = money in (collections); DEBIT = money out (payouts). Defaults to CREDIT. */
  direction?: 'CREDIT' | 'DEBIT';
  paymentId?: string;
  payoutId?: string;
  createdBy: string;
}

export interface ReconciliationResult {
  id: string;
  paymentId: string;
  bankLineId: string;
  result: 'MATCHED' | 'EXCEPTION';
  differencePaise: number;
  comment?: string;
  by: string;
  at: string;
}

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  /** Optional grouping: the account this one rolls up under. Reporting does not use it yet. */
  parentId?: string;
  active: boolean;
  /** True while the chart has not been approved by the client's accountant. */
  placeholder: boolean;
}

export interface AccountingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  history: { at: string; actorId: string; action: 'CLOSED' | 'REOPENED'; reason?: string }[];
}

export interface JournalLine {
  accountId: string;
  debitPaise: number;
  creditPaise: number;
  memo?: string;
}

export type JournalStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'REVERSED';

export interface Journal {
  id: string;
  number: string;
  date: string;
  periodId: string;
  status: JournalStatus;
  memo: string;
  lines: JournalLine[];
  source: { type: 'MANUAL' | 'PAYMENT' | 'PAYMENT_REVERSAL' | 'JOURNAL_REVERSAL' | 'PAYOUT'; id?: string };
  simulated: boolean;
  revision: number;
  reversalOf?: string;
  reversedBy?: string;
  createdBy: string;
  createdAt: string;
  postedAt?: string;
  history: StatusEvent[];
}
// ---------- Phase 5: auctions and payouts ----------
export type AuctionStatus =
  | 'SCHEDULED' | 'READY' | 'OPEN' | 'CLOSED' | 'VALIDATION' | 'APPROVAL_PENDING' | 'APPROVED' | 'SETTLED' | 'CANCELLED';

/** Rules recorded explicitly per auction. None is assumed: the auction officer must choose each one. */
export interface AuctionRules {
  winnerSelection: 'HIGHEST_BID' | 'LOWEST_BID';
  tieBreak: 'EARLIEST_BID' | 'MANUAL';
  bidPolicy: 'SINGLE' | 'MULTIPLE';
  excludePriorWinners: boolean;
  requireNoOverdue: boolean;
  /** Snapshotted from the pinned scheme version at scheduling time. */
  minBidPaise?: number;
  maxBidPaise?: number;
  bidIncrementPaise?: number;
  schemeAuctionMode: string;
}

export interface Bid {
  id: string;
  auctionId: string;
  ticketNo: number;
  customerId: string;
  amountPaise: number;
  submittedBy: string;
  /** Authoritative server time; the client clock is never trusted. */
  serverTimestamp: string;
  sequence: number;
  clientRequestId: string;
}

export interface AuctionResult {
  outcome: 'AWARDED' | 'NO_VALID_BID';
  winnerTicketNo?: number;
  winnerCustomerId?: string;
  winningBidId?: string;
  winningAmountPaise?: number;
  tiedTicketNos: number[];
  needsManualDecision: boolean;
  tieBreakApplied?: 'EARLIEST_BID' | 'MANUAL';
  manualReason?: string;
  computedAt: string;
  computedBy: string;
  validatedBy?: string;
  validatedAt?: string;
}

export interface Dispute {
  id: string;
  raisedBy: string;
  raisedAt: string;
  reason: string;
  status: 'OPEN' | 'DISMISSED' | 'UPHELD';
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface Auction {
  id: string;
  groupId: string;
  groupCode: string;
  branchId: string;
  schemeVersionId: string;
  cycleNo: number;
  scheduledOpenAt: string;
  scheduledCloseAt: string;
  status: AuctionStatus;
  rules: AuctionRules;
  bids: Bid[];
  result?: AuctionResult;
  disputes: Dispute[];
  revision: number;
  history: StatusEvent[];
  cancelReason?: string;
  createdBy: string;
  createdAt: string;
}

export type PayoutStatus =
  | 'DRAFT' | 'ELIGIBILITY_REVIEW' | 'PENDING_APPROVAL' | 'APPROVED' | 'DISBURSEMENT_PENDING' | 'PAID' | 'ON_HOLD' | 'FAILED';

export interface PayoutDocument {
  id: string;
  title: string;
  status: 'PENDING' | 'CONFIRMED';
  reference?: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface Payout {
  id: string;
  auctionId: string;
  groupId: string;
  groupCode: string;
  branchId: string;
  ticketNo: number;
  customerId: string;
  status: PayoutStatus;
  /** Entered manually by Finance. NOT calculated by the system (calculation engine not yet approved). */
  amountPaise: number;
  amountBasis: string;
  documents: PayoutDocument[];
  channel?: string;
  disbursement?: { reference: string; paidDate: string; recordedBy: string; recordedAt: string };
  failureReason?: string;
  holdReason?: string;
  holdPrevious?: PayoutStatus;
  journalId?: string;
  reconciliationStatus: 'PENDING' | 'MATCHED' | 'EXCEPTION';
  clientRequestId?: string;
  revision: number;
  history: StatusEvent[];
  createdBy: string;
  createdAt: string;
}
// ---------- Phase 6: customer portal ----------
export type SupportCategory = 'PAYMENT' | 'AUCTION' | 'PAYOUT' | 'KYC' | 'ACCOUNT' | 'COMPLAINT' | 'OTHER';
export type SupportStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface SupportMessage {
  id: string;
  at: string;
  authorId: string;
  authorType: 'MEMBER' | 'STAFF';
  /** Internal notes are visible to staff only, never to the member. */
  internal: boolean;
  body: string;
}

export interface SupportCase {
  id: string;
  customerId: string;
  branchId: string;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  assignedTo?: string;
  messages: SupportMessage[];
  history: StatusEvent[];
  clientRequestId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}