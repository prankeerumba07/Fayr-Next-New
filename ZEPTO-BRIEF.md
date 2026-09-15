# Zepto, end to end — what is measured, what is left

All facts below were read off the owner's own signed-in Zepto account in Chrome
on 15 September 2026. Nothing here is guessed from markup we have not seen.

## 1. What Zepto's pages actually are

**The order list** — `https://www.zepto.com/account/orders` (zeptonow.com 301s to
zepto.com; the address already in `ORDER_LIST_PAGES` is the right one).

Drawn by the page's own code, like Amazon's. Eight orders. Each row carries the
status (`Order delivered`), the amount (`₹454`) and the day (`Placed at 31st Aug
2026, 09:20 pm`) — **and no product name at all**, so the list alone can never
match a campaign.

The only stable marker on a row is an **overlay anchor**:

    <a href="/order/01a0397a-bbb4-7cd7-b611-0e68227a15f1?isArchived=false">

Eight of them, one per order. `a[href^="/order/"]`. They are EMPTY — the anchor
sits over the card rather than wrapping it, so `innerText` on the anchor is `""`
and it is a MARKER ONLY, never a source of text. There are no test ids on the
cards; every class is a Tailwind hash. Do not write a class selector.

**The order page** — `https://www.zepto.com/order/<uuid>?isArchived=false`.
Also drawn. Carries everything the read exists to produce:

    Order #JMOKSGSNP94115 / 6 items / Delivered
    <name> / 1 pc (50 ml) / 1 unit / ₹77 / ₹110      <- paid, then struck
    ... five more ...
    Bill Summary / Item Total / ₹1699 / ₹1079
    Delivery Fee / ₹30 / FREE
    Total Bill / ₹1739 / ₹1079                       <- struck, then paid
    Order Details / Order ID / #JMOKSGSNP94115
    Order Placed at / 25 Aug 2026, 8:42 PM
    Order Arrived at / 25 Aug 2026, 9:02 PM

`Order Arrived at` is on the page. **The delivery question is answered by the
order page itself** — there is nothing to poll for and no daily job needed to
know a Zepto order arrived.

## 2. Two ways in that are already ruled out — do not spend a day on either

**A same-origin iframe does not work.** Tried from the orders page itself, at
`left:-9999px` and again at 1000x900 visible: the frame loads, the SPA hydrates
(header and profile menu draw, 493 nodes), and the ORDER BODY never appears.
361 characters, no `Order #`. Both positions. So the "one page load, many
frames" shape is not available here.

**The server does not render it.** `fetch('/order/<uuid>?isArchived=false',
{headers:{RSC:'1'}})` answers 200, `text/x-component`, 187,178 bytes, and
contains neither the order number nor any product name. There is no server
rendered copy to fetch.

**The JSON API needs a header we could not find.** The page calls
`https://bff-gateway.zepto.com/api/v2/order/?page_number=1`. Called with
`credentials:'include'` it answers `401 {"code":401,"message":"Token not
present"}`. The token is in no localStorage key, no sessionStorage key, no
readable cookie and no window global. Worth another look one day; not the path
for Thursday.

**So the view must NAVIGATE to each order page and wait for it to draw.** That
is the same shape `drawnList.js` already implements for Amazon's list — applied
to a detail page, several times, in one look.

## 3. The work, in the order it unblocks the demo

### (a) The connect gate says FAILED where it should say CANNOT TELL

From `.local-logs/zepto.log`, 19:31 and 19:35 runs, three attempts each:

    PAGE SAID {"fieldIsThere":false,"signInControlIsThere":false,
               "signOutIsThere":false,"looksLikeAGreeting":false,
               "path":"/account/orders","looksInARow":2,"greeting":""}
    PAGE SAID — NO SIGNAL IN IT   weSawASignIn=false
    (nothing at all for the next thirteen seconds)
    GATE opening -> failed because ranOutOfTime [15082ms of 15000]

This is NOT the "Please Login" case the uncommitted change in the working tree
fixes — `signInControlIsThere` is **false** here, and the greeting is empty.
It is a third state: the watcher reported twice, the facts never changed again
for the whole fifteen seconds, and every one of the five signals was false.

`whatThePageShows` answers null, so `shopHasAnswered` is never set, so the latch
never arms, so the clock bites and the person is told "The shop did not open."
He cannot get past it.

The page DID answer. It answered "nothing conclusive", twice, steadily. That is
CANNOT_TELL — the state that already exists, that already carries "Show me the
shop", and that already lets a person look with their own eyes. A gate that
cannot tell must not say the shop refused.

What is needed is one new fact carried from our own side into `whatDecidedIt`:
the page has posted facts at all (`looksInARow >= LOOKS_IN_A_ROW_BEFORE_WE_ASK`
on any look this attempt), separate from `shopHasAnswered`, which means
something narrower. When the time runs out and the page HAS spoken, the reason
is the quiet-shop one (-> CANNOT_TELL), not `BECAUSE_TIME_RAN_OUT` (-> FAILED).
A shop that never posted anything still fails at fifteen seconds, unchanged.

The exhaustive tables over states and reasons will need the new path; that is
the point of them.

### (b) Zepto joins the drawn list, with its own marker

`SHOPS_WHOSE_LIST_THE_PAGE_DRAWS` gains `zepto`. The two things the wait counts
are Amazon's (`a[href*="orderID="]`, `[data-csa-c-slot-id]`) and cannot match a
Zepto row, so the wait would run to its deadline every time and report
`drew=false`. They have to become per shop. Zepto's is `a[href^="/order/"]`,
measured: eight on his list page, zero on the shop's home page.

### (c) Zepto joins the one-order-at-a-time read, with its own two shapes

`SHOPS_READ_ONE_ORDER_AT_A_TIME` gains `zepto`. Both Amazon shapes are wrong for
it and both are hard-coded:

    ORDER_NUMBER_SHAPE     /^\d{3}-\d{7}-\d{7}$/      Zepto: a uuid in the href,
                                                      and JMOKSGSNP94115 on the
                                                      page itself
    AMAZON_ORDER_DETAIL_PAGE  .../order-details?orderID=
                                                      Zepto: /order/<uuid>?isArchived=false

The rung that answers for Zepto is the order's own link, which `harvestRendered`
already has as its second rung — it is the PATTERN that is Amazon's, not the
idea. Zepto's: `href="/order/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"`.

### (d) The order pages are navigated to, not fetched

`askAgain(url)` injects `buildOrderListScript`, which does a `fetch`. On a drawn
page that returns a frame with nothing in it — the same bug as the list, one
level down. For a drawn shop each order page has to be a real navigation of the
view, waited for the same way the list is, and read.

Send the drawn page's **innerText**, not its markup. `parseOrderText` on the
server was validated this afternoon against exactly that text and reads all six
fields off it. Markup would work through `pageToLines` too, but innerText is
what has been proven.

### (e) The time ceiling

`MOST_TIME_MS = 20000` covers one list draw and six fetches. It does not cover
one list draw plus several page draws. Either cap the order pages for a drawn
shop (two is enough for the demo: the order looked for is the newest) or raise
the ceiling for drawn shops and say so on the screen.

## 4. Already done, on the server (commit 615199f)

`parseOrderText` had never been run against a page Zepto draws. It was wrong in
four fields of five: no order date, no delivery date, the STRUCK total (₹1739
for an order that cost ₹1079), and six products every one of them named
"1 unit". Fixed, with both real pages as fixtures. `./check` is still owed — the
jest preset does not resolve on the mounted copy, so it was typechecked only.

After the fix, on the real page, straight out of `parseOrderText`:

    orderNumber   JMOKSGSNP94115
    orderDate     2026-08-25
    deliveryDate  2026-08-25
    totalPaise    107900          itemTotalPaise 107900
    items         6, named, at the prices actually paid

## 5. The thing no code can fix

`matchOrderToCampaign` matches on **name containment** and an **exact** price.
The two ACTIVE Zepto campaigns are:

    Homesake Matt Black Twister Metal Bedside Lamp        ₹676
    Boldfit Strapless Sports Headband                     ₹149

Neither is in any of the eight Zepto orders on his account. Every one of those
eight was read today. So there is nothing for the demo to match unless he buys
one of the two, and the price has to come to ₹149 or ₹676 EXACTLY — any coupon
or discount and the server answers `price_differs`, correctly.

---

# Addendum, 15 September 2026, evening — the campaign order was there all along

Section 5 above was wrong, and the owner was right. The order list loads eight at
a time behind a **"Load More"** button. Seven presses loads all 64 orders, back to
November 2024. Any read that stops at the first eight sees four weeks of history.

**The Boldfit headband order exists: `#SOSIJGGRL26770`, placed 21 July 2026.**

    Order #SOSIJGGRL26770 / 2 items / Shipment 1 / Shipment 2 / You rated:
    SHIPMENT 1 / Delivered / 1 item in shipment
    Boldfit Strapless Sports Headband | Versatile Gear for All Sports
    1 pc / 1 unit / ₹149 / ₹325
    SHIPMENT 2 / Delivered / 1 item in shipment
    Hammer Nova In Ear C Type Earphones ... / 1 pc / 1 unit / ₹219 / ₹999
    Item Total / ₹1324 / ₹368      Total Bill / ₹1364 / ₹368
    Order Placed at / 21 Jul 2026, 5:07 PM
    Shipment 1 Arrived at / 21 Jul 2026, 5:32 PM
    Shipment 2 Arrived at / 21 Jul 2026, 5:46 PM

Straight through `parseOrderText` and then `matchOrderToCampaign` against the live
campaign (Boldfit Strapless Sports Headband, 14900 paise):

    matches  true      reason  matched
    item     Boldfit Strapless Sports Headband | Versatile Gear for All Sports
    price    14900 paise, exactly the campaign's
    order    SOSIJGGRL26770   placed 2026-07-21   arrived 2026-07-21

**The server side of this demo is done.** Given the text of that page it produces
the order number, the placed date, the arrival date, the amount, and a matched
product. Nothing further is needed from the backend.

## Two more things the page taught us

**An order in two parcels never writes "Order Arrived at".** It writes
"Shipment 1 Arrived at". That was missed, so the delivery date was null on the
very order the demo is for. Fixed. Also the drawn page names the same two
shipments SIX times — a tab each, a heading each, an arrival line each — so
shipments are now counted by NUMBER rather than by line, which reads both this
and the screenshot layout ("Shipment 1 of 2") as two.

**Rated and unrated orders are told apart in plain text**, which is the whole of
review verification for this shop:

    unrated  the order page carries  "Rate Order"       (25 Aug, 23 Aug orders)
    rated    the order page carries  "You rated:"  and NO "Rate Order"
             and the list row carries "Your delivery experience rating:"

So checking a review on Zepto is the SAME read run again later. There is nothing
new to build for it once the read works — which is worth knowing before anyone
designs a separate review-checking path for this shop.

## What this changes for the app work

Nothing in sections 3(a) to 3(e) — all still needed. One thing is ADDED:

**(f) The list stops at eight.** `MOST_RECENT_ORDERS = 20` cannot be reached on
Zepto without pressing "Load More". For the demo the campaign purchase is the
newest order, so the first eight are enough and this can wait. It cannot wait
for a real user who buys something and then buys eight more things before the
look runs.
