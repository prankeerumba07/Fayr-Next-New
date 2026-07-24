# Fayr backend

NestJS + PostgreSQL service for Fayr — the incentivized review-and-refund
platform. This is the authoritative backend: task state, verification, the
wallet ledger, and payouts will live here (the React Native app under `../` is
the client). See `../` and the project root `CLAUDE.md` for product ground truth.

> Build status: **Phase 0 — Foundation.** Currently: project scaffold, validated
> config, and a health endpoint. Auth, database schema, and the rest follow in
> order (see the backend roadmap).

## Requirements

- Node.js **≥ 20** (developed on Node 24)
- Docker Desktop (for local PostgreSQL) — needed from step 0.2 onward

## Setup

```bash
cd backend
npm install
cp .env.example .env        # local dev defaults; never commit .env
```

## Run

```bash
npm run start:dev           # watch mode on http://localhost:3000
```

Verify it's up:

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"fayr-backend","uptimeSeconds":0,"timestamp":"..."}
```

## Database (from step 0.2)

```bash
docker compose up -d        # starts PostgreSQL on localhost:5432
```

## Scripts

| Script              | What it does                              |
| ------------------- | ----------------------------------------- |
| `npm run start:dev` | Watch-mode dev server                     |
| `npm run build`     | Compile TypeScript to `dist/`             |
| `npm run start:prod`| Run the compiled server (`dist/main.js`)  |
| `npm run typecheck` | Type-check without emitting               |

## Conventions

- **Strict TypeScript** everywhere (`tsconfig.json`). No implicit `any`, no
  unused code, no unchecked nulls.
- **Config is validated at boot** (`src/config/env.validation.ts`). A missing or
  malformed variable stops the process with a clear message — never a surprise
  at request time.
- **Money is integer paise**, never floats (enforced when the ledger lands).
