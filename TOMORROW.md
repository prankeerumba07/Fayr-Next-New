# Tomorrow — 22 September 2026

Written at the end of 21 September so that "continue" actually continues, even
in a fresh conversation that has none of yesterday's context.

## Start everything

```bash
cd ~/FAYR-Next && ./start
```

That is the whole of it. It brings Docker up if it is down, applies any database
change, starts the backend on 3001, serves the staff panel on 8091, and starts
the app for the phone. Nothing was lost overnight: the database lives in a Docker
volume (`backend_fayr-pgdata`) that survives a shutdown, and every commit is on
this laptop plus a verified backup in `~/Fayr-Backups/`.

## Where things actually stand

Committed and working yesterday:

- A cancelled or returned order now **stops the task, returns the five tickets
  and frees the seat**, and the same person may claim again while a slot is open
  (`b0a6f1c`). A maintenance sweep closes any that slip past the evidence path.
- The offer page's **back arrow** was drawn inside the status bar, so taps went
  to the system clock and nothing happened. It carries its own inset now and
  goes Home. "Back to the offer" was pushing a *second* offer page each time;
  it uses `popTo` now (`b574c99`).
- The Instamart claim was released, so the card reads **Claim**, not Continue.

## The three open things, in order

### 1. The keyword on the shop bar is the small line, and it should not be

`src/shop/theBar.js` draws the campaign's `productName` as the headline and the
admin's hand-written `searchKeyword` as a smaller line under it. The owner read
the headline and typed it into Swiggy — sixteen hand-typed queries between 16:13
and 20:42 on 21 Sep, all variations of the long name.

Nothing in `src/shop/` types into a shop's search box; there is no code that
builds a `?query=` URL. So this is a copy and emphasis fix, not a WebView fix.

- campaign row: `productName` = "BLA BLI BLU Selfmade Perfume for Men"
- campaign row: `searchKeyword` = "bla bli blu perfume"

`theBar.js:40-41` already argues the keyword must never fall back to the product
name. The current layout defeats that intent by making the product name louder.

### 2. Is the perfume even orderable from the WebView's store? — NEEDS ONE LOOK

The word **"Selfmade" appears in no Instamart page we measured.** Every search
returned *Gift Set for Him*, *Gift Set for Her*, *Women Perfume Gift Set*,
*Love Drunk* — never the campaign's product. The same pages carried "Share
location to find the closest Instamart store" and "Re-check your address to see
if we deliver to your location".

Instamart stock is per dark-store. The live hypothesis is that the WebView's
restored session resolves to a **different store** than the standalone Swiggy app
and the laptop browser — which would explain finding it everywhere except here,
identically on simulator and phone, since both restore the same saved cookies.

**The measurement that settles it:** open the shop through Fayr and read the
delivery address in Instamart's own header; compare it with the address in the
standalone Swiggy app. If they differ, no code change would ever have fixed this.

### 3. Instamart can produce no product verdict at all

The red "wrong product" signal the owner asked for **already exists and is fully
wired**: `TONE[BAR.WRONG]` is `'bad'`, and `ShopScreen.js` maps `'bad'` to
`COLOR.red`. There is also no animation anywhere in the shop flow — the "blink"
is the bar's background colour changing.

What is actually broken: on Instamart **neither** green nor red can fire, because
Instamart never rewrites `document.title`, so the matcher has nothing to read
(`own=0` in every Instamart log line; `words=0/6`). The title watcher itself is
fine — the 21 Sep `document.head` fix works and the log proves it catches every
URL change.

So Instamart needs a way to know what product is on screen that does not depend
on the page title. Until then, adding red changes nothing visible.

## Two decisions waiting on the owner

Neither should be resolved by a side effect of building something.

1. **Review-submission tracking.** `CLAUDE.md` says public visibility is the
   signal and Fayr "should not build toward" capturing the review-submission
   moment. The journey-tracking request asks for "when the user submitted the
   review" and "whether it was successfully submitted". The rule was written
   about *verification*; the new ask is about *measurement*. These may not be in
   conflict, but somebody has to say so.

2. **Search text and privacy.** The `UserEvent` table's own note says "NO MOBILE
   NUMBER, EVER" and "Never anything that identifies a person". Recording raw
   search strings per user crosses that. Recording *that* somebody searched, how
   often, and whether it matched the campaign keyword does not.

## Journey tracking — not started

The full request is in the 21 Sep conversation. The inventory was launched and
stopped; nothing was written. Worth knowing before starting again: a real
tracking system **already exists** and must be extended, never duplicated —
`UserEvent` + `UserEventType` (13 values) in the schema, `backend/src/events/`
(funnel, insights, activity, admin controllers), and `TaskEvent`, which already
records every task transition with its reason and time. The genuine hole is the
marketplace WebView: the device writes rich `[fayr-shop]` / `[fayr-measure]`
logs that the server never sees.
