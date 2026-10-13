# Security

## Controls implemented

**Accounts and sign-in**
- Self-managed accounts. Passwords are hashed with **scrypt** (N=32768, r=8, p=1, per-user random salt; the cost is stored
  in each hash so it can be raised later). Minimum 12 characters, a common-password blocklist, no username/name inside.
- **Second factor for every staff account**: authenticator app (TOTP, RFC 6238 test vectors pass), single-use recovery
  codes, replay protection (a code works once), seeds **encrypted at rest** (AES-256-GCM, key held outside the database).
- **Lockout** after 5 failed passwords (15 minutes), challenge dies after 5 wrong codes, per-IP rate limit on sign-in,
  activation and password change. Wrong password and unknown account give the **same message and the same work factor**.
- New accounts and resets use **one-time activation codes** (hashed in the database, 72-hour expiry, single use). No one,
  including administrators, ever sees or sets another person's password.
- Members sign in with a password only until an OTP provider is chosen (**gap**, see below).

**Sessions**
- Server-side sessions; the browser holds only a random token in an **HttpOnly, SameSite=Lax, Secure** cookie
  (`__Host-` prefixed in production). Only a SHA-256 of the token is stored.
- 30-minute idle timeout, 12-hour absolute limit, immediate revocation on sign-out, password change (other devices),
  account disable, role change and MFA reset.
- **CSRF** protection: state-changing cookie requests must carry the session's CSRF token and come from an allowed origin.
  A bearer token (for a future mobile app) is also accepted and is not CSRF-exposed.

**Authorisation**
- Every request is authorised **on the server**: permission, then branch scope, then workflow rules (maker-checker,
  state machines). Hiding buttons is only a convenience.
- **Separation of duties** when creating accounts: finance maker + checker, chit operations + operations head, auction
  officer + operations head, and administrator + any finance/approval role cannot be combined. Administrators cannot change
  or disable their own accounts. Every transaction also blocks self-approval regardless of roles.
- Members can only reach their own records; another member's record answers exactly like a missing one.

**Data and platform**
- Money as integer paise; database-level guards for balanced/immutable journals, append-only audit and bid logs, unique
  references (see `persistence.md`).
- **Audit trail** of sensitive actions including sign-ins, failures, lockouts, MFA events and user administration. It
  never records passwords, codes or tokens (tested).
- Security headers on every response (`nosniff`, frame denial, CSP `default-src 'none'`, `no-store` caching, HSTS in
  production). CORS allows only the configured https origins and advertises the CSRF header, not the development header.
- **Production start-up refuses** unsafe settings (simulated sign-in, wildcard or non-https CORS, missing database or key,
  insecure cookies).
- Dependency audit (`npm audit`): **0 known vulnerabilities** in both applications at the time of writing. Repeat it on
  every release.

## Tests
Run `npm test` in `backend/`. Security-relevant suites: `auth.test.ts` (sign-in, MFA, lockout, sessions, CSRF, CORS,
rate limit, secrets-at-rest, role separation, member isolation), `schema.test.ts` (database guards), `crm.test.ts`,
`chit.test.ts`, `finance.test.ts`, `auction.test.ts`, `portal.test.ts` (permissions, branch scope, maker-checker).

## Known gaps before real money and real members
These are open, not hidden:

1. **No independent penetration test** has been done. Commission one before go-live.
2. **Rate limiting is in process memory** (correct for the supported single instance; not shared across instances).
3. **Members have no second factor.** Add SMS/WhatsApp OTP once a provider is chosen; the account model supports it.
4. **No notifications** (new device sign-in, password change alerts, payment receipts) until providers are chosen.
5. **Documents (KYC) are not stored**: no file storage was chosen. When added, it needs encryption, access control and
   malware scanning.
6. **Secrets management**: the encryption key and database password are plain environment variables. Use your platform's
   secret store, restrict who can read them, and rotate on staff changes.
7. **Key rotation** for `AUTH_ENCRYPTION_KEY` is not automated (a re-encryption tool would be needed).
8. **Network controls** (firewall, database not publicly reachable, WAF, DDoS protection) are the hosting provider's
   responsibility **(decide)**.
9. **Legal and regulatory review**: Tamil Nadu chit-fund requirements, financial record retention and personal data
   protection obligations must be reviewed by counsel; none is asserted here.
10. **Auction operating model and payout rules** still depend on business approval (see the main README).

## Go-live checklist
- [ ] HTTPS everywhere; database not reachable from the internet; database TLS on.
- [ ] `NODE_ENV=production`; start-up passes its configuration checks.
- [ ] First administrator created with a long unique passphrase and MFA enrolled; recovery codes stored in a safe.
- [ ] Chart of accounts and posting rules approved in writing by the accountant and loaded via the pilot tool.
- [ ] Backups running; **restore drill completed** and timed (`backup-recovery.md`).
- [ ] `AUTH_ENCRYPTION_KEY` backed up separately from database backups.
- [ ] Monitoring and alerts on `/ready`, error logs and disk space.
- [ ] Staff trained: never share codes; lost device means ask an administrator to reset MFA.
- [ ] Penetration test findings fixed; `npm audit` clean.
- [ ] Counsel has reviewed regulatory and data-protection obligations.
