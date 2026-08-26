# This is the working copy

There are two checkouts of Fayr on this machine, and they are deliberately kept
apart.

| | Demo copy | This copy |
|---|---|---|
| Directory | `~/FAYR-Review-Verifier` | `~/FAYR-Next` |
| Branch | `main` | `next` |
| Database | `fayr_dev` | `fayr_next_dev` |
| Test database | `fayr_test` | `fayr_next_test` |
| Backend port | 3000 | 3001 |
| SMS | Twilio, real texts | `dev` — codes printed to the terminal |
| Status | **Frozen.** Only the final rehearsal touches it. | Where the work happens |

The demo copy is what a founder sees on Monday 1 September. Nothing done here may
change what that copy shows, so the separation is not a convention — it is the
point.

## What enforces it, rather than trusting memory

- **The database.** `backend/.env` here points at `fayr_next_dev`. The demo seed
  refuses any database not named `*_dev` or `*_test`, and both copies satisfy that
  rule separately.
- **The test database.** The e2e suite truncates every table it can reach. It no
  longer has a hard-coded default: `src/config/test-db-url.ts` derives the test
  database from *this checkout's own* dev database, and throws rather than
  guessing. A run started here can only reach `fayr_next_test`.
- **The port.** 3001 here, so both backends can run at once and the phone app
  points at whichever one its `.env.local` names.
- **Pushing to the demo copy is blocked.** It is a git remote called `demo` with
  its push URL set to a name that does not resolve, so `git push demo` fails
  instead of rewriting the frozen copy. Pull from it freely: `git fetch demo`.

## Starting it

```sh
cd ~/FAYR-Next/backend && npm run start:dev      # on :3001
```

The staff console at `admin-panel/index.html` talks to `http://localhost:3000`
by default — the DEMO backend. When working on the panel here, point it at 3001
first, and never commit a change that leaves the demo copy pointing at 3001.
