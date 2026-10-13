# Deploying: backend on Render, front end on Vercel

Written for the person doing the deployment. It follows `deployment.md`; read `security.md` and the "What still blocks
go-live" list in the README first. **Use test data only until those are resolved.** Prepared and rehearsed locally; it has
**not** been run on Render or Vercel (no access to your accounts), so expect to adjust names or screens.

```
Browser ──HTTPS──► Vercel  (static React app, and a same-origin proxy for /api/*)
                      │  /api/* is forwarded to
                      ▼
                   Render web service (the backend, ONE instance) ──private network──► Render PostgreSQL
```

## Why the front end proxies the API (important)
`*.vercel.app` and `*.onrender.com` are **different sites**. A session cookie from the backend would not be sent back by
the browser on calls from the front end (it would need `SameSite=None` third-party cookies, which browsers increasingly
block). So the front end calls **its own** `/api/...`, and Vercel forwards that to Render (`rewrites` in
`frontend/vercel.json`). To the browser everything is one site and the cookie works. If you later use your own domain for
both (for example `app.example.org` and `api.example.org`), you can drop the proxy.

## Before you start
- The code is on GitHub (this repository) and both Render and Vercel are connected to your GitHub account.
- A decision on plans. **Do not use the free tiers for real data**: free web services sleep when idle, and free databases
  are time-limited and not suitable for a financial system. Check Render's current plans for a paid web service and a
  paid PostgreSQL with backups.
- The accountant's approved reference data as JSON (`docs/pilot-config.example.json` shows the format; the example chart is
  **not** an approved chart).

## Step 1: database (Render)
1. Render dashboard → **New → PostgreSQL**. Choose region (put the web service in the **same region**) and a paid plan with backups.
2. When it is ready, copy the **Internal Database URL**.

## Step 2: backend (Render)
1. **New → Blueprint** and select this repository. Render reads `render.yaml` and proposes the `chitfund-backend` service.
2. Fill the values it asks for:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the **Internal** Database URL from step 1 |
   | `AUTH_ENCRYPTION_KEY` | 64 hex characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Save it in a password manager now**; keep it separate from database backups |
   | `CORS_ORIGINS` | your Vercel URL, e.g. `https://chitfund.vercel.app` (you can set a placeholder and correct it after step 3) |
   | `PROVISION_ON_START` | `true` for the **first** deploy only |
   | `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` | the first administrator (a real email) |
   | `BOOTSTRAP_ADMIN_PASSWORD` | a long unique passphrase (12+ characters) |
   | `PILOT_CONFIG_JSON` | the approved reference data **as one line of JSON** (minify the file's contents) |

3. Deploy. Before the new version starts, Render runs `node dist/cli/migrate.js` (the pre-deploy command), then starts the
   server. In the logs you should see `Provisioned reference data` and `Created the first administrator`, then `Ready.`
4. **Immediately afterwards**: in Render → Environment, **delete `BOOTSTRAP_ADMIN_PASSWORD`**, set `PROVISION_ON_START`
   back to `false` (you may also delete `PILOT_CONFIG_JSON` and the other bootstrap variables), and redeploy. Provisioning
   only runs on an empty system, so leaving the variables in place changes nothing, but a password must not sit in a
   dashboard.
5. Note the service URL, e.g. `https://chitfund-backend.onrender.com`. Check `https://<service>.onrender.com/api/v1/ready`
   returns `{"status":"ready"}`.

If the pre-deploy command is not available on your plan, run `node dist/cli/migrate.js` once from the Render shell (or
change the start command to `node dist/cli/migrate.js && node dist/server.js`); the server refuses to start while
migrations are pending, so a missed migration fails loudly rather than silently.

## Step 3: front end (Vercel)
1. Edit `frontend/vercel.json` and replace `https://REPLACE-WITH-YOUR-SERVICE.onrender.com` with your Render service URL
   (rewrite destinations cannot read environment variables). Commit and push.
2. Vercel → **Add New → Project** → import the repository. Set **Root Directory** to `frontend` (framework preset Vite is
   detected; build `npm run build`, output `dist`).
3. Add one environment variable: `VITE_API_BASE_URL` = `/api/v1` (relative, so calls go through the proxy).
4. Deploy. Copy the production URL.
5. Go back to Render and make sure `CORS_ORIGINS` is **exactly** that URL (https, no trailing slash); redeploy the backend if
   you changed it. Only the production URL works: Vercel preview URLs are different origins and are refused by design.

## Step 4: first sign-in
1. Open the Vercel URL → sign in with the administrator email and password. You will be asked to set up an authenticator
   app and to save **recovery codes**: store them offline.
2. *Administration → Users and access*: create staff accounts. Each person gets a one-time code, activates their account,
   and enrols their own authenticator.
3. Check the chart of accounts shown under *Accounting → Chart of accounts* is the approved one (no "placeholder" banner).

## Rolling deploys and the single-writer rule
Render starts a new instance while the old one is still serving. The new instance answers its health check immediately
but returns `503 STARTING` for real requests until the old instance has released the database lock (it does so when
Render stops it), then loads the data and becomes ready: expect a few seconds of "please retry". The front end shows an
error for any request in that window; a refresh fixes it. **Never run two instances**: keep `numInstances: 1` and no
autoscaling.

## After deployment: checks to do once
- [ ] `https://<vercel-url>/api/v1/ready` returns ready (proves the proxy and the backend are connected).
- [ ] Sign-in works, and the cookie is set for the Vercel domain (browser dev tools → Application → Cookies:
      `__Host-session`, Secure, HttpOnly).
- [ ] Sign out and in again; create a lead as a branch user; confirm another branch's user cannot see it.
- [ ] Redeploy the backend once and confirm no data is lost and the service returns by itself.
- [ ] `TRUST_PROXY` is `2` (Vercel + Render). If every user appears to share the same IP in the `sessions.ip` column, the
      hop count is wrong; adjust it, because rate limiting and lockout reporting use that address.
- [ ] Set up database backups and run the restore drill (`backup-recovery.md`). Database backups are Render's feature on
      paid plans; you still must test a restore.
- [ ] Add Render log alerts for `PERSISTENCE_ERROR`, `INTEGRITY_VIOLATION` and failed health checks.

## Known caveats of this setup
- Everything that was simulated stays simulated (payments, notifications); nothing here connects a payment gateway.
- Vercel's proxy adds a little latency to each API call and has its own request-time limits.
- The backend keeps its working data in memory and writes through to PostgreSQL; one instance, data that fits in memory
  (`persistence.md`).
- Render and Vercel plan features and screen names change: verify details in their current documentation.
