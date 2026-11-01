# LedgerGuard

LedgerGuard is a backend service for managing users, accounts, and financial
transactions.

The repository also contains a React/Vite frontend in
[frontend/](./frontend/). The frontend is the portfolio-facing dashboard;
the Express API remains authoritative for authentication, balances, transfers,
ledger entries, and risk decisions.

## Phase 1 setup

The Phase 1 foundation includes:

- Express API with centralized error handling
- PostgreSQL connection through Prisma
- Environment-based configuration
- Request logging and validation
- `GET /health` health check
- Jest and Supertest test setup

## Phase 2 database design

The initial migration in
`prisma/migrations/202610241003_phase2_database_design` creates:

- `users`, `accounts`, and `transfers`
- append-only `ledger_entries`
- scoped `idempotency_keys`
- one-to-one `risk_assessments`
- `reconciliation_runs` with discrepancy JSON

Money is stored as PostgreSQL `BIGINT` minor units (`amount_minor`), never as
floating-point values. Foreign keys, indexes, and unique constraints are
defined in the migration.

With PostgreSQL running and `DATABASE_URL` configured, apply the migration:

```powershell
npm run prisma:migrate
```

## Requirements

- Node.js 20+
- PostgreSQL 14+

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create a PostgreSQL database named `ledgerguard`.

3. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Generate the Prisma client:

   ```powershell
   npm run prisma:generate
   ```

### Environment variable scopes

The root `.env.example` is the backend template. Copy it to `.env` only for
local development; never commit that copy. The `frontend/.env.example` file is
the separate Vite template. Copy it to `frontend/.env.local` when the browser
needs a non-default API origin or Google sign-in:

```powershell
Copy-Item frontend/.env.example frontend/.env.local
```

Backend variables required for a normal deployment are:

- `DATABASE_URL`: private PostgreSQL connection string.
- `JWT_SECRET`: private, long, randomly generated signing secret.
- `FRONTEND_URL`: exact browser origin allowed by the API.
- `GOOGLE_CLIENT_ID`: Google Web Client ID when Google sign-in is enabled.
- `ADMIN_USER_ID`: UUID of the initial administrator when bootstrap admin
  configuration is used.

Email delivery is optional for basic local startup but required for production
verification and failure notifications. Configure either the Resend variables
(`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) or the backend SMTP/OAuth variables
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_USER`, `CLIENT_ID`,
`CLIENT_SECRET`, and `REFRESH_TOKEN`) in the backend environment only.
`REDIS_URL` is optional unless the background job worker is enabled.
`EMAIL_OTP_*` and Mailpit variables control OTP expiry, resend limits, and
local development delivery.

Only intentionally public `VITE_*` values belong in `frontend/.env.local`:
`VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_ALLOWED_HOSTS`. Vite embeds
these values into browser assets. Never place database URLs, JWT secrets,
OAuth client secrets, refresh tokens, SMTP credentials, API keys, or private
keys in a `VITE_*` variable.

For production, configure backend secrets in the hosting provider's secret
manager and configure the public Vite variables in the frontend provider's
environment settings. Do not copy local `.env` files to either provider. Use
the actual HTTPS frontend and API origins; do not use localhost or temporary
tunnel URLs in production.

For verification email delivery through Resend, set `RESEND_API_KEY` and
`RESEND_FROM_EMAIL` in `.env`. `FRONTEND_URL` must be the browser-facing
frontend origin; local development uses `http://localhost:5173`. The
verification link format is
`http://localhost:5173/verify-email?token=<one-time-token>`. The token is
validated by `GET /api/auth/verify-email` and is never returned in the API
response. SMTP remains available as a local fallback when Resend is not
configured.

### Authenticated email OTP

After sign-in, the Accounts setup step requires a separate six-digit email OTP
before currency-account creation. The OTP is sent only to the email address
associated with the authenticated account; it expires after five minutes and
allows at most five incorrect attempts. Resends have a 60-second cooldown and
are limited to five successfully delivered codes per user in a rolling
24-hour window. Configuration or email-delivery failures do not consume a send
or start the cooldown.

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail-address
SMTP_PASS=your-gmail-app-password
EMAIL_OTP_EXPIRY_SECONDS=300
EMAIL_OTP_RESEND_COOLDOWN_SECONDS=60
```

Create a Gmail App Password and configure these values in the backend `.env`
or deployment secrets. They must never be placed in a `VITE_*` variable or
committed. The backend stores an HMAC of each OTP, bound to the user ID and
registered email; the plain code is returned only to the mail transport. Email
delivery has not been confirmed with live SMTP credentials; automated tests
mock the mail transport.

The rolling send limiter records successful delivery timestamps in the existing OTP
challenge. Deployments with existing history retain it until it expires naturally;
older versions may have counted failed delivery attempts. Do not clear those
counters to restore access. Before deploying a schema change, apply the additive migration with
`npx prisma migrate deploy`; existing send counts are conservatively carried
forward at their previous window start so applying it does not reset active
limits.

To test the authenticated OTP flow locally without sending real email, use the
Mailpit profile:

```powershell
docker compose --profile email-testing up -d mailpit
```

The full local Compose stack binds its published ports to loopback and runs the
API in development mode. Set a strong `JWT_SECRET` in the local `.env` before
starting the API; the Compose database credential is for local development
only and must never be reused in a deployed environment.

In the backend's local `.env`, set `NODE_ENV=development` and
`EMAIL_OTP_DELIVERY_MODE=mailpit`, then restart the backend. Open
`http://127.0.0.1:8025` to read the locally captured verification messages.
Mailpit's SMTP/UI ports are bound to loopback only. This mode sends to the
local test server, requires no SMTP credentials, and is rejected unless the
backend runs in development; leave `EMAIL_OTP_DELIVERY_MODE=smtp` in
production. The OTP remains random and is not returned by the API or logged.

Existing registration email-link verification remains separate from this
post-login account-setup OTP. Phone number is an optional profile contact and
is not used for verification. The migration
[`20261027120000_email_otp_verification`](./prisma/migrations/20261027120000_email_otp_verification/migration.sql)
renames the already-applied phone-verification column and challenge table to
legacy names (preserving their data) and creates the email OTP challenge
table. Review and apply the migration to the target database before using the
new email OTP endpoints; it has not been applied as part of this change.

### Public local testing with ngrok

For phone or cross-device testing without deploying, run one ngrok tunnel for
each local service:

```powershell
ngrok http 5173
ngrok http 3000
```

Copy the two HTTPS forwarding URLs into the environment files, without a
trailing slash:

- Backend `.env`: set `FRONTEND_URL` to the frontend ngrok origin.
- `frontend/.env.local`: set `VITE_API_URL` to the backend ngrok origin plus
  `/api`, and set `VITE_ALLOWED_HOSTS` to the frontend ngrok hostname only.

For example, if ngrok displays `https://frontend-example.ngrok-free.app` and
`https://api-example.ngrok-free.app`, use:

```text
FRONTEND_URL=https://frontend-example.ngrok-free.app
VITE_API_URL=https://api-example.ngrok-free.app/api
VITE_ALLOWED_HOSTS=frontend-example.ngrok-free.app
```

These are examples of the required shape, not URLs to copy. The API returns
CORS access only to the exact origin derived from `FRONTEND_URL`; requests
carrying a different browser origin are rejected. CORS is not authentication
or authorization—the API still validates bearer tokens and administrator
identity on the server. Restart both the backend and Vite after changing
environment variables. Keep the ngrok tunnels running while opening the
verification email.

5. Start the API:

   ```powershell
   npm run dev
   ```

The API starts on port `3000` by default. It connects to PostgreSQL before
starting to accept requests.

## Tests

```powershell
npm test
```

## Existing API routes

- `GET /health`
- `GET /readyz` (database readiness)
- `GET /metrics` (safe in-memory request metrics)
- `POST /auth/register`
- `POST /auth/login`
- `GET /users/me`
- `PATCH /users/me` (authenticated banking-profile update)
- `POST /accounts`
- `GET /accounts/:id`
- `GET /accounts/:id/balance`
- `POST /transfers`
- `POST /admin/funding` (administrator only)
- `POST /transfers/:transferId/reversal` (authenticated transfer owner)
- `GET /admin/transfers/flagged` (administrator only)
- `POST /admin/transfers/:transferId/decision` (administrator only)
- `POST /admin/jobs/reconciliation` (administrator only)
- `POST /admin/jobs/risk/:transferId` (administrator only)

The `/api/auth` and `/api/accounts` prefixes remain available for compatibility
with the earlier API. Account lookups always constrain the query by both the
requested account ID and the authenticated user's ID, so changing an account
ID cannot expose another user's account.

Account states are `ACTIVE`, `FROZEN`, and `CLOSED`. Account balances are
returned as integer minor units in `balanceMinor`.

The authenticated `/users/me` endpoint returns the user's banking profile, and
`PATCH /users/me` updates only the identity from the verified session. Profile
columns are nullable for existing accounts. Apply the
`20261026114500_banking_profile` Prisma migration before using the profile
fields; no existing user data is overwritten.

Transfers require `senderAccountId`, `receiverAccountId`, `amountMinor`,
`currency`, and the `Idempotency-Key` header. The transfer operation locks both accounts,
checks the sender's ledger-derived balance, and writes the transfer and its
debit/credit entries in one serializable PostgreSQL transaction.

Every completed customer transfer must have exactly one debit and one credit
for the same minor-unit amount. Administrative funding is represented as one
credit with no sender account. A deferred PostgreSQL constraint trigger rejects
any other posted-ledger shape. Ledger entries are immutable; corrections must
be represented by a new compensating transfer and entries.

## Phase 7 reconciliation

Run an administrator-only reconciliation with `POST /admin/reconciliation/runs`.
The engine compares ledger-derived account balances with completed transfer
projections and checks every transfer for missing, mismatched, duplicate, or
status-inconsistent postings. Each run is stored in `reconciliation_runs`;
reconciliation only reports discrepancies and never changes financial records.
Use `GET /admin/reconciliation/runs` to review the latest reports.

## Phase 8 risk engine

Transfer creation runs explainable risk rules before ledger posting. The
assessment records a score, `LOW`, `MEDIUM`, or `HIGH` level, a decision, and
human-readable reasons. Low and medium risk transfers are approved and posted;
high-risk transfers are stored with `REVIEW` status and no ledger entries, so
they enter a visible hold flow instead of disappearing. Risk assessment is
separate from the accounting posting logic.

The key is scoped to the authenticated user and bound to a SHA-256 hash of the
request identity. Retrying a matching request returns the original transfer;
reusing the key with a different payload is rejected. The database uniqueness
constraint also makes concurrent retries safe, including when a client times
out after the server commits.

To authorize an administrator, an operator must set the server-side
`ADMIN_USER_ID` environment variable to the UUID of an existing user who
has been intentionally selected for administration, then restart the server.
That configured bootstrap administrator cannot be demoted through the portal.
After applying database migrations, an active administrator can manage
additional active users with verified email addresses from `/admin/roles`.
Secondary roles are stored in `users.is_admin`, checked against the database on
each request, and changes are recorded in `admin_audit_logs`. Public profile
updates cannot set this field. The API rejects self-demotion, removal of the
last active administrator, and conflicting concurrent role changes.
The admin portal is available at `/admin`; its database-backed overview is
served by `GET /admin/overview`. Public registration and profile endpoints do
not accept or promote administrator roles, and changing frontend state or
request data cannot grant admin access.

For local funding tests, an already authorized administrator can call
`POST /admin/funding` with `accountId`, `amountMinor`, `currency`, and a
required `reason`. Funding is recorded as a completed transfer with an
auditable credit ledger entry and admin audit event; it is not a direct balance
mutation.

Admin operations also provide paginated `/admin/users`, `/admin/accounts`,
`/admin/transfers`, and `/admin/audit` views. User suspension/reactivation and
account freeze/unfreeze require a reason and create an audit event in the same
database transaction as the state change. Account transitions are limited to
`ACTIVE` ↔ `FROZEN`; closed accounts and users cannot be reopened through
these endpoints. Transfer monitoring supports status, date range, account,
risk level, and risk-decision filters. These controls do not edit balances or
ledger entries. The general audit log is stored in append-only
`admin_audit_logs`.

If a transfer submission times out, the client can check its status using
`GET /transaction/status` with the same authenticated `Idempotency-Key`. The
lookup does not create or resubmit a transfer; retrying the original request,
if needed, must reuse that same key.

## Phase 9 optional ML model

The isolated `ml/` component generates deterministic synthetic transactions,
trains logistic regression, and compares it with the rule-based baseline on a
held-out split using precision, recall, and false-positive rate. It does not
participate in accounting or transfer posting unless a future, measured
integration is explicitly approved.

See [ml/README.md](./ml/README.md) for setup and the optional FastAPI service.

OpenAPI documentation is in [docs/openapi.json](./docs/openapi.json).

## Phase 10 recovery and background jobs

Completed customer transfers can be reversed with a compensating completed
transfer. The original transfer is marked `REVERSED`; neither transfer nor
either set of ledger entries is deleted or edited. Reversal requests require a
scoped `Idempotency-Key`, and the database prevents a second reversal.

High-risk transfers are listed through the administrator API. Approving one
posts its balanced ledger entries; declining one records a `FAILED` outcome.
Every decision stores the administrator user and timestamp in
`admin_decisions`.

Retryable reconciliation and risk jobs use Redis and BullMQ. Set `REDIS_URL`,
start Redis, then run `npm run jobs:worker`. The API enqueue endpoints return a
job ID and use exponential retry backoff. The worker is separate from the API
so a job failure cannot silently change accounting records.

## Phase 11 testing, CI, and deployment

### Production deployment

The recommended split deployment is:

- **Frontend:** Vercel static hosting from the `frontend/` directory.
- **Backend:** Render Node web service using the checked-in
  [render.yaml](./render.yaml), or an equivalent managed Node host.
- **Database:** Managed PostgreSQL configured through `DATABASE_URL`.

The frontend uses `VITE_API_URL` for the deployed API base URL. The backend
uses `FRONTEND_URL` for an exact HTTPS CORS allowlist entry. See
[frontend/README.md](./frontend/README.md#production-deployment) for the
complete environment-variable and verification checklist.

The frontend bundle may contain only public `VITE_*` configuration, such as a
Google Web Client ID. Never expose `DATABASE_URL`, `JWT_SECRET`, OAuth client
secrets, refresh tokens, SMTP credentials, or provider API keys through Vite
variables.

Run the default tests:

```powershell
npm test
```

Database-backed tests are intentionally disabled unless both safeguards are
present:

```powershell
$env:DATABASE_URL = "postgresql://ledgerguard:ledgerguard@localhost:5432/ledgerguard_test?schema=public"
$env:RUN_DB_TESTS = "1"
npx prisma migrate deploy
npm test
```

The test database must be a disposable database named `ledgerguard_test`.
Never set `RUN_DB_TESTS=1` against a production or customer database.

For local infrastructure:

```powershell
docker compose up --build
curl http://localhost:3000/health
curl http://localhost:3000/readyz
```

The API container applies pending migrations before starting. In managed
deployment, run `npx prisma migrate deploy` as a release step, then start
`node server.js`. Roll back application code only after confirming that the
database migration is backward-compatible; do not roll back applied Prisma
migrations by deleting rows from `_prisma_migrations`.

CI is defined in [.github/workflows/ci.yml](./.github/workflows/ci.yml). It
starts an isolated PostgreSQL service, validates and generates Prisma Client,
deploys migrations, and fails on any test failure. It does not deploy.

To measure repeatable HTTP performance against a running local server:

```powershell
$env:LOAD_URL = "http://127.0.0.1:3000/health"
$env:LOAD_CONCURRENCY = "10"
$env:LOAD_DURATION_SECONDS = "30"
npm run load:test
```

The command reports measured request count, failures, throughput, and p50/p95/p99
latencies. It does not represent transfer throughput until pointed at a
properly seeded test fixture with valid authentication and idempotency keys.
No benchmark result is claimed until the command is run and its output recorded.

## Phase 12 frontend

The React/Vite/TypeScript design-system foundation lives in `frontend/`.
It uses Tailwind CSS, Framer Motion, and Lucide icons. Start it with:

```powershell
cd frontend
npm install
npm run dev
```

The initial dashboard is a visual foundation only; API authentication and
financial data wiring should be added in the next frontend phase.

### Phase 13 authentication

The frontend now includes real login and registration screens connected to the
existing `/api/auth` routes. It validates fields with React Hook Form and Zod,
handles backend/network errors, supports password visibility, and protects the
dashboard behind in-memory authentication state. JWTs are sent as bearer
headers through Axios and are not persisted in localStorage. Since the current
backend does not issue refresh tokens, a full browser refresh requires signing
in again. See [frontend/README.md](./frontend/README.md) for verification
steps.

Google authentication uses Google Identity Services in the browser and
server-side ID-token verification with `GOOGLE_CLIENT_ID`. The Google subject
is stored in the additive `users.google_subject` field. Existing
email/password users are not automatically linked; the Google endpoint returns
a conflict instructing the user to use the password account. Configure the
same Web Client ID in the backend `.env` and `frontend/.env.local`.

The forgot-password endpoint intentionally returns different messages for
existing and nonexistent email addresses because the product flow requires
account-specific frontend feedback. This enables account enumeration, so
production deployments should switch to a generic response if that threat
outweighs the UX requirement. Reset tokens remain hashed, single-use, and
valid for 15 minutes.
- `POST /api/transaction/transaction`
- `POST /api/transaction/initial-funding`
