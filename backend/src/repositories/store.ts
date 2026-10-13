import type {
  Activity, ApprovalRequest, AuditEntry, Branch, ChitGroup, Customer, FollowUp, KycCase, Lead, MembershipApplication,
  Scheme, SchemeVersion, User, Instalment, Payment, Allocation, Receipt, PaymentAttempt, BankStatementLine,
  ReconciliationResult, Account, AccountingPeriod, Journal, Auction, Payout, SupportCase,
} from '../domain/types.js';

/**
 * DEVELOPMENT-ONLY in-memory store. Not production persistence: data is lost on restart and there
 * are no transactions. Services depend on this shape so a real database can replace it later.
 */
export interface Store {
  branches: Branch[];
  users: User[];
  leads: Lead[];
  followUps: FollowUp[];
  customers: Customer[];
  kycCases: KycCase[];
  applications: MembershipApplication[];
  activities: Activity[];
  audit: AuditEntry[];
  schemes: Scheme[];
  schemeVersions: SchemeVersion[];
  groups: ChitGroup[];
  approvals: ApprovalRequest[];
  instalments: Instalment[];
  payments: Payment[];
  allocations: Allocation[];
  receipts: Receipt[];
  attempts: PaymentAttempt[];
  bankLines: BankStatementLine[];
  reconResults: ReconciliationResult[];
  accounts: Account[];
  periods: AccountingPeriod[];
  journals: Journal[];
  auctions: Auction[];
  payouts: Payout[];
  supportCases: SupportCase[];
  /** PLACEHOLDER business settings; real values need approval from the business. */
  settings: { graceDays: number };
  /** Posting rules: which accounts a collection hits. PLACEHOLDER until the accountant approves. */
  postingRules: {
    debitByMode: Record<string, string>;
    creditAccountCode: string;
    payoutDebitCode: string;
    payoutCreditByChannel: Record<string, string>;
  };
  /** Authoritative server clock. Overridable in tests. */
  now(): Date;
  /** Current business date (Asia/Kolkata) as YYYY-MM-DD. Overridable in tests. */
  today(): string;
  /** Id counters per prefix. Exposed so the persistence layer can save and restore them. */
  counters: Record<string, number>;
  nextId(prefix: string): string;
}

export const createEmptyStore = (): Store => {
  const counters: Record<string, number> = {};
  return {
    counters,
    branches: [], users: [], leads: [], followUps: [], customers: [],
    kycCases: [], applications: [], activities: [], audit: [],
    schemes: [], schemeVersions: [], groups: [], approvals: [],
    instalments: [], payments: [], allocations: [], receipts: [], attempts: [], bankLines: [], reconResults: [],
    accounts: [], periods: [], journals: [], auctions: [], payouts: [], supportCases: [],
    now: () => new Date(),
    settings: { graceDays: 0 },
    postingRules: { debitByMode: {}, creditAccountCode: '', payoutDebitCode: '', payoutCreditByChannel: {} },
    today: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
    nextId(prefix) {
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      return `${prefix}-${String(counters[prefix]).padStart(4, '0')}`;
    },
  };
};

