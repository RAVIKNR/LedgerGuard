# LedgerGuard

**A ledger-first banking backend with a React dashboard.**

LedgerGuard is a portfolio project exploring account management, double-entry accounting, idempotent transfers, risk review, reconciliation, and administrative controls. The Express API is authoritative for authentication, account state, balances, transfers, and ledger postings.

> **Disclaimer:** This is an educational/portfolio project, not a real bank or a production-ready financial service. Do not use it to hold or move real funds.

## Contents

- [Highlights](#highlights)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Transfer lifecycle](#transfer-lifecycle)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Running the frontend](#running-the-frontend)
- [API overview](#api-overview)
- [Background jobs](#background-jobs)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security notes](#security-notes)
- [Documentation](#documentation)

## Highlights

- Double-entry ledger with immutable posted entries.
- Money stored as PostgreSQL `BIGINT` minor units, never floating-point values.
- User-scoped idempotency keys bound to a SHA-256 request hash.
- Account locking and serializable database transactions for transfer posting.
- Explainable risk rules with administrator review for high-risk transfers.
- Reconciliation reports that identify discrepancies without modifying financial records.
- Audited administrative actions and compensating reversals.
- Optional Redis/BullMQ workers for retryable background jobs.
- React, Vite, and TypeScript frontend.

## Architecture

```mermaid
flowchart LR
    Browser --> Frontend[React + Vite]
    Frontend --> API[Express API]
    API --> Auth[Authentication and authorization]
    API --> Transfer[Transfer and risk services]
    Transfer --> DB[(PostgreSQL + Prisma)]
    Transfer --> Ledger[Append-only ledger]
    API --> Queue[Redis / BullMQ]
    Queue --> Worker[Background worker]
    Worker --> DB
    API --> Email[Email transport]
```

PostgreSQL is the source of truth for account and ledger data. The frontend communicates with the API over HTTP. The optional worker runs separately from the API process.

## Technology stack

| Area | Technologies |
|---|---|
| Backend | Node.js 20+, Express 5 |
| Database | PostgreSQL 14+, Prisma |
| Jobs | Redis, BullMQ (optional) |
| Frontend | React 18, Vite, TypeScript |
| UI | Tailwind CSS, Framer Motion, Lucide |
| Validation/forms | Zod, React Hook Form |
| Testing | Jest, Supertest |
| ML experiment | Python, FastAPI (optional and isolated) |

## Transfer lifecycle

1. An authenticated client submits sender and receiver account IDs, `amountMinor`, currency, and an `Idempotency-Key`.
2. The API validates the request and evaluates configured risk rules.
3. Low- and medium-risk transfers can proceed to posting. High-risk transfers are held for administrator review and receive no ledger entries while on hold.
4. The API locks both accounts and checks the sender's ledger-derived balance inside a serializable PostgreSQL transaction.
5. The transfer and its matching debit and credit entries are committed together.
6. A retry with the same key and same request identity returns the original transfer. Reusing the key with a different payload is rejected.

Each completed customer transfer must have one debit and one credit for the same minor-unit amount. Administrative funding is represented by a completed transfer with a credit entry and no sender account. Database constraints enforce valid posted-ledger shapes.

Ledger entries are immutable. Corrections use compensating transfers rather than editing or deleting existing entries.

## Getting started

### Requirements

- Node.js 20 or later
- PostgreSQL 14 or later
- npm
- Redis only if you plan to run the background worker

### 1. Install backend dependencies

```bash
npm install
```

### 2. Configure PostgreSQL

Create a local database named `ledgerguard`. Copy the backend environment template:

**PowerShell**
```powershell
Copy-Item .env.example .env
```

Set at least `DATABASE_URL` and a strong, randomly generated `JWT_SECRET` in the backend `.env` file.

### 3. Generate Prisma Client and apply migrations

```bash
npm run prisma:generate
npx prisma migrate deploy
```

For local development, the repository also provides:

```bash
npm run prisma:migrate
```

### 4. Start the API

```bash
npm run dev
```

The API listens on port `3000` by default and connects to PostgreSQL before accepting requests.

## Environment configuration

The root `.env.example` is for the backend. The frontend has a separate `frontend/.env.example` template.

### Backend variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Private token-signing secret |
| `FRONTEND_URL` | Exact browser origin allowed by the API |
| `GOOGLE_CLIENT_ID` | Google Web Client ID, if Google sign-in is enabled |
| `ADMIN_USER_ID` | UUID of the intentionally selected bootstrap administrator |
| `REDIS_URL` | Redis connection string when workers are enabled |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Resend email configuration |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP configuration |

Email delivery is optional for basic local startup but required for email verification and notification flows. Configure the provider used by your environment and verify delivery with real provider credentials. Automated tests mock the mail transport.

### Frontend variables

Copy the frontend template when local overrides are needed:

**PowerShell**
```powershell
Copy-Item frontend/.env.example frontend/.env.local
```

The public Vite settings include:

- `VITE_API_URL`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_ALLOWED_HOSTS`

Vite variables are embedded in browser assets. Never put database URLs, JWT secrets, OAuth client secrets, refresh tokens, SMTP credentials, API keys, or private keys in a `VITE_*` variable.

For deployment, configure backend secrets in the backend host's secret manager and public Vite values in the frontend provider's environment settings. Use the actual HTTPS frontend and API origins.

### Email OTP and local testing

The post-login account setup flow uses a separate six-digit email OTP before currency-account creation. The code is associated with the authenticated user's registered email, expires after five minutes, and allows at most five incorrect attempts. Resends have a 60-second cooldown and are limited to five successfully delivered codes per user in a rolling 24-hour window.

For local testing without sending real email, start Mailpit:

```bash
docker compose --profile email-testing up -d mailpit
```

Set `NODE_ENV=development` and `EMAIL_OTP_DELIVERY_MODE=mailpit` in the backend environment, then restart the API. Open [http://127.0.0.1:8025](http://127.0.0.1:8025) to inspect captured messages. Mailpit mode is development-only.

Registration email-link verification and post-login account-setup OTP are separate flows. Apply and review the relevant Prisma migrations before using newly introduced OTP endpoints, including `prisma/migrations/20261027120000_email_otp_verification`.

## Running the frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite development server typically runs on port `5173`. See [frontend/README.md](./frontend/README.md) for frontend-specific setup and deployment instructions.

## API overview

Main route groups include:

| Area | Example routes |
|---|---|
| Health | `GET /health`, `GET /readyz`, `GET /metrics` |
| Authentication | `POST /auth/register`, `POST /auth/login` |
| User profile | `GET /users/me`, `PATCH /users/me` |
| Accounts | `POST /accounts`, `GET /accounts/:id`, `GET /accounts/:id/balance` |
| Transfers | `POST /transfers` |
| Reversals | `POST /transfers/:transferId/reversal` |
| Administration | `/admin/users`, `/admin/accounts`, `/admin/transfers`, `/admin/audit` |
| Reconciliation | `POST /admin/reconciliation/runs`, `GET /admin/reconciliation/runs` |
| Risk review | `GET /admin/transfers/flagged`, `POST /admin/transfers/:transferId/decision` |
| Funding | `POST /admin/funding` |

Compatibility prefixes such as `/api/auth` and `/api/accounts` are also available. See the route implementation and [OpenAPI specification](./docs/openapi.json) for request and response schemas.

Transfers require `senderAccountId`, `receiverAccountId`, `amountMinor`, `currency`, and the `Idempotency-Key` header. Amounts and balances use integer minor units (for example, paise). Account states are `ACTIVE`, `FROZEN`, and `CLOSED`; account lookups are scoped to the authenticated user.

## Background jobs

Redis and BullMQ are optional. To run retryable reconciliation and risk jobs:

1. Start Redis and configure `REDIS_URL`.
2. Start the API.
3. Run the worker in a separate process:

```bash
npm run jobs:worker
```

The API enqueue endpoints return a job ID. The worker uses retry backoff and is isolated from the API process.

## Testing

Run the default test suite:

```bash
npm test
```

Database-backed tests are opt-in and require a disposable test database:

**PowerShell**
```powershell
$env:DATABASE_URL = "postgresql://ledgerguard:ledgerguard@localhost:5432/ledgerguard_test?schema=public"
$env:RUN_DB_TESTS = "1"
npx prisma migrate deploy
npm test
```

Never set `RUN_DB_TESTS=1` against a production or customer database.

CI is configured in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). It uses an isolated PostgreSQL service, validates and generates Prisma Client, applies migrations, and runs tests. CI does not deploy.

For local container-based infrastructure:

```bash
docker compose up --build
```

## Deployment

The recommended split deployment is:

- **Frontend:** Vercel, using the `frontend/` directory.
- **Backend:** Render Node service using [`render.yaml`](./render.yaml), or an equivalent managed Node host.
- **Database:** managed PostgreSQL.

Configure backend secrets (including `DATABASE_URL`, `JWT_SECRET`, email-provider credentials, and `ADMIN_USER_ID`) in the backend host's secret manager. Set `FRONTEND_URL` to the exact deployed frontend origin and configure public `VITE_*` values in the frontend deployment environment.

Run `npx prisma migrate deploy` as a release step before starting the new backend version. See [frontend deployment notes](./frontend/README.md#production-deployment).

## Security and operational notes

- The configured `ADMIN_USER_ID` must identify an existing user deliberately selected for administration. Additional admin roles are database-backed and audited.
- Public registration and profile updates cannot grant administrator access.
- The forgot-password flow currently returns different messages for registered and unregistered email addresses. This can enable account enumeration; consider a generic response for production.
- Frontend JWT state is held in memory rather than `localStorage`. The current backend does not issue refresh tokens, so a full browser refresh requires signing in again.
- Email delivery depends on correctly configured provider credentials and sender verification. Test delivery in the target environment.
- The optional ML experiment is isolated from transfer posting and does not make live production risk decisions.
- Do not use real customer data or real funds in this portfolio project.

## Documentation

- [Frontend guide](./frontend/README.md)
- [OpenAPI specification](./docs/openapi.json)
- [ML component guide](./ml/README.md)
- [Render configuration](./render.yaml)

