@AGENTS.md

# Fayr — product ground truth

Read this before writing code or copy. It is not inferable from the codebase.

## What Fayr is

A **standalone incentivized review and refund platform** for Indian e-commerce
marketplaces. A user claims a task, buys the product, reviews it, and once the
review is **publicly live** and the **return window has closed**, Fayr refunds
them the product amount.

Fayr is **entirely distinct from CashKaro** — no shared infrastructure,
branding, or language.

## Language rules — non-negotiable

- The app is always **"Fayr"**.
- Always **"refund"**. Never "cashback".
- **Zero CashKaro references** anywhere — code, comments, copy, commit messages.
- The GitHub repo is still named `ck_reviews`. That is legacy, a rename is
  pending, and it is **not** licence to reintroduce the term anywhere else.

## Verification model

    review publicly visible on the product page → verified
      → hold for return window → refund

**Public visibility is the signal.** We do **not** need to capture the
review-submission moment, and should not build toward that.

## Fraud model — the three loopholes the product must close

1. **Multi-account abuse** → UPI/bank dedup + PAN anchoring.
2. **Screenshot forgery** → tiered evidence, in strict order of authority:
   1. **DKIM-signed email** (primary — cryptographically signed by the
      marketplace, cannot be forged by the user)
   2. **Public scraping** (tier 2)
   3. **Screenshot / OCR** (tier 3, **supporting only** — never sole evidence)
3. **Review deletion after payout** → holding period aligned to marketplace
   return windows, plus clawback rights in the T&Cs.

### What each quick-commerce shop actually allows (measured 22 Sep 2026)

Loophole 3 is only worth what the shop makes possible, and the three are not the
same. Measured by the owner on the apps themselves:

| shop | the rating, once given | so loophole 3 is |
|---|---|---|
| **Zepto** | cannot be edited, cannot be removed | **structurally absent** |
| **Blinkit** | can be **edited**, cannot be deleted | present, as *change* not deletion |
| **Instamart** | can be **edited**, cannot be deleted | present, as *change* not deletion |

Two consequences, both load-bearing:

- On Zepto a hold that watches the review protects nothing. It is a delay with a
  safeguard's name on it, paid for by somebody waiting for their own money. The
  delivery-anchored window still applies — an order can still be cancelled, and
  the owner's own Cadbury order was.
- On Blinkit and Instamart "is it rated?" is **always true** and is the wrong
  question. The right one is whether it is *still* the rating they gave, so the
  **value** must be recorded and compared, not the presence.

The single source is `backend/src/tasks/engine/rating-mutability.ts`. A shop
nobody has measured is assumed to be the **most** mutable, never the least.

### And the written review on these three cannot be checked at all

It is private — invisible to other shoppers and unreadable by Fayr. Do not build
toward reading it, and do not let a report imply it was checked. The sentence
`WRITTEN_REVIEW_IS_PRIVATE` exists so the limit can be stated rather than left as
a silence, because an absent check looks exactly like a check that passed.

`VISIBILITY_CHECK` during `HOLDING` in `src/taskflow.js` is the direct
countermeasure to loophole 3 — it re-runs the public-visibility check so a
review deleted mid-hold is caught **before** the refund releases. Do not weaken
or shortcut it.

## Screenshot OCR verification (tier-3, supporting only)

OCR (Claude vision reads a user's screenshot) is a **producer of evidence
fragments into the existing task/evidence engine — never a parallel system**.
Non-negotiable invariants:

- **Supporting only, never sole evidence.** OCR is tier 3, below DKIM email and
  scraping. It validates "do the details match?", not "is the image authentic?"
  (a doctored screenshot can extract cleanly).
- **Never auto-approves.** Extraction + match produce a *pending* case; a staff
  member (**SUPPORT** role, ADMIN via super-role) must approve before any
  evidence is accepted or a task advances. No OCR path moves money on its own —
  the holding period + `VISIBILITY_CHECK` and FINANCE-gated withdrawal still apply.
- **The scraper is the primary path; OCR is the fallback.** Both feed one
  internal evidence funnel (`submitEvidence(taskId, fragment, {source})`); `'ocr'`
  is registered as the lowest-authority source. Do **not** modify the on-device
  scraper (`src/verify.js`, `extract.js`, `session.js`, `platforms.js`, the
  connect flow) — OCR only consumes/complements it.
- **Screenshots are private PII.** Stored outside the public `/uploads` space,
  reachable only through an RBAC-checked streaming endpoint (staff + owner).
  Every upload, extraction, staff view, and review decision is audited.

## Ticket economy

- Users start with **15 tickets**.
- **5 deducted** per claim.
- **Returned on expiry** if no purchase was made.
- **Consumed permanently** once purchase is confirmed.
- **10 returned** after full completion and withdrawal.

## Marketplaces

Target: **Amazon, Flipkart, Meesho, Myntra, Blinkit, Zepto, Instamart.**

Launch order: **Amazon first, Flipkart fast-follow.** Everything else is later —
do not spend effort on the rest unless asked.

## Architecture

- **React Native** frontend.
- **NestJS monolith** backend with **PostgreSQL**.
- **Python FastAPI** verifier service.
- **Mobile-number-only auth.** OTP via the **SMS Retriever API** — never
  `READ_SMS`, which is a hard Play Store constraint.
- Wallet is an **append-only double-entry ledger in integer paise**. Never
  floats, never mutate a posted entry.
- Task state transitions are **atomic and idempotent** through a **single
  `transition()` method** (see `src/taskflow.js`).
