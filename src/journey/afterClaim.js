// WHERE A CLAIM GOES THE MOMENT IT SUCCEEDS.
//
// ── THE OWNER'S FLOW, AND THE HALF OF IT THAT WAS BUILT ────────────────────
//
// 18 September 2026, in his own words, and it is quoted in DetailScreen.js:
//
//   "accept terms -> CLAIM -> STRAIGHT to the shop's own LOGIN page, inside
//    Fayr. No screen between."
//
// What he was asking to remove was ONE SCREEN: "Connect your {shop} account"
// (src/screens/linkaccount.js), the page with a button on it that a person had
// to press before anything opened. He was not asking to remove the sign in. The
// sign in is the thing he wanted to land on.
//
// What got built removed the screen AND the landing. A claim on a shop Fayr
// shops inside now goes straight to that shop's own FRONT PAGE, signed out, with
// no sign in anywhere on it — measured on 20 September 2026 on a Zepto claim
// made from a signed-out account. So somebody who has never signed in is put in
// a shop they cannot buy in, which is the exact dead end the feed's own ordering
// rule was written to avoid:
//
//   "A campaign on a shop they have not connected is a dead end: they would
//    claim a seat, spend tickets, and only then be asked to sign in somewhere
//    before they could do anything."  — src/campaigns/feed-order.ts
//
// This file is the missing half, and nothing more: it answers WHERE, and the
// screen does the going.
//
// ── THREE ANSWERS, AND WHY EACH ONE ────────────────────────────────────────
//
//   'signin'   They are not signed in at this shop. Go to THAT SHOP'S OWN SIGN
//              IN, inside Fayr. The route is the shop's own key — App.js
//              registers one screen per shop under exactly that name — and the
//              one word `toSignIn` is what makes src/signin.js hand the frozen
//              connect screen the shop's sign in address instead of its
//              shopping page, with the shop's own sign in control tapped for
//              them where the shop has no sign in page of its own (Zepto,
//              Blinkit and Flipkart are the three; see src/signinTap.js).
//
//              THIS IS THE SAME ONE LINE THE REMOVED SCREEN'S BUTTON RAN. Not a
//              new path, and nothing here is invented: linkaccount.js line 170
//              has always done exactly this. The screen around it is what goes.
//
//   'shop'     Signed in already, and this is a shop Fayr shops inside. Straight
//              into the shop, which is what happens today and is not changed.
//
//   'claimed'  Signed in already, and the shop is one they LEAVE Fayr for. The
//              slot-reserved moment, exactly as today.
//
// ── WHY `connected !== true` AND NOT `connected === false` ─────────────────
//
// Because not knowing has to go the same way as knowing they are out. The
// reader it comes from says so itself (src/backend/connectedShops.js): a wrong
// `false` costs one sign in visit nobody needed; a wrong `true` drops somebody
// into a shop they are signed out of, where the read finds nothing and the step
// that would have offered the sign in has already been skipped. Only `true`
// skips the sign in.
//
// Pure, so it is checked under node against the real shop list rather than
// against a copy of it.

import { shopsInsideFayr } from '../shop/insideFayr.js';

/**
 * WHERE A CLAIM THAT HAS JUST SUCCEEDED SHOULD GO.
 *
 * `marketplace` the campaign's shop key, e.g. 'zepto'. Case does not matter.
 * `connected`   whether OUR OWN RECORD says this person has signed in at this
 *               shop before. Anything that is not exactly `true` is treated as
 *               "we do not know", and goes to the sign in.
 *
 * Answers `{ kind, route }`:
 *   { kind: 'signin',  route: <the shop's own key> }
 *   { kind: 'shop',    route: 'Shop' }
 *   { kind: 'claimed', route: 'Claimed' }
 *
 * The caller builds the params, so no navigator shape lives in here. The one
 * thing a caller MUST carry on a 'signin' is `toSignIn: true` — without that word
 * the connect screen opens the shop's shopping page and this whole file has
 * changed nothing. The check next door holds the caller to it.
 */
export function whereAClaimGoes({ marketplace, connected } = {}) {
  const key = typeof marketplace === 'string' ? marketplace.trim().toLowerCase() : '';

  // NO SHOP IS NOT A SIGN IN. With no key there is no screen to open — App.js
  // registers its shop screens by key — so an invented route would be a crash
  // where the slot-reserved moment is a page that works.
  if (key === '') return { kind: 'claimed', route: 'Claimed' };

  if (connected !== true) return { kind: 'signin', route: key };

  return shopsInsideFayr(key)
    ? { kind: 'shop', route: 'Shop' }
    : { kind: 'claimed', route: 'Claimed' };
}

/**
 * THE PARAMS A 'signin' MUST CARRY, in one place so the screen cannot forget the
 * word that does the work.
 *
 * `toSignIn: true` is read by src/signin.js (shopHandedToConnectScreen), which
 * hands the frozen connect screen a shop whose start address is the sign in and
 * whose before-load script has the shop's own sign in tap appended. Drop the
 * word and the person lands on the shopping page again.
 */
export function signInParams(campaignId) {
  return { campaignId, toSignIn: true };
}
