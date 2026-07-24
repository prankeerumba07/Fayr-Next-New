# Fayr backend

The API for Fayr — the incentivized review-and-refund platform. NestJS + Prisma
+ PostgreSQL, TypeScript in strict mode. This is the authoritative backend (the
React Native app under `../` is the client).

> Verification model: a review that is **publicly visible** on the product page
> is the signal → hold for the marketplace return window → refund. Money is an
> append-only, double-entry ledger in **integer paise**. See the repo-root
> `CLAUDE.md` for the product ground truth.

**Phase 0 (Foundation) is complete:** validated config, health/readiness probes,
mobile-OTP auth (JWT access + rotating refresh tokens), a global error/logging
safety net, and a full test + CI gate. Domain features (campaigns, tasks, the
wallet ledger, payouts, verification) arrive in Phase 1.

## Stack

| Concern      | Choice                                            |
| ------------ | ------------------------------------------------- |
| Framework    | NestJS 11 (Express)                               |
| Language     | TypeScript (strict)                               |
| Database     | PostgreSQL 17                                     |
| ORM          | Prisma 6                                          |
| Auth         | Mobile-OTP → JWT access + rotating refresh tokens |
| Hashing      | argon2 (OTP codes) · SHA-256 (refresh tokens)     |
| Logging      | pino (structured, request-scoped)                 |
| Tests        | Jest (unit + e2e via supertest)                   |

## Prerequisites

- **Node.js ≥ 20**
- **Docker** (for local PostgreSQL via `docker-compose.yml`)

## First-time setup

```bash
cd backend

# 1. Environment. Copy the template and set a real JWT secret.
cp .env.example .env
#    Generate one:  openssl rand -base64 48   →  paste into JWT_ACCESS_SECRET

# 2. Install dependencies (also generates the Prisma client via postinstall).
npm install

# 3. Start PostgreSQL.
docker compose up -d

# 4. Apply migrations (creates the tables).
npm run prisma:migrate

# 5. Run the server.
npm run start:dev
```

The API listens on `http://localhost:3000` (override with `PORT`). Verify:

```bash
curl http://localhost:3000/health         # liveness
curl http://localhost:3000/health/ready   # readiness (checks the DB)
```

## Environment variables

Validated at boot by a Zod schema (`src/config/env.validation.ts`) — the process
**refuses to start** if anything is missing or malformed.

| Variable                 | Required | Default       | Notes                                                           |
| ------------------------ | -------- | ------------- | --------------------------------------------------------------- |
| `NODE_ENV`               | no       | `development` | `development` \| `test` \| `production`                         |
| `PORT`                   | no       | `3000`        | HTTP port                                                       |
| `DATABASE_URL`           | **yes**  | —             | `postgresql://user:pass@host:5432/db?schema=public`             |
| `JWT_ACCESS_SECRET`      | **yes**  | —             | ≥ 32 chars. No default — a different secret **per environment** |
| `JWT_ACCESS_TTL`         | no       | `15m`         | Access-token lifetime (ms-style string)                         |
| `REFRESH_TOKEN_TTL_DAYS` | no       | `30`          | Refresh-token lifetime, in days                                 |
| `TEST_DATABASE_URL`      | e2e only | `…/fayr_test` | Used solely by the e2e suite; must name a `*_test` database     |

## Scripts

| Script                   | What it does                                             |
| ------------------------ | -------------------------------------------------------- |
| `npm run start:dev`      | Dev server with watch + pretty logs                      |
| `npm run start`          | Run once (compiles, no watch)                            |
| `npm run build`          | Compile to `dist/`                                       |
| `npm run start:prod`     | Run the compiled `dist/main.js`                          |
| `npm run typecheck`      | `tsc --noEmit`                                            |
| `npm run lint`           | ESLint (+ Prettier) over `src` and `test`                |
| `npm run format`         | Prettier write                                           |
| `npm test`               | Unit tests (no DB — Prisma is mocked)                    |
| `npm run test:e2e`       | E2E tests against an isolated `fayr_test` database       |
| `npm run prisma:migrate` | Create/apply a migration in dev                          |
| `npm run prisma:deploy`  | Apply migrations in prod/CI (no schema drift, no prompt) |
| `npm run prisma:studio`  | Browse the DB in Prisma Studio                           |
| `npm run db:reset`       | Drop + recreate + re-migrate (dev only)                  |

## API — Phase 0

Every error response shares one shape:
`{ statusCode, error, message, requestId, timestamp, path }`, and every response
carries an `x-request-id` header.

| Method + path            | Auth   | Purpose                                     |
| ------------------------ | ------ | ------------------------------------------- |
| `GET  /health`           | —      | Liveness (dependency-free)                  |
| `GET  /health/ready`     | —      | Readiness (verifies the DB is reachable)    |
| `POST /auth/otp/request` | —      | Send a 6-digit code. `{ mobile }` (E.164)   |
| `POST /auth/otp/verify`  | —      | Verify + create session. `{ mobile, code }` |
| `POST /auth/refresh`     | —      | Rotate the refresh token. `{ refreshToken }`|
| `POST /auth/logout`      | —      | Revoke a refresh token. `{ refreshToken }`  |
| `GET  /auth/me`          | Bearer | The authenticated principal                 |

**Auth policy:** access token 15m, refresh token 30d (rotated on every use);
OTP is 6 digits, 5-min TTL, max 5 attempts, 60s per-number resend cooldown;
reusing a rotated-out refresh token revokes **all** of the user's sessions.

## Testing

- **Unit** (`npm test`) — pure, in-memory; Prisma and the SMS sender are mocked,
  argon2 runs for real. No database or network needed.
- **E2E** (`npm run test:e2e`) — boots the real app against a dedicated
  `fayr_test` database (auto-created + migrated by `test/global-setup.ts`). It
  **refuses** to run against any database whose name doesn't end in `_test`, and
  re-checks the live connection before touching data, so it can never affect dev
  data.

## Docker (production image)

```bash
# Build the lean, non-root runtime image.
docker build -t fayr-backend ./backend

# Run it (point DATABASE_URL at a reachable Postgres; pass a real secret).
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://fayr:fayr@host.docker.internal:5432/fayr_dev?schema=public" \
  -e JWT_ACCESS_SECRET="$(openssl rand -base64 48)" \
  fayr-backend
```

The image is multi-stage: build with dev deps → prune → copy only production
`node_modules` + `dist` into a slim base, run as the unprivileged `node` user,
with a Node-based `HEALTHCHECK` against `/health`.

## Before launch — known gaps (intentional)

Deferred by design and tracked here so they aren't forgotten:

- **Real SMS provider.** OTP delivery currently logs the code to the server
  console (`DevSmsSender`). Bind a real provider (MSG91/Twilio/…) to `SMS_SENDER`
  in `AuthModule` — it's the piece that pairs with the app's SMS Retriever API.
  `DevSmsSender` must never run in production.
- **Per-environment `JWT_ACCESS_SECRET`.** Use a distinct, high-entropy secret in
  each environment; never reuse the dev value.
- **Migrations on deploy.** Run `npm run prisma:deploy` as a pre-deploy step
  (CI/CD or an init job) before the new app version starts serving.
