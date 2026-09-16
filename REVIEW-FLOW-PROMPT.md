# The review half of the journey, as the owner specified it

Written 16 September 2026, from the owner's own words, after the order read was
made to work end to end on two different Amazon products.

**Read this whole file before writing anything.** Then implement it. Do not
redesign it — every numbered step below is the owner's, not a suggestion. There
is nothing in here left open; do not come back with questions before starting.

---

## Standing rules. None of these bend for any step below.

- Money is whole paise with an append-only double-entry ledger. **Never weaken a
  money rule.** A refund is NEVER computed from an order total.
- **No tolerance and no rupee band anywhere in matching.** Equality or nothing.
- **Do NOT modify the on-device scraper**: `src/verify.js`, `src/extract.js`,
  `src/session.js`, `src/platforms.js`, or the connect flow. They are frozen.
- **Fayr NEVER types into a shop's page.** No form fill, no keypress, no tap on
  any shop control. Fetching an address is fine; the words may go in the address.
- The fast demo clock must stay impossible to enable in production.
- Screenshots and mobile numbers are PII. They never reach a log line.
- `./check` must be green on all five areas when you are done.
- Every non-obvious decision gets a comment saying what was MEASURED and when,
  in the style already used throughout this codebase. No comment may state a
  fact that was not observed.

---

## What already exists. Extend it; do not rebuild it.

- Journey steps live in `src/ui/journey.js` — `journeyStepFor` and the `JOURNEY`
  list. Today's keys: `connect`, `buy`, `returncatch`, `purchase-shot`,
  `checking`, `order-details`, `delivered`, `review`, `review-shot`, `window`,
  `refund`.
- Screens are in `src/screens/` and `src/order/`. `returncatch.js` is already the
  "have you bought it?" screen. `reviewguide.js` is the "go and write it" screen.
- Coming back to the app is already detected: `src/foregroundRefresh.js`,
  `shouldRefreshOnForeground`.
- Notes about what somebody has already done are in `src/journey/shopVisits.js`,
  filed under the CLAIM (not the offer — see its own comment for why).
- Every sentence a person reads comes from `src/ui/journeyWords.js`. Screens name
  their words; they never hold copies. There is a check that enforces this.
- The order read is `src/order/LookingForItScreen.js`; the review read is
  `src/order/LookingForReviewScreen.js`. Both work now. Do not rewrite them.

---

## A. The refund wording is wrong, and it is the first thing to fix

Today the app shows the person a button reading **"Release ₹4,495.50 to wallet"**
(`src/ui/stages.js`, `src/ui/timeline.js`, `src/ui/reward.js`).

"Release" is an operator's verb. **A person does not release their own refund.**
The scheduler does it, gated on eligibility, and by the time anybody sees this
screen the decision has already been made.

What the person should see, once the review is confirmed live AND the return
window has closed AND the re-check has passed:

> **Refund confirmed.** Your review is live and the return window has closed.
> **₹4,495.50 has been added to your wallet.**

No button. Nothing to tap. The money is already there.

Keep the staff-side "Release refund" action exactly as it is in the admin panel —
that is an operator doing an operator's job, and it is correctly worded there.

---

## B. The flow, step by step, in the owner's own order

1. **Claim the campaign.**
2. **Connect the marketplace.** When it is connected, the next screen appears by
   itself — no tap.
3. **Buy the product.** The button reads **BUY ON AMAZON →** (already done).
4. They tap it and go to Amazon.
5. **When they come back to Fayr — even after ten seconds, even without force
   quitting — the app must already know they went.** It shows:
   **"Have you purchased the product?"** with **Yes** / **Not yet**.
   This must work on a plain foreground return. Use
   `shouldRefreshOnForeground`; do not invent a second mechanism.
6. **Yes** runs the order read automatically and fetches the order details.
   (This works today. Do not touch it.)
7. They confirm it is their order. The app says:
   **"Thank you for confirming. Once your product is delivered, use it and give
   a fair review."**
8. **When they come back next**, the app asks: **"Is the product delivered?"**
   with **Yes** / **No**.
9. **Yes** reads the delivery off the shop's own page. (Works today, including
   the case where the page states only a return window — see
   `theDeliveryFragment`.)
10. A short celebration: **"Product delivered."** for **3 to 4 seconds**, then
    the next screen by itself. (He first wrote "34 seconds" and corrected it the
    same evening: three to four. Nothing to ask about — build three to four.)
11. Then: **"Write a fair review after using the product."**
12. **The review step is LOCKED for 24 hours after delivery.** Show a lock on it.
    It opens by itself when the 24 hours are up — no tap, no refresh needed.
    The 24 hours are measured from the DELIVERY instant on the record, which is
    the server's word and not the phone's.
13. After it unlocks, they open the campaign card, tap through to Amazon, and
    write the review.
14. **Record that they went.** When they tap through to the review page, the
    backend must know they left for the review — the same way the shop visit for
    buying is recorded. It belongs on the record, not only on the phone.
15. **When they come back — again, after five or ten seconds, without force
    quitting — the app asks: "Have you posted the review?"** with **Yes** / **No**.
16. **On Yes**, the app does NOT immediately claim failure. It shows:

    > **Amazon reviews go live 48 to 72 hours after they are submitted.**
    > Wait for that time and Amazon will send you a confirmation. Once you have
    > it, come back to the app and continue.

    with two choices: **Still want to continue** and **I'll do it later**.
17. **Still want to continue** runs the review read anyway. If it finds nothing,
    it says the same thing again, but now naming what it knows: they posted it at
    such a time, it takes 48–72 hours, please wait.
18. That screen must clearly state the waiting period. It is not an error.
19. **When they come back later**, the screen must NOT repeat the first-time
    message. It knows they have already been told and already tried.
20. Instead it reads: **"Review confirmation received. Have you posted the
    review?"** with **Yes** / **No**.
21. **Yes** runs the review read, finds it, and the journey continues.

---

## C. Then the money, which already has its rules

- The review is confirmed live BEFORE the return window closes.
- When the return window closes, the backend runs the SAME check again to see the
  review is still on the product page — not deleted, not removed, not edited away.
- Only if that second check passes does the refund release, and then the person
  sees section A's wording. **Do not weaken either check.**

---

## D. How to decide anything this file does not answer

**Measure it. Do not guess.**

The whole of 16 September 2026 was lost to guesses that looked reasonable:
a campaign name read off a listing instead of off the order page; a reader
reasoned about against a page's innerText when the app sends something else
entirely; a page marked as needing to be drawn when it answers 400 unless it is
fetched. Every one of those was found in minutes once something actually looked
at what the shop sent.

`.local-logs/run.log` now keeps every `[fayr-look]` line. Use it.

---

## E. Done means

- Every screen above reachable in the app, in this order, on a real claim.
- Tests for each new rule, in the style of the existing ones: a named check that
  states the measurement it comes from.
- Break each new rule deliberately and confirm a named check catches it. A crash
  is not a catch.
- `./check` green on all five areas.
- Nothing in the frozen list touched.
