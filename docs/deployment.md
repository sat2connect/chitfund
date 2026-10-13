# Deployment guide

Hosting provider, payment gateway, notification providers and file storage are **not selected**. This guide covers what
is independent of those choices. Items marked **(decide)** need a business decision before go-live.

## 1. Architecture to deploy

```
 Browser / future mobile app
        |  HTTPS
   [ reverse proxy / load balancer: TLS, request size limits ]
        |                          |
  static front end (React)    backend (Node.js, ONE instance)  --->  PostgreSQL
```

- **Front end**: static files from `frontend/dist` (any static host).
- **Backend**: one Node.js process. Do not run two instances against one database (the second refuses to start).
- **PostgreSQL**: a managed or self-run instance **(decide)**. The schema was developed and tested only on the
  PostgreSQL 18 engine. It uses standard features (constraint triggers, `txid_current()`, partial and expression indexes),
  but confirm it on the exact version you choose by running the migrations and the acceptance checks there.
- Serve the front end and the API from the **same site** (for example `crm.example.org` and `api.example.org`) so
  cookies are same-site.

## 2. Prerequisites
- Node.js 24 (as developed and tested) and npm.
- A PostgreSQL database and a dedicated role that owns it. Use a strong password and TLS to the database
  (`DATABASE_SSL=true`).
- TLS certificates for both hostnames (HTTPS is mandatory in production; the server refuses `http://` origins).

## 3. Configuration (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV=production` | yes | Enables the production safety checks |
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/chitfund` |
| `DATABASE_SSL` | recommended | `true` to require a verified TLS connection |
| `AUTH_ENCRYPTION_KEY` | yes | 64 hex characters (32 bytes). Encrypts MFA seeds. **Keep it outside the database and back it up separately.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CORS_ORIGINS` | yes | Comma-separated **https** origins of the front end. `*` is refused |
| `PORT` | no | Default 4000 |
| `TRUST_PROXY` | behind a proxy | Number of proxies in front (usually `1`) so client IPs in logs and rate limits are real |
| `SESSION_IDLE_MINUTES` / `SESSION_ABSOLUTE_HOURS` | no | Defaults 30 minutes and 12 hours |
| `LOGIN_RATE_LIMIT_MAX` | no | Sign-in attempts per IP per 15 minutes (default 20) |
| `COOKIE_SECURE` | no | Defaults to `true` in production; refusing to disable it |

In production the server **refuses to start** if: simulated sign-in is enabled, `DATABASE_URL` is missing, the
encryption key is malformed, CORS is `*` or not https, or secure cookies are disabled. It lists every problem at once.

Front end (build time): `VITE_API_BASE_URL=https://api.example.org/api/v1`. Never put secrets in front-end variables.

## 4. First deployment

```bash
# 1. build
cd backend  && npm ci && npm run build
cd ../frontend && npm ci && VITE_API_BASE_URL=https://api.example.org/api/v1 npm run build

# 2. create the schema (a deliberate step; the server will not start with pending migrations)
cd ../backend && DATABASE_URL=... node dist/cli/migrate.js

# 3. create the first administrator (password from the environment, never from a command line)
BOOTSTRAP_ADMIN_NAME="..." BOOTSTRAP_ADMIN_EMAIL="..." BOOTSTRAP_ADMIN_PASSWORD="..." DATABASE_URL=... node dist/cli/bootstrapAdmin.js

# 4. load branches, the ACCOUNTANT-APPROVED chart of accounts and posting rules, and the fiscal calendar
DATABASE_URL=... node dist/cli/initPilot.js /secure/path/pilot-config.json

# 5. start the backend under a process manager with automatic restart
node dist/server.js
```

- `docs/pilot-config.example.json` shows the format. It **must** carry the accountant's name and approval date; the tool
  records them in the audit trail, validates that every posting rule points at a suitable account, and refuses to run on
  a system that already has data. The sample chart in that file is an example, **not** an approved chart.
- The administrator signs in, is asked to enrol an authenticator app, and then creates staff accounts in
  *Administration > Users and access*. Each person receives a one-time activation code and sets their own password.
- Do **not** seed demo data in production. Demo seeding is disabled when `NODE_ENV=production`.

## 5. Upgrades
1. Take a backup (`backup-recovery.md`) and note the current version.
2. Build the new version; run `node dist/cli/migrate.js`; restart the backend.
3. If something is wrong, restore the backup and redeploy the previous build (migrations have no automatic down step).

## 6. Health and monitoring
- `GET /api/v1/health` is liveness (the process is up). `GET /api/v1/ready` is readiness (database reachable and memory
  consistent); route your orchestrator's restart policy to it.
- Alert on: readiness failing, `PERSISTENCE_ERROR`/`INTEGRITY_VIOLATION` in logs (each has a request id), repeated
  `ACCOUNT_LOCKED`/`RATE_LIMITED`, write latency growth, disk space on the database.
- Logs contain request ids and error messages, not request bodies, passwords or tokens. Ship them to your logging service
  **(decide)**.

## 7. Still simulated until providers are chosen
- Online payments use a **simulated gateway**; no real money moves.
- No customer notifications are sent (no SMS, email or WhatsApp provider). Members must check the portal.
- KYC documents are recorded as metadata only (no file storage). Members sign in with a password, not an OTP.
These are labelled in the application.
