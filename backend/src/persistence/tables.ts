import type { Store } from '../repositories/store.js';

/**
 * Mapping from the application's collections to PostgreSQL tables.
 *
 * Each row stores the whole entity as JSON (`data`) plus a few "promoted" columns derived from it here, in one
 * place, so keys, uniqueness and CHECK constraints in the database can never drift from the entity.
 */

type Entity = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type CollectionKey =
  | 'branches' | 'users' | 'leads' | 'followUps' | 'customers' | 'kycCases' | 'applications' | 'activities' | 'audit'
  | 'schemes' | 'schemeVersions' | 'groups' | 'approvals' | 'instalments' | 'payments' | 'allocations' | 'receipts'
  | 'attempts' | 'bankLines' | 'reconResults' | 'accounts' | 'periods' | 'journals' | 'auctions' | 'bids' | 'payouts'
  | 'supportCases';

export interface ChildSpec {
  /** Compact string that changes whenever the children change. */
  fingerprint(e: Entity): string;
  /** Removes children from the JSON stored in the parent's `data` column. */
  strip(e: Entity): Entity;
  /** SQL to write the children, given a changed/new parent. `prev` is the previous fingerprint (undefined if new). */
  write(e: Entity, prev: string | undefined): { text: string; params: unknown[] }[];
  /** Re-attaches children while loading. */
  attach(parents: Entity[], loadChildren: (sql: string) => Promise<Entity[]>): Promise<void>;
}

export interface TableSpec {
  key: Exclude<CollectionKey, 'bids'>;
  table: string;
  /** Promoted columns: SQL column name -> value derived from the entity. */
  columns: Record<string, (e: Entity) => unknown>;
  /** Append-only tables are inserted once and never updated. */
  appendOnly?: boolean;
  child?: ChildSpec;
}

/** Postgres array literal for a text[] parameter. */
export const pgArray = (xs: string[]) => `{${xs.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
const n = <T>(v: T | undefined) => (v === undefined ? null : v);

const journalLines: ChildSpec = {
  fingerprint: (e) => JSON.stringify(e.lines),
  strip: (e) => e,
  write: (e, prev) => {
    if (prev === JSON.stringify(e.lines)) return [];
    const ops = [{ text: 'delete from journal_lines where journal_id = $1', params: [e.id] }];
    (e.lines as Entity[]).forEach((l, i) =>
      ops.push({
        text: 'insert into journal_lines (journal_id, line_no, account_id, debit_paise, credit_paise, memo) values ($1,$2,$3,$4,$5,$6)',
        params: [e.id, i + 1, l.accountId, l.debitPaise, l.creditPaise, n(l.memo)],
      }),
    );
    return ops;
  },
  attach: async () => undefined, // lines are part of `data`; the table copy exists for database-level guards
};

const auctionBids: ChildSpec = {
  fingerprint: (e) => (e.bids as Entity[]).map((b) => b.id).join(','),
  strip: (e) => ({ ...e, bids: [] }),
  write: (e, prev) => {
    const known = new Set((prev ?? '').split(',').filter(Boolean));
    return (e.bids as Entity[])
      .filter((b) => !known.has(b.id))
      .map((b) => ({
        text: `insert into bids (id, auction_id, ticket_no, customer_id, amount_paise, submitted_by, server_timestamp, sequence, client_request_id, data)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        params: [b.id, e.id, b.ticketNo, b.customerId, b.amountPaise, b.submittedBy, b.serverTimestamp, b.sequence, b.clientRequestId, JSON.stringify(b)],
      }));
  },
  attach: async (parents, load) => {
    const bids = await load('select data from bids order by auction_id, sequence');
    const byAuction = new Map<string, Entity[]>();
    for (const b of bids) (byAuction.get(b.auctionId) ?? byAuction.set(b.auctionId, []).get(b.auctionId)!).push(b);
    for (const a of parents) a.bids = byAuction.get(a.id) ?? [];
  },
};

export const TABLES: TableSpec[] = [
  { key: 'branches', table: 'branches', columns: { name: (e) => e.name } },
  {
    key: 'users', table: 'users',
    columns: {
      name: (e) => e.name, roles: (e) => pgArray(e.roles), all_branches: (e) => e.branchIds === 'ALL',
      branch_ids: (e) => pgArray(e.branchIds === 'ALL' ? [] : e.branchIds), customer_id: (e) => n(e.customerId), status: (e) => e.status ?? 'ACTIVE',
    },
  },
  {
    key: 'customers', table: 'customers',
    columns: { name: (e) => e.name, phone: (e) => e.phone, email: (e) => n(e.email), branch_id: (e) => e.branchId, kyc_status: (e) => e.kycStatus, membership_status: (e) => e.membershipStatus, lead_id: (e) => n(e.leadId) },
  },
  { key: 'leads', table: 'leads', columns: { name: (e) => e.name, phone: (e) => e.phone, branch_id: (e) => e.branchId, status: (e) => e.status, customer_id: (e) => n(e.customerId) } },
  { key: 'followUps', table: 'follow_ups', columns: { lead_id: (e) => e.leadId, branch_id: (e) => e.branchId, status: (e) => e.status, due_at: (e) => e.dueAt } },
  { key: 'kycCases', table: 'kyc_cases', columns: { customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, status: (e) => e.status } },
  { key: 'applications', table: 'applications', columns: { customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, status: (e) => e.status } },
  { key: 'activities', table: 'activities', appendOnly: true, columns: { entity_type: (e) => e.entityType, entity_id: (e) => e.entityId, type: (e) => e.type, actor_id: (e) => e.actorId, at: (e) => e.at } },
  { key: 'audit', table: 'audit_log', appendOnly: true, columns: { at: (e) => e.at, actor_id: (e) => e.actorId, action: (e) => e.action, entity_type: (e) => e.entityType, entity_id: (e) => e.entityId } },
  { key: 'schemes', table: 'schemes', columns: { code: (e) => e.code } },
  { key: 'schemeVersions', table: 'scheme_versions', columns: { scheme_id: (e) => e.schemeId, version_no: (e) => e.version, status: (e) => e.status, revision: (e) => e.revision } },
  {
    key: 'groups', table: 'chit_groups',
    columns: { code: (e) => e.code, scheme_id: (e) => e.schemeId, scheme_version_id: (e) => e.schemeVersionId, branch_id: (e) => e.branchId, status: (e) => e.status },
  },
  {
    key: 'approvals', table: 'approvals',
    columns: { entity_type: (e) => e.entityType, entity_id: (e) => e.entityId, maker_id: (e) => e.makerId, checker_id: (e) => n(e.checkerId), status: (e) => e.status, branch_id: (e) => n(e.branchId), submitted_revision: (e) => e.submittedRevision },
  },
  {
    key: 'instalments', table: 'instalments',
    columns: { group_id: (e) => e.groupId, customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, ticket_no: (e) => e.ticketNo, instalment_no: (e) => e.seq, due_date: (e) => e.dueDate, amount_paise: (e) => e.amountPaise, paid_paise: (e) => e.paidPaise },
  },
  {
    key: 'payments', table: 'payments',
    columns: {
      customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, mode: (e) => e.mode, amount_paise: (e) => e.amountPaise, reference: (e) => n(e.reference),
      received_date: (e) => e.receivedDate, status: (e) => e.status, simulated: (e) => e.simulated, client_request_id: (e) => n(e.clientRequestId), recorded_by: (e) => e.recordedBy,
      reconciliation_status: (e) => e.reconciliationStatus, receipt_id: (e) => e.receiptId, journal_id: (e) => n(e.journalId),
    },
  },
  { key: 'allocations', table: 'allocations', columns: { payment_id: (e) => e.paymentId, instalment_id: (e) => e.instalmentId, amount_paise: (e) => e.amountPaise, status: (e) => e.status } },
  { key: 'receipts', table: 'receipts', columns: { payment_id: (e) => e.paymentId, customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, status: (e) => e.status } },
  {
    key: 'attempts', table: 'payment_attempts',
    columns: { customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, status: (e) => e.status, amount_paise: (e) => e.amountPaise, provider_ref: (e) => e.providerRef, payment_id: (e) => n(e.paymentId) },
  },
  { key: 'bankLines', table: 'bank_lines', columns: { line_date: (e) => e.date, amount_paise: (e) => e.amountPaise, reference: (e) => e.reference, direction: (e) => e.direction ?? 'CREDIT', status: (e) => e.status } },
  { key: 'reconResults', table: 'recon_results', columns: { payment_id: (e) => e.paymentId, bank_line_id: (e) => e.bankLineId, result: (e) => e.result, difference_paise: (e) => e.differencePaise } },
  { key: 'accounts', table: 'accounts', columns: { code: (e) => e.code, name: (e) => e.name, type: (e) => e.type, active: (e) => e.active } },
  { key: 'periods', table: 'accounting_periods', columns: { name: (e) => e.name, start_date: (e) => e.startDate, end_date: (e) => e.endDate, status: (e) => e.status } },
  {
    key: 'journals', table: 'journals', child: journalLines,
    columns: {
      number: (e) => e.number, journal_date: (e) => e.date, period_id: (e) => e.periodId, status: (e) => e.status, memo: (e) => e.memo, simulated: (e) => e.simulated,
      source_type: (e) => e.source.type, source_id: (e) => n(e.source.id), reversal_of: (e) => n(e.reversalOf), reversed_by: (e) => n(e.reversedBy), revision: (e) => e.revision,
      created_by: (e) => e.createdBy, posted_at: (e) => n(e.postedAt),
    },
  },
  {
    key: 'auctions', table: 'auctions', child: auctionBids,
    columns: { group_id: (e) => e.groupId, branch_id: (e) => e.branchId, cycle_no: (e) => e.cycleNo, status: (e) => e.status, scheduled_open_at: (e) => e.scheduledOpenAt, scheduled_close_at: (e) => e.scheduledCloseAt, revision: (e) => e.revision },
  },
  {
    key: 'payouts', table: 'payouts',
    columns: {
      auction_id: (e) => e.auctionId, group_id: (e) => e.groupId, customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, status: (e) => e.status, amount_paise: (e) => e.amountPaise,
      disbursement_reference: (e) => n(e.disbursement?.reference), reconciliation_status: (e) => e.reconciliationStatus, created_by: (e) => e.createdBy, client_request_id: (e) => n(e.clientRequestId),
    },
  },
  { key: 'supportCases', table: 'support_cases', columns: { customer_id: (e) => e.customerId, branch_id: (e) => e.branchId, category: (e) => e.category, status: (e) => e.status, client_request_id: (e) => n(e.clientRequestId) } },
];

export const collectionOf = (s: Store, key: TableSpec['key']): Entity[] => s[key] as unknown as Entity[];

/** Rows are loaded in this order so related data is available; the database itself does not require it (FKs are deferred). */
export const CONFIG_KEYS = ['settings', 'postingRules'] as const;
