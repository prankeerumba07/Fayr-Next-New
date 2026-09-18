# Prompts to paste into Claude Code in VS Code

Six prompts, in order. Each one is self-contained — Claude Code has the repo but
not the conversation these came from, so everything it needs is in the text.

**How to use this file**

1. Open the repo in VS Code with Claude Code.
2. Make sure you are on a branch, not `sdk-57`.
3. Copy **the whole fenced block** for one prompt, paste, let it finish.
4. Run `./check`. Do not start the next prompt until it is green.

Prompts 1–3 give you the per-user activity trail you asked for. Prompt 4 fixes a
real defect I found. Prompts 5–6 are notifications and need an app release.

---

## Before you start — one thing I have to say plainly

You asked to record **every click**. I am not going to write you that, and here
is why, because you should be able to say this out loud to whoever asks.

**It buries the answer.** A person opening the app taps maybe forty times in a
session. At a thousand users that is millions of rows a week, and the question
you actually want answered — *where did they stop* — gets harder to see, not
easier, because the signal is now under a pile of scroll and back-button taps.

**It is personal data.** Under the DPDP Act, a per-person record of everywhere
they went and when is exactly the kind of processing that needs a stated purpose
and consent. Fayr already records consent properly with a version and a
server-side timestamp. Logging every tap without extending that consent would
undo careful work already done.

**What you get instead, which answers every question you asked:**

- every **screen** they reached, with the time
- every **meaningful action** — claimed, purchased, uploaded, withdrew, asked
  support something
- every **step of signup**, including the one they stopped at
- every **sign-in and sign-out**, and sessions that lapsed

That is a readable timeline per person. "Tapped the scroll bar at 14:02:11" is
not, and nobody would ever act on it.

If after reading that you still want raw taps, say so and I will write it with a
consent screen and a retention window. It is a decision, not a refusal.

---

## Prompt 1 — Screen tracking, app and backend

Gives every user a timeline of which screens they reached and when.

```text
Read these first so you match the codebase's existing patterns:
- backend/src/events/user-event.types.ts
- backend/src/events/user-event.service.ts
- backend/src/events/event.controller.ts
- backend/src/firstrun/steps.js
- backend/prisma/schema.prisma (the UserEvent model and UserEventType enum)
- App.js (how navigation is set up)

CONSTRAINTS, ALL OF THEM NON-NEGOTIABLE:
- Do NOT touch src/verify.js, src/extract.js, src/session.js, src/platforms.js,
  src/connect/*, src/order/*, or src/orderhistory.js. The on-device marketplace
  reader is off limits.
- Do NOT touch anything under backend/src/wallet, backend/src/tasks/engine, or
  any existing migration.
- No mobile number, name, address, order id or amount may ever be written into
  the user_events table or any log line.
- Recording a step must never be able to fail a request. Follow the try/catch
  pattern already in UserEventService.
- ./check must stay green. Add tests for everything you add.

WHAT TO BUILD:

1. Add SCREEN_VIEWED to the UserEventType enum in schema.prisma and to
   USER_EVENTS in user-event.types.ts. Write a new migration by hand in
   backend/prisma/migrations/ following the format of the existing ones — do not
   run `prisma migrate dev`, it would go against the dev database.

2. Add a `screen` field to UserEventPayload. It carries a screen NAME only, from
   a fixed allow-list of the app's route names — never a URL, never a parameter,
   never an id.

3. Add SCREEN_VIEWED to APP_REPORTABLE so the app may report it through
   POST /events, and extend ReportEventDto with an optional `screen` field
   validated against that same allow-list. Anything not on the list is refused.

4. In the app, create src/analytics/anonymousId.js: on first run, generate a uuid,
   store it in AsyncStorage under a clearly named key, and return the same value
   thereafter. It must survive sign-out and die with the install.

5. Create src/analytics/report.js: a single `reportScreen(name)` function that
   POSTs to /events with the anonymous id and the screen name. It must be
   fire-and-forget — never awaited by a screen, never surfacing an error to a
   user, silently dropping anything that fails.

6. Wire it to React Navigation's screen-change listener in App.js so every screen
   change reports once. One call site, not a call in every screen file.

7. Report APP_OPENED, ONBOARDING_DONE and PHONE_ENTRY_SEEN at the right moments
   in src/firstrun/. The backend already counts these and they currently read
   zero.

TESTS:
- The allow-list refuses an unknown screen name.
- The anonymous id is stable across calls and survives a simulated sign-out.
- reportScreen never throws, even when the network call rejects.
- A screen report with a mobile number stuffed into the name field is refused.

Tell me at the end which files you changed and what ./check said.
```

---

## Prompt 2 — The per-user activity trail, backend

The endpoint behind "search a user, see everything they did".

```text
Read first:
- backend/src/admin/admin-users.controller.ts
- backend/src/admin/admin-users.service.ts
- backend/src/admin/user-view.response.ts
- backend/src/events/insights.service.ts
- backend/prisma/schema.prisma (UserEvent, TaskEvent, Chat, AssistantQuestion,
  Withdrawal, ShopSignIn, ScreenshotUpload)

CONSTRAINTS:
- Read-only. This endpoint must not write anything, ever.
- Role: SUPPORT, guarded with StaffAuthGuard + RolesGuard like the other admin
  controllers.
- Every admin read of one person's trail must write an AdminAuditLog row. Looking
  at somebody's activity is itself an act worth recording — follow whatever
  AdminAuditService already does elsewhere.
- Do NOT return a mobile number, a payout instrument, or a screenshot in this
  response. The existing user view already handles identity; this is behaviour.
- ./check must stay green.

WHAT TO BUILD:

GET /admin/users/:id/activity?days=30&limit=500

One merged, reverse-chronological timeline for one person, assembled from the
records Fayr already keeps. Each entry: { at, kind, what, detail } where `what`
is a plain-English sentence a support agent can read without knowing the schema.

Pull from all of these:
- user_events        screens reached, signup steps, first claim, sign-outs
- task_events        every state change, with the reason
- chats + chat_messages   when they wrote in, and in which language
- assistant_questions     what they asked and whether it was answered
- withdrawals        requested, approved, paid, rejected, failed
- shop_sign_ins      which marketplace they connected and when
- screenshot_uploads that they uploaded evidence — NOT the image
- refresh_tokens     sessions that lapsed without being used

Sort by time descending, cap at `limit`, and return a count of what was trimmed
so the panel can say "showing 500 of 1,342".

Also return a small summary object: first seen, last seen, days since last
activity, total screens, total tasks, whether setup was finished, and which
step they stopped at if it was not.

Put it in backend/src/events/ next to the insights work, in its own service, and
register the controller in InsightsModule.

TESTS:
- The merge is correctly ordered when two sources have entries in the same second.
- A user with no activity returns an empty timeline and a summary, not an error.
- The response contains no mobile number — assert this explicitly on a fixture
  whose user has one.
- The audit row is written.

Tell me what ./check said.
```

---

## Prompt 3 — The per-user activity trail, admin panel

Where you actually look at it.

```text
Read first:
- admin-panel/index.html — in particular UserScreen, SearchScreen, loadGrowth,
  GrowthScreen, and the h() helper
- admin-panel/panel.test.mjs

CONSTRAINTS:
- admin-panel/index.html is ONE file with no build step. Keep it that way: no
  bundler, no framework, no new dependency, no CDN script tag.
- Match the existing style exactly — the h() helper, the card/table classes, the
  muted class, the way RunningScreen and GrowthScreen are written.
- Do not restyle or touch any other section.
- panel.test.mjs must stay green; extend it.

WHAT TO BUILD:

1. In the existing user screen (reached from "Find a user"), add an Activity
   panel that calls GET /admin/users/:id/activity.

2. Show the summary line first: first seen, last seen, days quiet, whether setup
   was finished and which step they stopped at.

3. Then the timeline, newest first, grouped by DAY with a date heading. Each row:
   time on the left, a coloured dot for the kind, the sentence, and the detail
   underneath in the muted style.

4. Colour the kinds so a support agent can scan: money one colour, tasks another,
   support another, screens the faintest. Never rely on colour alone — the kind
   is also a word on the row.

5. A "days" picker like the one on the Signing up screen: 7 / 30 / 90 / all.

6. If the trail was trimmed, say so plainly at the bottom: "showing 500 of 1,342
   — narrow the window to see more".

7. A timeline with nothing in it says so in words, not an empty box.

Add tests to panel.test.mjs for the grouping-by-day logic and for the trimmed
message.

Tell me what ./check said.
```

---

## Prompt 4 — Fix the category mismatch

A real defect. The feed ranking half-works because of it.

```text
Read first:
- backend/src/campaigns/feed-order.ts (read the comment block, it explains this)
- backend/src/me/dto/update-profile.dto.ts (the CATEGORIES list)
- backend/prisma/schema.prisma (Campaign.category)
- backend/src/campaigns/dto/create-campaign.dto.ts

THE PROBLEM:
A user picks shopping categories in setup from a fixed list of eight:
Fashion & Apparel, Beauty & Personal Care, Electronics & Mobile, Footwear,
Home & Kitchen, Grocery & Daily Needs, Sports & Fitness, Toys Babies & Kids.

A campaign's `category` is free text an operator types, and in the seed data it
holds Apparel, Home/Decor, Accessories, Personal Care, Electronics, Home.

Only "Home & Kitchen" matches on both sides, so feed ordering by category almost
never fires.

Campaign.category ALREADY has a job — it decides the return-window policy. Do not
change what it means and do not make it do two jobs.

WHAT TO BUILD:
1. Add `shopperCategory String?` to Campaign, constrained in the DTO to exactly
   the eight values from CATEGORIES. Export that list from one place so the
   profile DTO and the campaign DTO cannot drift apart.
2. Hand-write the migration. Do not run `prisma migrate dev`.
3. Make feed-order.ts rank on shopperCategory instead of category, and update its
   comment block to say the mismatch is resolved and how.
4. Add the field to the admin campaign create/edit form in admin-panel/index.html
   as a dropdown of the eight values, not a text box.
5. Backfill nothing automatically. A campaign without a shopperCategory simply
   does not match on category, which is today's behaviour.

TESTS: update feed-order.spec.ts so its fixtures use shopperCategory, and add one
asserting a campaign with no shopperCategory still appears in the feed.

Tell me what ./check said.
```

---

## Prompt 5 — Push notifications

Needs an app release. Do this one when you are ready to ship a build.

```text
Read first:
- backend/src/auth/sms/sms-sender.ts and sms.provider.ts (the provider pattern
  to copy)
- backend/src/events/user-event.service.ts (the never-throws pattern)
- backend/src/ocr/ocr.module.ts (the nullable-client pattern)
- package.json in the repo root

CONSTRAINTS:
- Follow the existing provider pattern: an interface, implementations chosen by
  config, and a dev implementation so a fresh clone runs offline.
- Sending must never fail the request that triggered it.
- Every send is recorded with an idempotency key so a retry cannot double-send.
- No mobile number or amount in any log line.
- ./check green.

WHAT TO BUILD:

1. Add expo-notifications to the app. Ask for permission AFTER the user's first
   successful claim, never on first launch — framed as "we'll tell you when your
   order is spotted and when your refund is ready".

2. New table device_tokens: userId, token, platform, createdAt, lastSeenAt,
   deadAt. Unique on token. Hand-write the migration.

3. New table notifications: userId, kind, channel, body, idempotencyKey unique,
   sentAt, deliveredAt, failedReason. Hand-write the migration.

4. A NotificationService with one method `send(userId, kind, body, channels)`.
   It looks up live device tokens, sends, and marks a token dead when the push
   service says it is invalid. A dead token is how we learn somebody uninstalled
   — there is no other signal, and a push to an uninstalled app is impossible.

5. Wire the TRANSACTIONAL set only, and nothing else in this prompt:
   - order detected against a claim
   - delivery confirmed
   - review confirmed live
   - refund released to the wallet          (push AND sms)
   - withdrawal paid                        (push AND sms, on confirmation)
   - withdrawal rejected or failed          (push AND sms, with the reason)
   - claim expiring in 24 hours
   - staff replied in support

6. An opt-out switch in the app profile that turns off lifecycle notifications
   and NEVER transactional ones. Store it on the user.

TESTS:
- Sending the same notification twice with the same key sends once.
- A dead token is marked dead and not retried.
- A send failure does not fail the thing that triggered it.
- Opt-out suppresses lifecycle and does not suppress transactional.
```

---

## Prompt 6 — Lifecycle notifications

Do this last, after prompt 5 has shipped and you can see whether it helped.

```text
Read first:
- backend/src/scheduler/ (the existing nightly job, for the mechanism)
- the NotificationService from prompt 5

CONSTRAINTS:
- The rules go in a PURE file with no database and no clock, tested on their own.
  The scheduler calls into them. Same shape as backend/src/chat/chat.rules.ts.
- Maximum 2 lifecycle notifications per user per week. Transactional does not
  count toward it.
- Never send between 21:00 and 09:00 IST. Queue for the morning.
- A sequence STOPS the moment the person does the thing it is nudging about.
- One SMS to a user whose push token is dead, ever. It costs money.
- ./check green.

THE SEQUENCE:
day 1   signed up, setup not finished    finish setting up                push
day 3   setup done, never claimed        a campaign in a category they chose  push
day 7   still never claimed              one more, a different category  push
day 14  still never claimed              last one, then stop             push
day 7   claimed, never purchased         your claim expires soon         push
day 30  was active, now quiet            what is new on Fayr             push
day 60  quiet and push token is dead     ONE sms, then never again       sms

TESTS, and these are the ones that matter:
- Somebody who claims on day 4 gets the day-3 nudge and NOT the day-7 one.
- The weekly cap holds when three rules fire in the same week.
- A 22:00 IST trigger sends at 09:00, not at 22:00.
- The day-60 SMS is sent once and never repeats.
```

---

## After all six

Ask Claude Code for this:

```text
Add a section to admin-panel/index.html under Everyone called "Notifications"
showing, for the last 30 days: how many were sent by kind and channel, how many
failed, how many device tokens went dead (our uninstall estimate), and the
opt-out rate. Read-only, same style as the Signing up section. ./check green.
```
