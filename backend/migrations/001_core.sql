-- Core schema for the Chit Fund CRM.
--
-- Design notes
--  * Every business table has: seq (insertion order), id (application id), a few promoted columns that carry
--    keys, foreign keys, uniqueness and CHECK constraints, and `data` (the complete entity as JSON, the source
--    the application loads from). The application derives promoted columns from `data` in one place
--    (src/persistence/tables.ts) so they cannot drift.
--  * The database is a SECOND line of defence behind the application's rules: balanced and immutable posted
--    journals, append-only audit/bid/activity logs, unique references, non-negative balances.
--  * Money is integer paise (bigint). Never floating point.
--  * Foreign keys are DEFERRABLE INITIALLY DEFERRED so a request can write related rows in any order and the
--    whole set is validated at COMMIT.

-- ---------------------------------------------------------------- reference data
create table branches (
  seq bigserial not null unique,
  id text primary key,
  name text not null unique,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  seq bigserial not null unique,
  id text primary key,
  name text not null,
  roles text[] not null,
  all_branches boolean not null,
  branch_ids text[] not null default '{}',
  customer_id text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_customer_unique on users (customer_id) where customer_id is not null;

-- ---------------------------------------------------------------- CRM
create table customers (
  seq bigserial not null unique,
  id text primary key,
  name text not null,
  phone text not null,
  email text,
  branch_id text not null references branches (id) deferrable initially deferred,
  kyc_status text not null check (kyc_status in ('NOT_STARTED','DOCUMENTS_PENDING','UNDER_REVIEW','CORRECTION_REQUIRED','VERIFIED','REJECTED')),
  membership_status text not null check (membership_status in ('NONE','ENROLMENT_PENDING','ACTIVE')),
  lead_id text,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_branch on customers (branch_id);
create index customers_phone on customers (phone);

create table leads (
  seq bigserial not null unique,
  id text primary key,
  name text not null,
  phone text not null,
  branch_id text not null references branches (id) deferrable initially deferred,
  status text not null check (status in ('NEW','CONTACTED','INTERESTED','REGISTRATION_PENDING','CONVERTED','LOST')),
  customer_id text,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_branch_status on leads (branch_id, status);

create table follow_ups (
  seq bigserial not null unique,
  id text primary key,
  lead_id text not null references leads (id) deferrable initially deferred,
  branch_id text not null,
  status text not null check (status in ('OPEN','DONE')),
  due_at timestamptz not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table kyc_cases (
  seq bigserial not null unique,
  id text primary key,
  customer_id text not null unique references customers (id) deferrable initially deferred,
  branch_id text not null,
  status text not null check (status in ('NOT_STARTED','DOCUMENTS_PENDING','UNDER_REVIEW','CORRECTION_REQUIRED','VERIFIED','REJECTED')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table applications (
  seq bigserial not null unique,
  id text primary key,
  customer_id text not null references customers (id) deferrable initially deferred,
  branch_id text not null,
  status text not null check (status in ('SUBMITTED','APPROVED','REJECTED')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index applications_one_open on applications (customer_id) where status = 'SUBMITTED';

-- ---------------------------------------------------------------- append-only logs
create table activities (
  seq bigserial not null unique,
  id text primary key,
  entity_type text not null,
  entity_id text not null,
  type text not null,
  actor_id text not null,
  at timestamptz not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activities_entity on activities (entity_type, entity_id);

create table audit_log (
  seq bigserial not null unique,
  id text primary key,
  at timestamptz not null,
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_at on audit_log (at);
create index audit_log_entity on audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------- schemes, groups, approvals
create table schemes (
  seq bigserial not null unique,
  id text primary key,
  code text not null unique,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table scheme_versions (
  seq bigserial not null unique,
  id text primary key,
  scheme_id text not null references schemes (id) deferrable initially deferred,
  version_no integer not null,
  status text not null check (status in ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','PUBLISHED','RETIRED','REJECTED')),
  revision integer not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scheme_id, version_no)
);

create table chit_groups (
  seq bigserial not null unique,
  id text primary key,
  code text not null unique,
  scheme_id text not null references schemes (id) deferrable initially deferred,
  scheme_version_id text not null references scheme_versions (id) deferrable initially deferred,
  branch_id text not null references branches (id) deferrable initially deferred,
  status text not null check (status in ('DRAFT','APPROVAL_PENDING','ENROLMENT_OPEN','READY_TO_START','ACTIVE','SUSPENDED','COMPLETED','CLOSED')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table approvals (
  seq bigserial not null unique,
  id text primary key,
  entity_type text not null check (entity_type in ('SCHEME_VERSION','GROUP_OPEN','GROUP_ACTIVATION','JOURNAL','JOURNAL_REVERSAL','PAYMENT_REVERSAL','AUCTION_RESULT','PAYOUT')),
  entity_id text not null,
  maker_id text not null,
  checker_id text,
  status text not null check (status in ('PENDING','IN_REVIEW','APPROVED','RETURNED','REJECTED','CANCELLED')),
  branch_id text,
  submitted_revision integer not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the person who made a request can never be the person who decided it
  check (checker_id is null or checker_id <> maker_id)
);
create index approvals_entity on approvals (entity_type, entity_id, status);

-- ---------------------------------------------------------------- collections
create table instalments (
  seq bigserial not null unique,
  id text primary key,
  group_id text not null references chit_groups (id) deferrable initially deferred,
  customer_id text not null references customers (id) deferrable initially deferred,
  branch_id text not null,
  ticket_no integer not null,
  instalment_no integer not null,
  due_date date not null,
  amount_paise bigint not null check (amount_paise > 0),
  paid_paise bigint not null default 0,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, ticket_no, instalment_no),
  check (paid_paise >= 0 and paid_paise <= amount_paise)
);
create index instalments_customer on instalments (customer_id);
create index instalments_due on instalments (due_date);

create table payments (
  seq bigserial not null unique,
  id text primary key,
  customer_id text not null references customers (id) deferrable initially deferred,
  branch_id text not null,
  mode text not null check (mode in ('CASH','CHEQUE','UPI','BANK_TRANSFER','ONLINE_SIMULATED')),
  amount_paise bigint not null check (amount_paise > 0),
  reference text,
  received_date date not null,
  status text not null check (status in ('SUCCESSFUL','REVERSED')),
  simulated boolean not null,
  client_request_id text,
  recorded_by text not null,
  reconciliation_status text not null check (reconciliation_status in ('PENDING','MATCHED','EXCEPTION','NOT_APPLICABLE')),
  receipt_id text not null,
  journal_id text,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_customer on payments (customer_id);
-- one live payment per non-cash reference and mode (a reversed payment frees its reference)
create unique index payments_reference_unique on payments (mode, lower(reference))
  where status = 'SUCCESSFUL' and reference is not null and simulated = false;
create unique index payments_request_unique on payments (recorded_by, client_request_id) where client_request_id is not null;

create table allocations (
  seq bigserial not null unique,
  id text primary key,
  payment_id text not null references payments (id) deferrable initially deferred,
  instalment_id text not null references instalments (id) deferrable initially deferred,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null check (status in ('ACTIVE','REVERSED')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index allocations_payment on allocations (payment_id);
create index allocations_instalment on allocations (instalment_id);

create table receipts (
  seq bigserial not null unique,
  id text primary key,
  payment_id text not null unique references payments (id) deferrable initially deferred,
  customer_id text not null,
  branch_id text not null,
  status text not null check (status in ('ISSUED','VOID')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table payment_attempts (
  seq bigserial not null unique,
  id text primary key,
  customer_id text not null references customers (id) deferrable initially deferred,
  branch_id text not null,
  status text not null check (status in ('INITIATED','PENDING_CONFIRMATION','SUCCESSFUL','FAILED','CANCELLED')),
  amount_paise bigint not null check (amount_paise > 0),
  provider_ref text not null unique,
  payment_id text,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table bank_lines (
  seq bigserial not null unique,
  id text primary key,
  line_date date not null,
  amount_paise bigint not null check (amount_paise > 0),
  reference text not null,
  direction text not null check (direction in ('CREDIT','DEBIT')),
  status text not null check (status in ('UNMATCHED','MATCHED')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bank_lines_unique on bank_lines (lower(reference), amount_paise, line_date, direction);

create table recon_results (
  seq bigserial not null unique,
  id text primary key,
  payment_id text not null,
  bank_line_id text not null unique references bank_lines (id) deferrable initially deferred,
  result text not null check (result in ('MATCHED','EXCEPTION')),
  difference_paise bigint not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- accounting
create table accounts (
  seq bigserial not null unique,
  id text primary key,
  code text not null unique,
  name text not null,
  type text not null check (type in ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  active boolean not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table accounting_periods (
  seq bigserial not null unique,
  id text primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('OPEN','CLOSED')),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table journals (
  seq bigserial not null unique,
  id text primary key,
  number text not null unique,
  journal_date date not null,
  period_id text not null references accounting_periods (id) deferrable initially deferred,
  status text not null check (status in ('DRAFT','SUBMITTED','APPROVED','POSTED','REVERSED')),
  memo text not null,
  simulated boolean not null,
  source_type text not null check (source_type in ('MANUAL','PAYMENT','PAYMENT_REVERSAL','JOURNAL_REVERSAL','PAYOUT')),
  source_id text,
  reversal_of text,
  reversed_by text,
  revision integer not null,
  created_by text not null,
  posted_at timestamptz,
  -- transaction that created the row; lets the guard allow writing lines only in that transaction
  tx_id bigint not null default txid_current(),
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index journals_date on journals (journal_date);

create table journal_lines (
  journal_id text not null references journals (id) deferrable initially deferred,
  line_no integer not null,
  account_id text not null references accounts (id) deferrable initially deferred,
  debit_paise bigint not null default 0 check (debit_paise >= 0),
  credit_paise bigint not null default 0 check (credit_paise >= 0),
  memo text,
  primary key (journal_id, line_no),
  -- exactly one side per line
  check ((debit_paise > 0) <> (credit_paise > 0))
);
create index journal_lines_account on journal_lines (account_id);

-- ---------------------------------------------------------------- auctions and payouts
create table auctions (
  seq bigserial not null unique,
  id text primary key,
  group_id text not null references chit_groups (id) deferrable initially deferred,
  branch_id text not null,
  cycle_no integer not null,
  status text not null check (status in ('SCHEDULED','READY','OPEN','CLOSED','VALIDATION','APPROVAL_PENDING','APPROVED','SETTLED','CANCELLED')),
  scheduled_open_at timestamptz not null,
  scheduled_close_at timestamptz not null,
  revision integer not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_close_at > scheduled_open_at)
);
create unique index auctions_live_cycle on auctions (group_id, cycle_no) where status <> 'CANCELLED';

create table bids (
  seq bigserial not null unique,
  id text primary key,
  auction_id text not null references auctions (id) deferrable initially deferred,
  ticket_no integer not null,
  customer_id text not null,
  amount_paise bigint not null check (amount_paise > 0),
  submitted_by text not null,
  server_timestamp timestamptz not null,
  sequence integer not null,
  client_request_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (auction_id, sequence),
  unique (auction_id, submitted_by, client_request_id)
);

create table payouts (
  seq bigserial not null unique,
  id text primary key,
  auction_id text not null unique references auctions (id) deferrable initially deferred,
  group_id text not null,
  customer_id text not null references customers (id) deferrable initially deferred,
  branch_id text not null,
  status text not null check (status in ('DRAFT','ELIGIBILITY_REVIEW','PENDING_APPROVAL','APPROVED','DISBURSEMENT_PENDING','PAID','ON_HOLD','FAILED')),
  amount_paise bigint not null check (amount_paise > 0),
  disbursement_reference text,
  reconciliation_status text not null check (reconciliation_status in ('PENDING','MATCHED','EXCEPTION')),
  created_by text not null,
  client_request_id text,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payouts_reference_unique on payouts (lower(disbursement_reference)) where disbursement_reference is not null;
create unique index payouts_request_unique on payouts (created_by, client_request_id) where client_request_id is not null;

-- ---------------------------------------------------------------- support
create table support_cases (
  seq bigserial not null unique,
  id text primary key,
  customer_id text not null references customers (id) deferrable initially deferred,
  branch_id text not null,
  category text not null,
  status text not null check (status in ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  client_request_id text,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index support_request_unique on support_cases (customer_id, client_request_id) where client_request_id is not null;

-- ---------------------------------------------------------------- configuration and counters
create table app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table counters (
  prefix text primary key,
  value bigint not null check (value >= 0)
);

-- ================================================================ integrity guards
-- Append-only logs: rows can be inserted, never changed or removed.
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: the table is append-only', tg_op, tg_table_name using errcode = '23001';
end $$;

create trigger audit_log_append_only before update or delete on audit_log for each row execute function forbid_mutation();
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function forbid_mutation();
create trigger activities_append_only before update or delete on activities for each row execute function forbid_mutation();
create trigger bids_append_only before update or delete on bids for each row execute function forbid_mutation();
create trigger bids_no_truncate before truncate on bids for each statement execute function forbid_mutation();

-- Posted journals are immutable. The only permitted change is POSTED -> REVERSED (with reversed_by set).
create function journals_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'journals cannot be deleted; correct them by reversal' using errcode = '23001';
  end if;
  if old.status in ('POSTED', 'REVERSED') then
    if new.number <> old.number or new.journal_date <> old.journal_date or new.period_id <> old.period_id
       or new.memo <> old.memo or new.source_type <> old.source_type or new.source_id is distinct from old.source_id
       or new.simulated <> old.simulated or new.created_by <> old.created_by or new.posted_at is distinct from old.posted_at
       or new.reversal_of is distinct from old.reversal_of or new.data -> 'lines' is distinct from old.data -> 'lines' then
      raise exception 'journal % is posted and cannot be modified', old.number using errcode = '23001';
    end if;
    if old.status = 'REVERSED' and (new.status <> 'REVERSED' or new.reversed_by is distinct from old.reversed_by or new.data is distinct from old.data) then
      raise exception 'journal % is reversed and cannot be modified', old.number using errcode = '23001';
    end if;
    if old.status = 'POSTED' then
      if new.status = 'REVERSED' then
        if new.reversed_by is null then
          raise exception 'a reversed journal must reference its reversing journal' using errcode = '23001';
        end if;
      elsif new.status <> 'POSTED' or new.data is distinct from old.data or new.reversed_by is distinct from old.reversed_by then
        raise exception 'journal % is posted and cannot be modified', old.number using errcode = '23001';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger journals_immutable before update or delete on journals for each row execute function journals_guard();

-- Lines of a posted journal can neither be changed nor have lines added later.
create function journal_lines_guard() returns trigger language plpgsql as $$
declare
  st text;
  creator bigint;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into st from journals where id = old.journal_id;
    if st in ('POSTED', 'REVERSED') then
      raise exception 'lines of posted journal % cannot be changed', old.journal_id using errcode = '23001';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select status, tx_id into st, creator from journals where id = new.journal_id;
    if st in ('POSTED', 'REVERSED') and creator <> txid_current() then
      raise exception 'lines cannot be added to posted journal %', new.journal_id using errcode = '23001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_lines_immutable before insert or update or delete on journal_lines for each row execute function journal_lines_guard();

-- Double entry: a posted journal must have at least two lines and equal, non-zero debits and credits.
-- Checked at COMMIT (deferred) so lines and header can be written in any order within the transaction.
create function check_journal_balance(jid text) returns void language plpgsql as $$
declare
  st text;
  d bigint;
  c bigint;
  n integer;
begin
  select status into st from journals where id = jid;
  if st in ('POSTED', 'REVERSED') then
    select coalesce(sum(debit_paise), 0), coalesce(sum(credit_paise), 0), count(*) into d, c, n from journal_lines where journal_id = jid;
    if n < 2 or d <> c or d = 0 then
      raise exception 'journal % does not balance (debits %, credits %, lines %)', jid, d, c, n using errcode = '23514';
    end if;
  end if;
end $$;

create function journals_balance_trg() returns trigger language plpgsql as $$
begin
  perform check_journal_balance(new.id);
  return null;
end $$;
create function journal_lines_balance_trg() returns trigger language plpgsql as $$
begin
  perform check_journal_balance(coalesce(new.journal_id, old.journal_id));
  return null;
end $$;
create constraint trigger journals_balanced after insert or update on journals deferrable initially deferred for each row execute function journals_balance_trg();
create constraint trigger journal_lines_balanced after insert or update or delete on journal_lines deferrable initially deferred for each row execute function journal_lines_balance_trg();
