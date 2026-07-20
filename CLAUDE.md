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

`VISIBILITY_CHECK` during `HOLDING` in `src/taskflow.js` is the direct
countermeasure to loophole 3 — it re-runs the public-visibility check so a
review deleted mid-hold is caught **before** the refund releases. Do not weaken
or shortcut it.

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

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).
