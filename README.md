# Chit Fund CRM & Management Platform

Phases 0–7 are built. Phase 7 (production readiness) is **complete for what can be done without the open provider and
business decisions**; it is **not** a go-live sign-off. See "What still blocks go-live" below.

## Stack
- `frontend/`: React 19, Vite, JavaScript, Tailwind CSS v4, react-router-dom
- `backend/`: Node.js 24, Express 5, TypeScript, PostgreSQL via node-postgres (`pg`) with hand-written SQL migrations
- Decided by the business owner: **PostgreSQL**, **node-postgres + SQL migrations**, **self-managed authentication** (passwords + authenticator-app MFA + server-side sessions)

## Run for development

Quickest (demo data in memory, simulated sign-in, nothing saved):
```
cd backend  && npm install && npm run dev      # http://localhost:4000/api/v1/health
cd frontend && npm install && npm run dev      # http://localhost:5173
```

With a real database and real sign-in, still without installing PostgreSQL (an embedded real engine; development only):
```
cd backend
npm run db:embedded                            # terminal 1: embedded PostgreSQL on 127.0.0.1:54329, files in ./.pgdata
# terminal 2 (set these variables, then):
#   DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres  AUTH_MODE=session  AUTH_ENCRYPTION_KEY=<64 hex chars>
npm run migrate
BOOTSTRAP_ADMIN_NAME="..." BOOTSTRAP_ADMIN_EMAIL="..." BOOTSTRAP_ADMIN_PASSWORD="..." npm run bootstrap-admin
npm run init-pilot -- ../docs/pilot-config.example.json
npm run dev
```
Then open the front end and sign in. Copy `.env.example` to `.env` in each folder (documented there).

Checks: `npm test`, `npm run typecheck`, `npm run build` in `backend/`; `npm test`, `npm run build` in `frontend/`.

## Documentation
- `docs/deploy-render-vercel.md` — step-by-step deployment of the backend on Render and the front end on Vercel
- `docs/deployment.md` — how to deploy, configuration, first-run steps, upgrades, monitoring
- `docs/persistence.md` — how data is saved, what the database enforces, limits and the scale-out path
- `docs/backup-recovery.md` — what to back up, the restore drill, what was and was not verified
- `docs/security.md` — controls, known gaps, go-live checklist
- `docs/acceptance-tests.md` — the 16 required scenarios mapped to tests (one is **not met**), pilot checks, performance
- `docs/portal-api.md` — the member API a future mobile app can reuse
- `docs/pilot-config.example.json` — format of the accountant-approved reference data

## Architecture
- Backend layers: routes → controllers → services → persistence; consistent error envelope `{ error: { code, message, details?, requestId } }`.
- Services work on an in-memory working state; every mutating request is committed to PostgreSQL **in one transaction before the response is sent**, and rolled back in memory if it fails (`docs/persistence.md`). One backend process writes at a time (enforced with an advisory lock).
- The database independently enforces balanced and immutable posted journals, append-only audit and bid logs, unique references and non-negative balances.
- Two sign-in modes chosen by configuration: `session` (real accounts) and `dev` (simulated, **refused in production**).
- Frontend: feature folders, a single `apiClient`, navigation in `src/app/routes.js`, a staff shell and a separate mobile-first member portal.

## Implemented

### Phase 1: foundation
App shell, 12 module routes, reusable UI, loading/empty/error states, health endpoint, error handling. The dashboard still shows **clearly labelled demo numbers**, not live data.

### Phase 2: CRM and onboarding
Leads (state machine, timeline, follow-ups, duplicate warnings, conversion), customers, KYC (versioned document metadata, manual decisions, submitter cannot decide), membership applications with maker-checker, audit log.

### Phase 3: schemes, groups, approvals
Versioned schemes (money as integer paise; dividend/commission rules stored as approved **text** only), groups pinned to a published version, ticket allocation, server-computed activation readiness, generic Approval Centre (maker cannot review/decide/publish own work; decisions bind to the submitted revision).

### Phase 4: collections and accounting
Instalment schedules (status derived from dates and amounts), offline collections (idempotent, duplicate-protected), **simulated** online gateway with idempotent callbacks, receipts, allocation, reversals by approval, reconciliation with visible exceptions, double-entry journals with period control and maker-checker, ledger, trial balance, provisional statements. Chart of accounts, posting rules and fiscal calendar are **placeholders until the accountant approves them**.

### Phase 5: auctions and payouts
Decisions with the business owner: calculations skipped (Finance enters payout amounts manually with maker-checker), member-submitted bids, payouts as a workflow with manual disbursement tracking. Server-clock auction windows; every rule an explicit per-auction choice; append-only bid log; disputes; independent result approval; payout eligibility, approval, disbursement record, hold, retry and reconciliation.

### Phase 6: customer portal
Member shell (`/portal`): dues, simulated online payment, payment history and receipts, statement, auctions, payout tracking, support, profile; member-scoped API (`docs/portal-api.md`); staff support desk with internal notes.

### Phase 7: production readiness
- **PostgreSQL persistence** with SQL migrations (checksummed, refuse edits), transactional commit-before-response, in-memory rollback on failure, writer lock, readiness endpoint, graceful shutdown, command-line tools (`migrate`, `bootstrap-admin`, `init-pilot`).
- **Real authentication**: scrypt password hashing, mandatory authenticator-app MFA for staff with recovery codes, one-time activation codes, lockout, rate limiting, server-side sessions with idle and absolute timeouts, CSRF protection, HttpOnly/SameSite/`__Host-` cookies, bearer-token support for a future mobile app, MFA seeds encrypted at rest, separation-of-duties rules when assigning roles, user administration screens.
- **Security hardening**: production start-up refuses unsafe settings, security headers, strict CORS, audit of sign-ins and administration without secrets, `npm audit` clean (0 vulnerabilities in both apps).
- **Documentation and acceptance plan** (see Documentation above).

## Verification (what was actually run)
- Backend: typecheck, build and the full test suite pass (counts are printed by `npm test`). The persistence and database-guard tests run against a **real PostgreSQL 18 engine** (PGlite, WebAssembly).
- The real `pg` driver was exercised against that engine over the wire protocol (migrations, transactions, error codes, the full application with sessions).
- A running server was driven end to end with the command-line tools: migrate, bootstrap, init, sign-in with MFA enrolment, user creation, then a **hard kill of the database and the server and a restart**: the session, the new user and the audit trail were intact. The compiled `dist/` build was also started in `NODE_ENV=production` and checked (HSTS and other headers, CORS, simulated sign-in closed, unsafe configuration refused).
- Measured performance (embedded engine, no network latency): 40,000 instalment rows → write median 29 ms, read median 3 ms, cold start 0.3 s, 90 MB heap.
- **Not verified**: a separately installed PostgreSQL server; `pg_dump`/point-in-time recovery; the single-writer lock excluding a second process (the embedded engine shares one session, so the lock cannot exclude here); concurrent load over a network; a real browser (UI is tested with jsdom); an independent penetration test.

## What still blocks go-live
1. **Accountant sign-off** on the chart of accounts, posting rules (including the payout posting), fiscal calendar and statement formats.
2. **Financial formulas**: dividend, commission and prize calculation are **not implemented**; acceptance scenario 10 is not met. Payout amounts are entered manually.
3. **Business rules still placeholders**: overdue/grace rule, allocation order, instalment due dates, auction operating model approval, payout channels.
4. **Providers not chosen**: payment gateway and bank integration (payments are simulated), SMS/email/WhatsApp (no notifications), file storage for KYC documents, hosting. Members sign in with a password only until an OTP provider exists.
5. **Legal and regulatory review** (Tamil Nadu chit-fund requirements, record retention, personal-data obligations): none is asserted here.
6. **On-infrastructure checks** listed in `docs/acceptance-tests.md` (restore drill, second-instance refusal, TLS and network controls) and a **penetration test**.
7. **Scale limit by design**: single backend instance and data that fits in memory; a documented path exists if the pilot outgrows it.

## Known limitations
- KYC documents are metadata only. Required-document list and lead sources are placeholders pending compliance configuration.
- All twelve roles from the specification are modelled (including the member); approval policies are hard-coded, not configurable. Membership applications are decided on the KYC page, not in the Approval Centre.
- Branch, scheme-rule, approval-policy and system-configuration administration screens, notification templates and delivery logs, and report exports are not built. Reference data is loaded by the `init-pilot` tool.
- Scheme edits after approval require a new version; no diff view between versions. Scheme cross-checks (chit value vs instalment × members) are warnings only.
- Group "Completed/Closed", member removal after activation, payout reversal after payment and staff-assisted bidding are not built.
- Rate limiting is per process (correct for the supported single instance).
#   c h i t f u n d  
 