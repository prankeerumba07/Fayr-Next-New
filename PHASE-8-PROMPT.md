# PHASE 8 — FAYR WATCHED THE PURCHASE, SO FAYR ALREADY KNOWS THE ORDER

Written 18 September 2026, from ONE REAL PURCHASE made by the owner inside the
Fayr web view. Every fact below was measured that evening. Nothing here is a
guess, and where something is still unmeasured this prompt says so instead of
filling it in.

---

## THE OWNER'S WORDS, WHICH ARE THE REQUIREMENT

> "The purchase is being completed inside the Fayr app, so you should be able to
> fetch that order, right?"

> "I want you to fetch each and every detail from each and every screen a user is
> going to."

> "I don't want the manual thing. I am trying to eliminate all the manual
> processes that a user will follow."

> "Once a user clicks it and redirects from our app, that is the only day the
> user has to complete the purchase, so you have to check a maximum of 10 days'
> past orders."

---

## WHAT HAPPENED, MEASURED

The owner claimed a Zepto campaign, bought the product inside the Fayr web view,
and came back. Fayr did not notice, and then could not find the order.

### The web view saw the order one second after payment

    19:38:34  /account/support/01a0b4d7-870c-7dca-b701-e038477c5106?order-related-faq=true   title="none"
    19:38:35  /order/status/01a0b4d7-870c-7dca-b701-e038477c5106   title="Everything delivered in minutes* | Zepto"
    19:38:37  /order/01a0b4d7-870c-7dca-b701-e038477c5106?child=true   title="none"

The order's own identifier was in the address the whole time.

### And answered NOT_PLACED on its own confirmation page

    ORDER? said=NOT_PLACED rule="an order's own page or the order list, not a new order"
           url=https://www.zepto.com/order/status/01a0b4d7-870c-7dca-b701-e038477c5106

`src/shop/insideFayr.js` carries `notAFreshOrder: ['/account/orders', '/order/']`.
Zepto's confirmation address contains `/order/`, so the guard that exists to stop
FALSE purchases swallowed the REAL one.

That file already predicted this in its own comment:

> "THE KNOWN COST, WRITTEN DOWN: if Zepto's checkout turns out to land straight on
> /order/<uuid> — which plenty of shops do — this rule suppresses the real signal
> and the person taps 'Did you buy it?' instead. That is the shy direction, on
> purpose, and the log will say within one purchase whether it is what happens."

One purchase has now said it. It is what happens.

### Zepto's title is useless, so the address is the only signal

Every title seen on every order page that evening was either `"none"` or
`"Everything delivered in minutes* | Zepto"`. Zepto never writes "order placed"
in a title. `titleSays` can never fire for this shop.

### The history search then read six orders, none of them his

    [fayr-look] list  rows=8/0  nodes=186/418
    [fayr-look] rows  sightings=0 text=0 attr=0 inCode=0 distinct=0
    [fayr-look] numbers  linked=7 opening=7 how=link
    [fayr-look] detail n=6 ... looked=false
    orders-found judged=6 matched=0 reasons=[product_name_not_found x6]

Eight rows on the list. Seven links found. Six orders stored. The stored six were
noodles, eggs, pasta, a razor and cooking oil — every one of them an OLD order.
The order just placed was never read: a just-placed order is a live TRACKING page,
not a finished receipt, and the reader only knows the finished shape.

### Two different identifiers, and they must not be confused

* The address carries a UUID: `01a0b4d7-870c-7dca-b701-e038477c5106`
* The page prints an order number: `JKLIKGSNS48449`, `SRNHRGSNP81193`, ...

`tasks.orderId` is documented as "the marketplace order number" and the refund
gate reads it to stop one purchase being paid twice. The UUID is an ADDRESS KEY,
not an order number. They are not interchangeable and neither may be written into
the other's column.

### And the product name in the campaign was typed, not measured

    campaign productName = "Lakme 9 To 5 Cc Cream Beige With 3% Niacinamide Complex Spf 30 Pa++"

Title-cased from the web address. Zepto writes full catalogue names, measured on
the owner's own orders that evening:

    "WhiteTone Pearl Face Powder, Glowing Daily Care with Sun Protection"
    "Nissin Geki Spicy Maxx Korean Ramen Noodles"
    "Disano Spaghetti Pasta, Durum Wheat, No Maida"

`sameProductName` in `backend/src/ocr/order-comparison.ts` has no tolerance by
design. A typed name will fail against a measured one for ever.

---

## THE SHAPE OF THE FIX

The order read was built for Amazon, where Fayr never sees the purchase and
searching the history is the only way. The shop now runs INSIDE Fayr. Searching
is no longer the main path and must stop being it.

    BEFORE   purchase -> (nothing recorded) -> open the order list -> read 8 rows
             -> open 7 old orders -> compare all of them -> find nothing

    AFTER    purchase -> record THIS order's address key -> open THAT ONE order
             -> read it -> the server judges it
             (the list search survives only as a fallback, and bounded)

---

## STANDING RULES — NONE OF THESE BEND IN THIS PHASE

* THE PHONE'S DETECTION IS A TRIGGER. THE SERVER DECIDES. Nothing added here lets
  the phone assert that an order matched, what it cost, or that anything is owed.
  The phone reports what it SAW at an address. The server reads text and judges.
* NOTHING ON THE PHONE MOVES MONEY.
* NO ADDRESS IS WRITTEN IN `src/shop/`. `insideFayr.js` is refused by its own
  check if an http address appears in it. Path FRAGMENTS to recognise are fine;
  domains are not. The domain lives once, in the frozen `platforms.js`.
* NO MEASUREMENT, NO GUESS. Blinkit and Instamart have EMPTY order tables and must
  keep them. Nobody has watched either shop place an order. An empty table answers
  CANNOT_TELL and must never answer NOT_PLACED or PLACED.
* PURE/IMPURE SPLIT. Every decision goes in a pure function with its own test file
  runnable under node. Screens do the doing, not the deciding.
* STRIP COMMENTS BEFORE MATCHING. Any check that greps source must strip comments
  first. This project has been caught eleven times by a check that passed because
  the phrase it wanted was sitting in a comment.
* MUTATION TESTING. For each task: break it, run `./check`, confirm a NAMED check
  fails, restore. A crashed suite is not a catch. A SIGSEGV is not a result.

---

## FROZEN FILES

Frozen: `src/platforms.js`, `src/ConnectScreen.js`, `src/connect/`, `src/order/`,
`src/orderhistory.js`, `src/openShop.js`, `src/ui/shopApp.js`, `src/session.js`,
`src/taskflow.js`.

**The owner has approved unfreezing `src/order/LookingForItScreen.js` FOR THIS
PHASE ONLY, for Task 3.** No other file under `src/order/` may be touched.
`detailLook.js`, `drawnList.js`, `rowShape.js`, `pageShape.js` and
`deliveryLook.js` stay exactly as they are — they are the measured readers and
they work; tonight's six stored orders are the proof.

Report the frozen list at the end showing `LookingForItScreen.js` as the only
entry and every other frozen path clean.

---

## TASK 1 — TEACH THE SHOP WHAT ZEPTO'S PURCHASE ACTUALLY LOOKS LIKE

Files: `src/shop/insideFayr.js`, `src/shop/theOrderPlaced.js`

1a. Rewrite Zepto's `orderPlaced` table from the measurement above. Delete the
    comment block that says nobody has measured it and replace it with what was
    measured, dated, with the order's address shapes quoted. Keep the labelled
    guess wording for Blinkit and Instamart untouched.

1b. The guard must stop swallowing the real signal. The three shapes seen are:

        /order/status/<uuid>     a live order — this IS the confirmation
        /order/<uuid>            an order's own page — may be old
        /account/orders          the list — never a purchase

    `notAFreshOrder` must continue to cover `/account/orders` and a bare
    `/order/<uuid>`, and must NOT cover `/order/status/`. Order of the rules is
    load-bearing and already documented in `whatTheOrderPageSays` — keep it.

1c. A new PURE function that reads the order's address key out of an address,
    with its own test file:

        theOrderKeyInTheAddress(key, url) -> string | null

    Path fragments only, from the shop's own row. Null for a shop with no
    measured shape, null for a key that is not `^[A-Za-z0-9._-]+$`. Refuse
    anything with a slash, a query or a space in it — the same rule
    `theOrderPage.js` already applies, and for the same reason: a record must
    never be able to steer the view somewhere else on the shop.

1d. `whatTheOrderPageSays` answers `{ said, because, orderKey }`. `orderKey` is
    null unless `said === PLACED`. Existing callers that read `said` and
    `because` keep working unchanged.

Tests: a real Zepto confirmation address answers PLACED with the UUID; the order
list answers NOT_PLACED; a bare `/order/<uuid>` answers NOT_PLACED; Blinkit and
Instamart answer CANNOT_TELL with `NOTHING_MEASURED_YET` for every one of those.

---

## TASK 2 — RECORD THE ORDER THE MOMENT IT IS SEEN, WITH NO TAP

Files: `src/shop/ShopScreen.js`, `src/journey/shopVisits.js`, backend evidence path

`ShopScreen.js:351` currently reads `if (out.said === PLACED) setOrderSeen(true);`
— a boolean, and the key is dropped on the floor.

2a. When `said === PLACED` and `orderKey` is not null, record the key against the
    task and send it to the server ONCE. Idempotent: the same key arriving twice
    is the same fact, not two.

2b. It goes through the EXISTING untrusted device-evidence channel, not a new
    privileged one. The body says what the phone saw and where. It does not say
    what was bought, what it cost, or that anything matched.

2c. THE KEY IS AN ADDRESS KEY, NOT AN ORDER NUMBER. It must not be written into
    `tasks.orderId`. Add its own nullable column, e.g. `watchedOrderKey`, with a
    comment saying plainly that the UUID in Zepto's address and the
    `JKLIKGSNS48449` printed on the page are different identifiers and why
    conflating them would break the refund gate's duplicate check.

2d. The bar says "Order placed" as it already does. No new screen, no new tap.

---

## TASK 3 — READ THAT ONE ORDER, NOT THE LIST

File: `src/order/LookingForItScreen.js` (unfrozen for this task only)

3a. When the task has a `watchedOrderKey`, build that one order's address with the
    existing `theOrderPage(shape, orderId)` and the shape from the frozen
    `detailLook.js`, read that page, and post its text through the existing
    `sendFoundOrders(taskId, pages)`. One page. No list, no Load More, no link
    collecting.

3b. When there is no key, the current list search runs exactly as it does now,
    subject to Task 4.

3c. A live tracking page that cannot be read yet is NOT a failure. It means the
    order exists and has not settled into its finished shape. Look again on the
    existing cadence in `src/journey/deliveryCadence.js`
    (`LOOK_AGAIN_AFTER_MS = 10 minutes`) rather than falling back to the list —
    falling back is what read six strangers' worth of noodles tonight.

3d. The decision of WHICH path to take is pure, in its own file, with its own
    tests. The screen calls it. The screen does not contain the reasoning.

---

## TASK 4 — THE FALLBACK STOPS AT THE OWNER'S RULE

Files: the pure decision file from Task 3, `src/shop/loadMore.js`

The owner's rule, verbatim:

> "Once a user clicks it and redirects from our app, that is the only day the user
> has to complete the purchase, so you have to check a maximum of 10 days' past
> orders."

4a. The fallback considers only orders placed on or after the day the claim was
    made. An order older than that cannot be this claim's purchase.

4b. A hard outer bound of 10 days regardless. Both numbers named once, in one
    pure file, with the owner's sentence quoted beside them.

4c. Stop pressing Load More as soon as the rows on screen are older than the
    bound. `PRESSES_AT_MOST` stays as the other end of the same stop.

4d. An order page whose date could not be read is NOT assumed to be in range.
    Unknown is unknown — it is skipped and counted in the log, the same way the
    reader already refuses to invent a year.

---

## TASK 5 — DELETE THE PURCHASE SCREENSHOT WHEN THE ORDER IS KNOWN

File: `src/ui/journey.js`

The owner: "I don't want the manual thing."

5a. When the task has a `watchedOrderKey`, the `purchase-shot` step does not
    appear. Fayr watched the purchase; asking for a photograph of it is the
    manual work this phase exists to remove.

5b. When there is no key, the step stays exactly as it is. It is the honest
    fallback for a shop Fayr does not run inside.

5c. The journey step count changes. Update it and its tests deliberately, not by
    loosening an assertion.

---

## TASK 6 — THE PRODUCT NAME, MEASURED AND NOT TYPED

No code change. A data step, and a written rule.

6a. The exact name is already obtainable by measurement. With the shop open inside
    Fayr on the product's own page, the log prints it:

        [fayr-shop] THE PAGE REPORTED url=... title="<the shop's own words>"

6b. Set the campaign's `productName` from that string, character for character.

6c. Write the rule down where campaigns are created: `productName` is the SHOP'S
    OWN NAME for the product, copied from the shop. It is never typed from a web
    address. `sameProductName` has no tolerance on purpose — the staff side has
    the bands and prints them out loud — so a typed name fails for ever and fails
    silently after somebody has already paid.

---

## WHAT DONE LOOKS LIKE

* `./check` green across all five areas, with the numbers printed.
* Both typechecks clean.
* Frozen list showing `src/order/LookingForItScreen.js` as the ONLY touched
  frozen path, everything else clean.
* One mutation per task: what was broken, which NAMED check failed, restored.
* Every new decision in a pure file with a node-runnable test beside it.
* Blinkit and Instamart still answer CANNOT_TELL for every address, proven by a
  test that would fail if either table ever stopped being empty.
* The log lines this phase adds named, so the next real purchase measures the
  next unknown instead of guessing at it.
