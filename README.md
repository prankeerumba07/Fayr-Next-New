# fayr — review-validation POC

Expo **custom dev build** app (not Expo Go — the native cookie module that
persists login isn't available there). User connects a marketplace account (logs
in inside the platform's own web page), and the app fetches their submitted
reviews / orders and shows product name, order/review date, and rating/review
content.

Seven platforms are wired up — **Amazon, Flipkart, Myntra, Meesho, Instamart,
Blinkit, Zepto** — though only Amazon and Flipkart are launch targets. The
endpoints below cover the three with reverse-engineered APIs; the rest use a
network-capture discovery mode.

## How it works

- Each platform has its own screen with an embedded **WebView** pointed at the
  real site. The user logs in there (OTP etc.) — credentials go only to the
  platform.
- Tapping **Fetch my reviews** injects a `fetch(...)` **into the WebView**, so
  the request runs in the logged-in browser context (session cookie stays on the
  device, same-origin/same-site, no CORS). The result is posted back to RN.
- `src/extract.js` deep-scans the JSON for review/order-shaped nodes. A **Show
  raw JSON** toggle exposes the real response so the mapping can be refined once
  you see live data on-device.

## Endpoints used

| Platform | Endpoint | Gives |
|----------|----------|-------|
| Flipkart | `1.rome.api.flipkart.com/api/3/reviews/completed/product` | Reviews the user has submitted |
| Amazon   | `www.amazon.in/shop/profile/<accountId>/getReviews` (account id resolved from `/gp/profile`) | Public-profile reviews |
| Amazon   | `www.amazon.in/gp/your-account/order-details?orderID=<id>` — ids harvested from the order list's `data-csa-c-slot-id` attribute | Order id / date / amount / delivery status. **Requires the desktop UA** (`platform.userAgent`, Amazon-only): with the default iPhone UA amazon.in serves a mobile orders page the parser can't read. The order *list* itself is not parseable — its cards are script-only shells — but the attribute-borne ids survive, and the per-order detail page is server-rendered |
| Myntra   | `.../fetchOrdersApi/getOrders` + `.../reviewApi/fetchReview` | Orders + best-effort review content |

## Run

```bash
cd fayr
npx expo run:ios
```

Builds and launches the dev client on the **iOS simulator** — the target this is
developed against. `npx expo start` alone is not enough: the dev build has native
modules Expo Go doesn't carry.

## Known POC limitations

- Private, unversioned endpoints — can change without notice.
- Amazon's review list only returns reviews the user has made **public** and is
  keyed to a profile — but order ids are now recoverable: they're harvested from
  the order list's `data-csa-c-slot-id` attribute and resolved against
  `/gp/your-account/order-details`, which also yields order date, amount and
  delivery status. Roughly 2 in 6 detail pages come back empty, so DKIM email
  remains the fallback.
- Myntra `fetchReview` id mapping is best-effort (tries UUIDs found in the
  orders payload); refine after inspecting raw output.
- Bot-detection / ToS: fine for a hand-driven POC; not a durable production path.
