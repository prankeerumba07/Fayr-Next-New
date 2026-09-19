import { cannotBeSentBack } from './return-policy';

/**
 * WHETHER A DELIVERED QUICK-COMMERCE ORDER COUNTS AS NOT SENT BACK.
 *
 * ── THE PROBLEM, MEASURED ON THE REAL RUN OF 18 SEPTEMBER 2026 ──────────────
 *
 * refundEligibility asks four things, and one of them is `returned`. It is a
 * TRI-STATE on purpose: `false` is "we looked at the page and it was not sent
 * back", `null` is "the page said nothing either way", and the gate refuses both
 * `true` and `null` — "return status unknown (no readable order data)".
 *
 * The parser answers `false` when the page MENTIONS a return, a refund or a
 * cancellation, because a page that discusses a return window has told us there
 * was no return. That is how Amazon's pages read. A Zepto order page never uses
 * any of those words — it has no returns process to describe — so `returned` was
 * `null` on the 18 September row, and the refund would have been held for ever
 * by a question the shop's own page can never answer.
 *
 * ── THE OWNER'S WORDS, 19 SEPTEMBER 2026 ────────────────────────────────────
 *
 *   "once the product is delivered to the user, it cannot be sent back"
 *
 * On these three shops a delivery IS the end of the story. There is no returns
 * process to wait out and nothing that can come back, which is the same fact the
 * three hour hold is built on — see QUICK_COMMERCE_HOLD_HOURS.
 *
 * ── THE FOUR CONDITIONS, AND EVERY ONE OF THEM IS LOAD BEARING ──────────────
 *
 *   THE SHOP CANNOT BE SENT BACK TO   Zepto, Blinkit, Instamart, and no other.
 *     Amazon, Flipkart, Meesho and Myntra all run returns and all print the
 *     words; on those, null goes on meaning null.
 *   FAYR WATCHED THE PURCHASE         the claim carries a watched order key, so
 *     the page being read is the order Fayr saw placed from this claim inside
 *     its own view — not an order picked off a list and pointed at.
 *   THE PAGE STATED A DELIVERY        the same one definition the evidence
 *     funnel already uses, handed in by the caller. An order that has not
 *     arrived cannot be an order that will not come back.
 *   THE PAGE SAID NOTHING ABOUT IT    only `null` is answered. A page that says
 *     cancelled, returned or refunded reads `true` exactly as it does today, and
 *     that answer is never overturned here.
 *
 * ── AND IT ONLY EVER FILLS A NULL ───────────────────────────────────────────
 *
 * It cannot turn a `true` into a `false`, which is the one direction that would
 * pay for a purchase that came back. What it does is answer a question the shop
 * has no way of answering, in the only way the shop's own facts allow.
 *
 * PURE. No clock, no database, no Nest. Its answer is the tri-state the evidence
 * carries, not a boolean, so a caller cannot forget the third state.
 */
export function returnedOnThisShop(
  asked: {
    /** The campaign's platform, as the database writes it. */
    platform: string | null | undefined;
    /** Did Fayr watch this purchase being placed? */
    watched: boolean;
    /** Did the page state a delivery, by the funnel's own one definition? */
    delivered: boolean;
    /** What the page itself said, tri-state, exactly as the parser read it. */
    saidOnThePage: boolean | null;
  },
): boolean | null {
  // A PLAIN ARGUMENT, DEFENSIVELY. A default parameter only fills in undefined,
  // never null, and a rule about somebody's refund must not throw because a
  // caller handed it nothing.
  const a = asked && typeof asked === 'object' ? asked : {} as typeof asked;

  if (a.saidOnThePage != null) return a.saidOnThePage;
  if (a.watched !== true) return null;
  if (a.delivered !== true) return null;
  if (!cannotBeSentBack(a.platform)) return null;
  return false;
}
