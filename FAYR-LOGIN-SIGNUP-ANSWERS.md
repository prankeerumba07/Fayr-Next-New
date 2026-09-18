# Login and signup — every question, answered

For each thing asked: the question, the answer, whether it is built, what is
missing, what is needed, and how it gets built.

Use this to answer in a room without having to go and check.

Status key: **BUILT** works today · **PARTLY** some of it · **NOT BUILT** none of it

---

## 1. Multiple users signing up with different details

**Q.** Can many people sign up at once with different details and preferences?

**A.** Yes. Signup is mobile number plus a 6-digit code. There is no separate
registration — a correct code either finds your account or creates it. Setup then
collects age band, gender, at least three shopping categories from a fixed list
of eight, and which marketplaces they already shop on.

**Status: BUILT.** Nothing is missing.

---

## 2. A unique ID per user

**Q.** Does every user have a unique identifier?

**A.** Three, doing different jobs.

| Identifier | Example | Job | Rule |
| --- | --- | --- | --- |
| UUID | `a3f1…` | The real key every table joins on | Never shown to anybody |
| Display ID | `FAYR-100042` | What a person quotes to support | Display only — no endpoint accepts it as a lookup |
| Mobile | `+9198…` | The login identity | Unique. One number, one account |

`FAYR-100042` is **not** the 42nd user — the sequence starts at an offset, so the
number never reveals how many users we have or when somebody joined.

One more rule worth saying out loud: **one account per PAN**, enforced by the
database, required only at first cash-out. One human being, one account, the
moment real money is involved.

**Status: BUILT.**

---

## 3. Auto-logout after how many days

**Q.** How long before an inactive user is signed out?

**A.** **90 days of never opening the app.** Not 90 days since signing in — every
time the app opens it renews, so the clock restarts.

It was 30 days. Raised because a Fayr task is slow by nature: claim, wait for
delivery, wait for a return window. Six weeks away mid-task is ordinary. A
forced re-login costs an SMS, a delay, and some share of people who never come
back, and a stolen session is worth little here because money can only leave to a
payout instrument anchored to a PAN.

**Status: BUILT.** One config value, reversible in a minute.

---

## 4. App installed but not being used

**Q.** What happens to somebody who has the app and does not open it?

**A.** Nothing happens to them. Their session stays alive for 90 days, then
lapses. They are never deleted and their wallet is untouched.

What *should* happen is a nudge at day 3, 7 and 14 if they never claimed, and at
day 30 if they were active and went quiet.

**Status: NOT BUILT.** Fayr sends nothing today except the sign-in code.

**What is needed:** push notifications, which need an app release.
**How it gets built:** prompts 5 and 6 in `FAYR-PROMPTS.md`.

---

## 5. What notifications should be sent

**Q.** What do we send, and to whom?

**A.** Two kinds, with different rules. Never mix them.

**Transactional** — something happened to their money or their task. Always sent.
Never capped. No opt-out.

| Trigger | Channel |
| --- | --- |
| Order detected against a claim | push |
| Delivery confirmed | push |
| Review confirmed live | push |
| **Refund released to wallet** | push + SMS |
| **Withdrawal paid** | push + SMS |
| Withdrawal rejected or failed | push + SMS |
| Claim expiring in 24 hours | push |
| Staff replied in support | push |

Money leaving our side always gets an SMS as well as a push, because that is the
message somebody must not miss.

**Lifecycle** — we want them back. Capped at 2 a week, opt-out-able, never
between 9pm and 9am IST, and the sequence stops the moment they do the thing.

**Status: NOT BUILT.** **How:** prompts 5 and 6.

---

## 6. How to trigger a notification

**Q.** What makes one fire?

**A.** Transactional ones fire from the event itself, in the backend — the moment
a refund posts, the moment a disbursement is confirmed. Never from a person
clicking approve; always from the thing actually happening.

Lifecycle ones fire from a scheduled job that runs daily and asks a pure rules
file "who is due what today". The scheduler mechanism already exists — it runs
the nightly campaign check.

**Status: NOT BUILT**, but the mechanism is. **How:** prompts 5 and 6.

---

## 7. Notifying somebody who has uninstalled

**Q.** When do we notify a user who has uninstalled the app?

**A. You cannot push to an uninstalled app. Ever.** The token dies with the
install. There is no workaround on iOS or Android and no vendor sells one.

What actually happens is the reverse: the push service tells **us** the token is
dead, and **that is how we learn somebody uninstalled.** It is the only reliable
uninstall signal that exists.

So the only channels that reach them are SMS and WhatsApp, and both cost money
per message. The rule: **one SMS at day 60, and never again.**

This also means push permission matters more than it looks. Everyone who denies
it becomes somebody we can only reach by paying.

**Status: NOT BUILT.** **How:** prompt 5 builds the dead-token tracking, prompt 6
the day-60 SMS.

---

## 8. How many notifications, after how many days

**Q.** What is the cadence?

| Day | Condition | Channel |
| --- | --- | --- |
| 1 | signed up, setup not finished | push |
| 3 | setup done, never claimed | push |
| 7 | still never claimed | push |
| 14 | still never claimed — **last one** | push |
| 7 | claimed, never purchased | push |
| 30 | was active, now quiet | push |
| 60 | quiet and push token dead | **one** SMS |

Hard caps: 2 lifecycle a week, nothing between 9pm and 9am IST, sequence stops
the moment they act.

**Status: NOT BUILT.** **How:** prompt 6.

---

## 9. Where each user's details are stored

**Q.** Where does a user's information live?

**A.** One PostgreSQL database. No second store, no analytics vendor, no separate
profile service.

| Table | Holds |
| --- | --- |
| `users` | mobile, display id, name, age band, gender, categories, platforms, setup latch, consent version + timestamp, PAN |
| `otp_challenges` | every code request, with attempts and timestamps |
| `refresh_tokens` | one row per session, with device and IP |
| `user_events` | **new** — screens, signup steps, first claim, sign-outs |
| `tasks` + `task_events` | every campaign and every state change |
| `wallet_*` / `ticket_entries` | money and claim credits, append-only |
| `payout_methods` | UPI or bank, masked on display |
| `chats` / `assistant_questions` | support conversations and language |
| `shop_sign_ins` | which marketplaces they connected |

**Never stored:** marketplace passwords, date of birth (only a band), payment
cards, and no screenshot or mobile number in any log line.

**Status: BUILT**, with `user_events` added this week.

---

## 10. How recommendations are shown

**Q.** How does a campaign reach the right person?

**A.** Three rules, in order: a marketplace they have actually **connected**,
then a category they chose in setup, then newest first. No scoring model — every
campaign's position is explainable in one sentence.

It never removes anything. A new person with nothing connected sees the same feed
everybody used to see, because a filter would show them an empty screen, which
reads as a broken app.

**Status: PARTLY.** The marketplace rule works. The category rule almost never
fires, because of a real defect:

> Setup offers eight fixed choices (`Fashion & Apparel`, `Home & Kitchen`).
> A campaign's category is free text an operator types (`Apparel`, `Home/Decor`).
> Only `Home & Kitchen` exists on both sides.

**What is needed:** a second field on Campaign limited to those eight values. Not
a lookup table — that rots the first time somebody invents a label.
**How:** prompt 4.

---

## 11. Which notifications go to which user

**Q.** How do we decide who gets what?

**A.** Transactional: whoever the thing happened to. No decision.

Lifecycle: the rules table in §8, plus their categories for choosing which
campaign to mention, plus the weekly cap, the quiet hours and the opt-out.

**Status: NOT BUILT.** **How:** prompt 6.

---

## 12–17. The numbers you can already have

All of these are answerable **today** in the staff panel, under **Everyone →
Signing up**.

| Question | Where | Status |
| --- | --- | --- |
| How many people came to the app | Funnel, step 1 | **PARTLY** — needs prompt 1 and an app release |
| How many signed up | Funnel, "Account created" | **BUILT** |
| How many left signup incomplete | Funnel, drop-off column | **BUILT** from the code step onward |
| On what page they left | Funnel, "Most people stop at" | **PARTLY** — the pre-account screens need prompt 1 |
| How many were auto-locked-out | Sessions, "ran out unused" | **BUILT** |
| How many logged out on purpose | Sessions, "signed out" | **BUILT** |
| How many re-logins | Sessions, "signed in again" + rate | **BUILT** |

The panel also shows **code delivery rate** — codes asked for against codes
entered correctly. If that is under 90%, people who wanted Fayr could not get in,
and no product work fixes it. It is the first number to look at.

**What is missing:** the three steps before somebody asks for a code. Only the
app can report those. **How:** prompt 1, then an app release.

---

## 18. Per-user: which screen, at what time, everything

**Q.** Search a user and see every screen they reached and when.

**A.** This is the one thing genuinely not there, and prompts 2 and 3 build it: a
merged timeline per person, newest first, grouped by day, assembled from screens,
task state changes, support conversations, withdrawals, marketplace connections,
evidence uploads and lapsed sessions — with a summary saying first seen, last
seen, days quiet, and which setup step they stopped at.

**Status: NOT BUILT.** **How:** prompts 1, 2 and 3 in order.

**One thing to be clear about in the room:** it records **screens and meaningful
actions**, not every tap. Every tap would be millions of rows a week that bury
the answer, and a per-person log of every gesture is the kind of processing the
DPDP Act expects a stated purpose and consent for. Fayr already records consent
properly, with a version and a server-side timestamp; logging every tap without
extending that consent would undo that. If we want raw taps, it needs a consent
screen and a retention window — a decision, not a technical limit.

---

## What is blocking what

| Blocked on | Which items |
| --- | --- |
| **An app release** (1–2 weeks, unavoidable) | Screens before signup, all push notifications |
| **A decision from the founders** | Whether to record raw taps; the SMS budget for day-60 messages |
| **Nothing — can be built now** | Per-user timeline, the category fix, everything in §12–17 |

Nothing here is blocked on engineering capacity. Two of the three blockers are a
calendar and a decision.
