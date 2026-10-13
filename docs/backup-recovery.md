# Backup and recovery

## What must be backed up
1. **The PostgreSQL database** (all business data, audit trail, accounts, sessions).
2. **`AUTH_ENCRYPTION_KEY`**, stored separately from the database backups (for example in a secrets vault). Without
   it, enrolled authenticator seeds cannot be read: users would need an administrator to reset their MFA. It does not
   protect business data.
3. The pilot configuration file you loaded and the build you deployed (to rebuild the same version).

Back up the key **separately** from database dumps: a dump plus the key together would expose MFA seeds.

## Recommended approach (decide RPO and RTO)
The business must set the acceptable data loss (RPO) and downtime (RTO). Typical choices for a money-handling system:

- **Continuous archiving (WAL) with point-in-time recovery** so a mistake or fault can be undone to the minute. Most
  managed PostgreSQL services provide this.
- **A nightly logical dump** (`pg_dump --format=custom`) kept off the database host, for example for 35 days, plus
  month-end copies for the financial-record retention period set by your accountant and counsel **(decide)**.
- **Encryption** of backups at rest and **access control** on who can read them.

## Restore drill (do this before the pilot, then quarterly)
1. Provision a clean PostgreSQL instance.
2. Restore the latest backup (`pg_restore`, or point-in-time recovery to a chosen time).
3. Set `DATABASE_URL` to the restored database and the same `AUTH_ENCRYPTION_KEY`. Run `node dist/cli/migrate.js`
   (it should report the schema is up to date).
4. Start the backend. `GET /api/v1/ready` must report ready.
5. Verify, with an administrator or auditor account:
   - **Accounting > Trial balance** shows *Debits equal credits*.
   - Row counts for customers, payments, journals and audit entries match the source at backup time.
   - The most recent approval, payment and audit entry you expect are present.
   - A new transaction can be posted and the audit trail records it.
6. Record how long steps 1-5 took: that is your measured RTO.

## What was verified here
- A **physical backup** of the embedded PostgreSQL engine's data was restored into a second, independent engine; the
  application loaded an identical state from it, accepted a new payment, kept the trial balance balanced, and the
  database's integrity guards still refused tampering (`persistence.test.ts`, "backup and restore").
- A running system was **hard-killed** (database and server) and restarted from its files: the signed-in session, the
  newly created user and the audit trail were all intact.

**Not verified here:** `pg_dump`/`pg_restore`, WAL archiving and point-in-time recovery on a real PostgreSQL server
(none was available). Run the drill above on your real database; do not treat the checks above as a substitute.

## If the backend reports `SERVICE_UNHEALTHY` or `/ready` fails
The process could not guarantee its in-memory state matches the database. Restart it: it reloads the last committed
state. No data is lost, because nothing is acknowledged before it is committed.

## If the encryption key is lost
Staff cannot complete MFA sign-in. An administrator runs **Reset MFA** for each user (or, if no administrator can sign
in, the first-administrator tool is not reusable by design: restore the key from its backup). Business data is not
affected.
