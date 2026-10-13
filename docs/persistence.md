# Persistence design

## What is stored where

| Concern | Where | Notes |
|---|---|---|
| Business records (customers, schemes, groups, instalments, payments, journals, auctions, payouts, support, audit) | PostgreSQL tables, one per entity type | Source of truth |
| Money | `bigint` paise | Never floating point |
| Sign-in credentials, MFA, sessions | `user_credentials`, `sessions`, `login_challenges` | Hashes and ciphertext only |
| Configuration the business owns (posting rules, grace days) | `app_config` | Loaded at start-up |
| Id counters (`LD-0001`, `PAY-0001`, ...) | `counters` | Restored at start-up so ids never repeat |

Each business table has: `seq` (insertion order), `id`, a few **promoted columns** (keys, foreign keys, status, amounts)
and `data` (the full entity as JSON). The application derives the promoted columns from the entity in **one place**
(`backend/src/persistence/tables.ts`), so the database constraints cannot drift from the application's data.

## How a request is saved

1. Requests are processed **one at a time** (a first-in-first-out gate). Reads never see a half-applied change.
2. The service changes the in-memory working state.
3. **Before the response is sent**, exactly what changed is written to PostgreSQL in **one transaction**
   (business rows, id counters, configuration, credentials/sessions and audit entries together).
4. If the request failed, or the database refused the commit, memory is put back to the last committed state and the
   client receives a clear error (`409 INTEGRITY_VIOLATION` or `500 PERSISTENCE_ERROR`). Nothing is half-saved.
5. If memory itself cannot be restored the process marks itself unhealthy: it answers `503` and `/ready` fails until
   it is restarted (which reloads the committed state).

A client therefore never receives a success response for a change that is not durable.

## What the database enforces independently

These hold even if application code has a bug (tested in `backend/src/tests/schema.test.ts` against a real
PostgreSQL engine):

- A **posted journal** must have at least two lines with equal, non-zero debits and credits, checked at commit.
- A posted journal and its lines **cannot be edited or deleted**. The only change allowed is `POSTED -> REVERSED`
  with the reversing journal recorded.
- `audit_log`, `activities` and `bids` are **append-only** (no update, delete or truncate).
- An instalment can never be paid beyond its amount or below zero.
- One live payment per non-cash reference and mode; one payout per auction; one live auction per group cycle;
  unique disbursement references; unique scheme/group/account codes and journal numbers.
- A request's maker and checker can never be the same person (`approvals` check constraint).
- Foreign keys (validated at commit) keep records connected.

## Supported deployment, and its limits

The services work on the in-memory state, so the design assumes:

- **One backend process writes at a time.** It takes a PostgreSQL advisory lock at start-up and refuses to start if
  another process holds it. Run one instance (with a restart policy), not several.
- **The data fits in memory.** Measured on the embedded engine (CPU and memory costs only; add your network latency to
  the database):

  | Instalment rows | Cold start load | Write request (p50 / p95) | Read (p50) | Heap |
  |---:|---:|---:|---:|---:|
  | 400 | 17 ms | 6 / 7 ms | 2 ms | 53 MB |
  | 8,000 | 65 ms | 10 / 14 ms | 2 ms | 79 MB |
  | 40,000 | 271 ms | 29 / 40 ms | 3 ms | 90 MB |

  A write costs roughly in proportion to the total number of rows (the changed rows are found by comparing state), so
  watch write latency as data grows. Roughly 40,000 instalment rows corresponds to about 1,000 members on a 40-month
  scheme.
- **Rate limiting and the request gate are per process**, which is correct for one process.

### Scale-out path (not built)
To serve several instances or very large data, replace the working-state approach with per-request SQL repositories and
row-level locking (`SELECT ... FOR UPDATE`) and move rate limiting to a shared store. The schema, constraints, migrations,
authentication and API contracts stay the same; only `services/*` and `persistence/*` change. This is a deliberate later
step, not part of the pilot.

## Migrations
Plain SQL files in `backend/migrations`, applied in order, each in its own transaction, recorded with a checksum in
`schema_migrations`. Editing an applied migration is refused; add a new file instead. The server refuses to start while
migrations are pending. There are no automatic down-migrations: take a backup before every upgrade
(see `backup-recovery.md`).

## What was verified here
Everything above is tested against a **real PostgreSQL 18 engine** (PGlite, WebAssembly) and the real `pg` driver over
the wire protocol. It has **not** been run against a separately installed PostgreSQL server. Before the pilot, repeat
the checks in `acceptance-tests.md` on your actual database.
