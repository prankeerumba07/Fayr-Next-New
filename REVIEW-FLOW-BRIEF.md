# The back half: delivered → 24 hours → review → live review → return window → paid

Written 15 September 2026, ~23:45, against a demo at 09:30 on Thursday 17th.

## 0. The thing to decide first, before any of the rest

**Three of these steps are measured in DAYS and cannot be shown live.** 24 hours after
delivery, 48–72 hours for a review to go public, and a return window that runs for
weeks. A demo where somebody waits a day is not a demo.

So the first piece of work is not a screen. It is **one clock, in one place, that
every one of these waits is measured against**, and a way to make it run fast for a
walkthrough — the way `EXPO_PUBLIC_FAYR_WALKTHROUGH=1` already turns on the staff
tools. With it, 24 hours becomes 20 seconds and 72 hours becomes 30, the same code
runs in both, and the whole chain is demonstrable in five minutes.

Without it there is nothing to show on Thursday beyond the first two steps, however
much of the rest gets built.

## 1. What already exists — this is not a blank page

Screens, all present: `delivery.js`, `reviewguide.js`, `reviewproof.js`,
`returnwindow.js`, `underreview.js`, `orderverified.js`, `reward.js`.

Journey steps, all wired in `src/ui/journey.js`: `order-details` → `delivered` →
`review` → `review-shot` → `refund`.

Backend: `STATES.DELIVERED / REVIEWED / HOLDING`, a `REVIEW_PUBLIC` evidence source,
a `REVIEW_NOT_PUBLIC` reason, `review-check.response.ts`, and the permalink handling
in `task.service.ts` and `engine/transition.ts`.

**So most of this is a matter of connecting things that exist, not inventing them.**

## 2. Delivery is READ, never asked — and it is nearly free

The owner's rule: once the order is fetched, the person taps once and the backend
goes and checks that order for itself.

**It already has the page.** Measured on his own Amazon order, 15 September 2026, the
order page carries it in plain words:

    Delivered 8 June
    Lukzer | Heavy-Duty Metal Garment Rack …
    Return window closed on 19 June 2026

Two things are missing, and both are small:

**(a) The delivery date comes back null, and the reason is written down already.**
`order-text.ts` says Amazon prints the arrival with NO YEAR and that a date without a
year is refused rather than guessed. That was right when nothing else on the page was
being read. It is no longer: the ORDER date is now read off the same page
(`2026-06-02`), so the year is not a guess any more — it is the order's own year, and
a delivery that reads earlier than the order rolls to the next one. That is a rule
with one edge case (an order placed 31 Dec, delivered 2 Jan) and the edge case is
answerable from the same two dates.

**(b) The return window is on the page too** — "Return window closed on 19 June 2026",
with a year — and nothing reads it yet. It is the date step 6 waits for, sitting in
the text the server already receives.

Both are in `backend/src/ocr/order-text.ts`, both are fixtures away from proven, and
the fixture already exists: the real Amazon order page is in this repo's history from
tonight's work.

## 3. The 24 hours after delivery

A screen with a countdown and nothing to tap. The words the owner wants on it: use
the product, then give a fair review.

It is a *derived* state, not a stored one: `deliveredAt + 24h` against the one clock
from §0. Nothing to migrate, nothing to schedule, and a screen that recomputes on
every render cannot drift out of step with the server.

**The trap:** a countdown written with `setInterval` and a local `Date.now()` drifts,
and shows a negative number if the phone sleeps. It reads a target time and re-derives
on every tick; it never counts down a stored number.

## 4. The review step, and what the screenshot is actually for

Tap → Amazon opens → they write the review → they come back → "have you reviewed?" →
Yes → screenshot.

**The screenshot is not the proof and must not be described as one.** It is the thing
the link is checked AGAINST later, which is the owner's own design: the words in the
screenshot and the words at the permalink have to be the same review. `reviewproof.js`
and the OCR path already take screenshots and read them.

## 5. The wait, the link, and the keyword match

48–72 hours on Amazon. The person is told: you will get an email, or find it under
**Your Content** — open the product's card, the three dots, Copy link.

Then: "is your review live?" → Yes → paste the link → submit.

**What the server does with it, in order:**

1. The link is an ADDRESS and is checked as one before it is fetched — the shop's own
   review host, and nothing else. A pasted link is somebody else's text.
2. Fetch it. A review that is not public yet answers `REVIEW_NOT_PUBLIC`, which already
   exists as a reason.
3. **Match the words against the screenshot's words.** This is the owner's rule and it
   is the whole point: a link to somebody else's review, or to a different review by
   the same person, fails here. `order-comparison.ts` already has a loose-text
   comparison used for product names; the same idea, applied to review text.
4. The permalink also names the product, so it can be checked against the campaign's
   product the same way the order was.

**Say plainly what this cannot do:** it cannot prove the person wrote the review. It
proves a public review exists, that its words are the words they showed us, and that
it is on the right product. That is the honest claim and it is a strong one.

## 6. The return window, and only then the money

The date is on the order page (§2b). While it is open the task sits in `HOLDING` —
which already exists. When it closes, the review is fetched once more, and only if it
is still public does the payout go.

**The re-check is the point.** A review pulled down the day after the refund is exactly
the fraud this whole flow exists to stop, and re-reading at the end is the only thing
that catches it.

## 7. What can honestly be ready by 09:30 Thursday

Ready, if the clock in §0 is built first:

  - delivery read from the order page, for real, no asking          (§2)
  - the 24-hour hold with its countdown                             (§3)
  - the review redirect, the return, the screenshot                 (§4)
  - the link submitted, checked for host, fetched, words matched    (§5)
  - the return window read from the page, the hold, the payout      (§6)

**Not ready, and should not be claimed on Thursday:**

  - any of it proven over real elapsed days. Everything above will have been
    exercised against a fast clock. The logic is the same; the waiting is not.
  - Amazon's email as a signal. It is mentioned to the person as a thing they will
    receive; nothing reads it.
  - the other five marketplaces. Zepto answers the review question differently and
    cheaply — its order page says "You rated:" — and that is worth saying out loud
    as evidence the design generalises, but it is not built either.

## 8. The order to build it in

1. The one clock, and the fast-forward switch.                       (§0)
2. Delivery date + return window date out of the page it already has. (§2)
3. The 24-hour screen.                                                (§3)
4. Review → screenshot, wiring screens that already exist.            (§4)
5. Link → host check → fetch → word match.                            (§5)
6. Return window → re-check → payout.                                 (§6)

1 and 2 are the two that make Thursday possible. If everything after 4 slips, the
demo still shows a purchase found by itself, a delivery confirmed by itself, and a
review flow a person can walk through — which is the claim being made.
