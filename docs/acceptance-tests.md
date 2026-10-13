# Acceptance tests

## 1. Required business scenarios and where they are tested

Automated tests run with `npm test` in `backend/` (API, permissions, state machines, persistence) and in `frontend/`
(screens and behaviour). "Tested" means an automated test exists **and was run and passed** at the time of writing
(see the main README for the latest counts).

| # | Scenario | Status | Where |
|---|---|---|---|
| 1 | Create a lead and convert it to a customer | Tested | `crm.test.ts` "converts a lead into a customer..." |
| 2 | Submit and manually verify KYC documents | Tested | `crm.test.ts` "KYC" suite |
| 3 | Create a scheme and submit it for approval | Tested | `chit.test.ts` "scheme versioning and approval" |
| 4 | Create a group and enrol members | Tested | `chit.test.ts` "groups" |
| 5 | Prevent activation when conditions are unmet | Tested | `chit.test.ts` "prevents activation until every condition is met..." |
| 6 | Generate instalment dues | Tested | `finance.test.ts` "instalment schedules" |
| 7 | Record an online and an offline collection | Tested (online is **simulated**) | `finance.test.ts` "offline collections", "online payments (simulated gateway)" |
| 8 | Prevent duplicate payment posting | Tested | `finance.test.ts` (idempotent request, duplicate reference, replayed callbacks) |
| 9 | Conduct an auction using the configured rules | Tested (member bids; rules chosen per auction) | `auction.test.ts` |
| 10 | Calculate the result using **verified financial formulas** | **NOT MET** | Winner selection is tested; dividend, commission and prize **formulas are not implemented** because none has been approved. Payout amounts are entered manually with maker-checker. |
| 11 | Require independent approval for a payout | Tested | `auction.test.ts` "prize payout workflow" |
| 12 | Post balanced accounting entries | Tested (application and database level) | `finance.test.ts` "double-entry accounting", `schema.test.ts` |
| 13 | Reconcile a payment or payout | Tested | `finance.test.ts` "reconciliation", `auction.test.ts` |
| 14 | Reject an unauthorised cross-branch access attempt | Tested | `crm.test.ts` "branch scoping", `auth.test.ts` "enforces permissions and branch scope for real sessions" |
| 15 | A user cannot approve their own submission | Tested | `chit.test.ts`, `finance.test.ts`, `auction.test.ts`, `auth.test.ts` (real accounts) |
| 16 | History is preserved after a reversal or correction | Tested | `finance.test.ts` "payment reversal", `persistence.test.ts` |

Production-readiness scenarios (Phase 7):

| Scenario | Status | Where |
|---|---|---|
| A full business cycle survives a restart, with identical state | Tested | `persistence.test.ts` "survives a restart..." |
| A failed or refused save leaves no trace and the service continues | Tested | `persistence.test.ts` "failure handling" |
| Parallel requests do not lose updates or duplicate ids | Tested | `persistence.test.ts` "serialises parallel requests" |
| Database refuses unbalanced/edited journals, edited audit, overpaid instalments | Tested on a real PostgreSQL engine | `schema.test.ts` |
| Backup restores into an identical, working system | Tested (embedded engine) | `persistence.test.ts` "backup and restore" |
| Real `pg` driver, migrations, bootstrap and CLI tools | Tested; live-run against a running server | `operations.test.ts` and the live run described in the README |
| Sign-in, MFA, lockout, sessions, CSRF, CORS, rate limit | Tested | `auth.test.ts` |
| Unsafe production configuration is refused | Tested | `auth.test.ts` "configuration" |

## 2. Must be repeated on your real infrastructure before the pilot
These were verified on an embedded PostgreSQL engine, not a separately installed server:

- [ ] Run `node dist/cli/migrate.js` on the real database; confirm "up to date" on a second run.
- [ ] Run the restore drill in `backup-recovery.md` with a real `pg_dump`/`pg_restore` or point-in-time recovery.
- [ ] Kill the backend process during traffic; restart; confirm no acknowledged change is missing.
- [ ] Confirm a second backend instance refuses to start (writer lock).
- [ ] Confirm HTTPS-only access, secure cookie flags and that the database is not publicly reachable.

## 3. User acceptance (to be executed by the business)
Walk each role through its screens with realistic data, recording pass/fail:

- [ ] Branch staff: lead -> customer -> KYC -> membership application.
- [ ] Operations: scheme draft -> approval -> publish; group -> enrolment -> activation.
- [ ] Collection officer: offline collections, receipts, arrears follow-up.
- [ ] Finance: reconciliation, manual journal with a different approver, payment reversal, period close, trial balance
      agreeing with the accountant's own figures.
- [ ] Auction officer and a few real members (simulated payments and bids only): schedule, bid, close, validate,
      approve, dispute.
- [ ] Finance: payout with manual amount, independent approval, recorded disbursement, reconciliation.
- [ ] Members: dues, payment history, statement, support request, payout tracking on a phone.
- [ ] Accountant: chart of accounts, posting rules and statement formats signed off in writing.

## 4. Performance
- **Measured** (embedded engine, no network latency): see the table in `persistence.md`. 40,000 instalment rows: write
  median 29 ms, read median 3 ms, cold start 0.3 s, 90 MB.
- **Not measured**: concurrent users over a network, a real PostgreSQL server, or datasets beyond 40,000 instalment rows.
  Plan: load the pilot's expected volume (members x months x 2), then run a month-end collection burst and the auction
  bidding window (many members bidding within minutes) and record the 95th-percentile response time. Agree the targets
  with the business first.

## 5. Pilot exit criteria (suggested; confirm with the business)
- Zero unexplained differences between the application's trial balance and the accountant's records over a full cycle.
- Every payment, reversal and payout traceable from the receipt to the journal to the audit trail.
- No acknowledged transaction lost across at least one deliberate restart and one restore drill.
- Penetration-test findings closed; open items in `security.md` accepted in writing.
- The unresolved business decisions in the main README are resolved (formulas, auction model, payout channels).
