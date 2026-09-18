# Growth measurement — how to turn it on

Branch: `growth-measurement`. Nothing has been merged into `sdk-57`.

Run these **in order**, in a terminal, from `~/FAYR-Next`.
Stop at the first one that fails and send me what it printed.

## 1. Stop whatever is running

In the window running `./start`, press **Control + C**.

## 2. Apply the new table and regenerate the client

    cd ~/FAYR-Next/backend
    npx prisma migrate deploy
    npx prisma generate

`migrate deploy` only ADDS. It creates one table (`user_events`) and one type.
It does not touch campaigns, tasks, the wallet or the ledger.

## 3. Check nothing broke

    cd ~/FAYR-Next
    ./check

This is the step that matters. It runs the backend unit tests, the end-to-end
tests, both typechecks and the app + panel suite. I could not run any of it
myself — the device bridge sees your folder but not your `node_modules`, which
is a macOS install — so this is the first real verification.

If it fails, send me the failing section and I will fix it.

## 4. Start everything again

    cd ~/FAYR-Next
    ./start

## 5. Look at it

Open the staff panel, sign in, and there is a new section under **Everyone**
called **Signing up**.

Expect the first three rows (Opened the app / Finished onboarding / Reached the
phone screen) to read **0**. That is correct, not broken: only the app can report
those and the app does not send them yet — that needs an App Store release.

Everything from **Asked for a code** downward is real, and goes back to the
beginning of Fayr.

## What changed, in one list

| Change | Where |
| --- | --- |
| New `user_events` table | one new migration |
| Records signup, verification, setup, first claim, logout | backend, automatic |
| Signup funnel + drop-off per step | `GET /admin/insights/funnel` |
| **Signing up** dashboard | staff panel, Everyone group |
| Session length **30 → 90 days** | `.env` and the schema default |
| Feed ordered per person | `GET /campaigns` |
| `POST /events` for the app to report screens | backend, unused until an app release |

## What I did NOT build, and why

**Push notifications.** They need `expo-notifications`, a permission screen, a
device-token table and an App Store / Play release. The code is a day; the
release is one to two weeks. Nothing in this branch depends on it.

## One thing to decide

Campaign categories and setup categories are **not the same vocabulary**.

Setup offers eight fixed choices ("Fashion & Apparel", "Beauty & Personal Care").
A campaign's category is free text an operator types ("Apparel", "Home/Decor").
Only "Home & Kitchen" appears on both sides.

So the feed ordering works on **connected marketplace** today, and the category
rule almost never fires. The fix is a second field on Campaign limited to those
eight values — NOT a lookup table, which rots the first time somebody invents a
new label. Say the word and I will build it.
