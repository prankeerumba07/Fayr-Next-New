// WHERE SOMEBODY SIGNS IN TO A SHOP. ONE NAMED THING, SWAPPABLE PER SHOP.
//
// THE OWNER'S COMPLAINT, 2 September 2026: "when I click on 'Connect My Amazon' it
// takes me to the homepage. Why is it not taking me to the login/signup page? ...
// This should work for every marketplace, not only for Amazon."
//
// He is right, and the cause was one line: the connect screen opens the shop's
// `startUrl`, and Amazon's `startUrl` is the shop's front page. So somebody who
// tapped "connect my Amazon account" was dropped into a shopping page with no sign
// in anywhere on it.
//
// THIS IS A CHANGE FROM THE DESIGN, at his explicit instruction. The design opens
// the shop's home page and says so out loud at fayr-design.browser.jsx:424 —
// marketplaceHome, with the comment "homepage only — no search/UTM/deep link" —
// and its own connect screen (:2283) uses exactly that.
//
// ── WHAT IS REAL, AND WHAT WE WILL NOT FAKE ─────────────────────────────────
//
// The competitor's screenshots the owner sent show the phone's own "wants to use
// amazon.com to sign in" box, then Amazon's sign in page, then Amazon's "would
// like access to: Profile" page with an Allow button. THOSE THREE ARE SERVED BY
// AMAZON, not by that app. They need Fayr to be registered with Amazon and issued
// an identity by Amazon, which is an approval no code can create.
//
// AND NO OTHER SHOP OFFERS ANYTHING LIKE IT. There is no "sign in with Zepto", no
// "sign in with Flipkart". For every other shop the only thing that exists is the
// shop's own sign in.
//
// SO NOTHING HERE IMITATES ANY OF IT. Fayr never draws a copy of a shop's sign in
// page, never draws a copy of a shop's consent page, and never draws a copy of the
// phone's own boxes. The person signs in on the shop's real page, at the shop's
// real address, and Fayr never sees a single thing they type. A screen that
// imitated a shop's sign in is the one thing that gets an app removed from the
// stores, and it is not what he asked for: he asked for the journey to work.
//
// ── THE ONE NAMED STEP, AND HOW AMAZON'S OFFICIAL SERVICE DROPS IN LATER ────
//
// `whereTheySignIn` is that step. It answers one question — where does this shop's
// sign in live — and every screen goes through it. The day Fayr has its own app
// identity from Amazon, ONE case is added inside this function for Amazon alone,
// returning Amazon's official address instead, and NOT ONE SCREEN CHANGES. The
// sheet still comes up, the button still says continue, the person still comes
// back to a card with their name on it.
//
// Nothing of that is built now, and no half of it is here waiting to be switched
// on. There is only this note and the shape that makes it a one place change.
//
// ── THE SAME HOST RULE, AND WHY IT IS NOT A STYLE CHOICE ────────────────────
//
// The frozen connect screen uses ONE address for three jobs: the page it opens,
// and the origin it saves and restores this shop's sign in for. A sign in address
// on another host would quietly save somebody's sign in against the wrong place
// and lose it. So an address on another host is refused here, out loud, and that
// shop keeps its own site instead.
//
// PURE. It reads platforms.js and nothing else, so a plain node test can check
// every rule in it without a phone.

import { PLATFORMS } from './platforms.js';
import { signInTapScript } from './signinTap.js';

/** The host part of a web address, or null when it is not one. */
function hostOf(url) {
  if (typeof url !== 'string') return null;
  const m = /^https:\/\/([^/?#]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * WHERE THIS SHOP'S SIGN IN LIVES.
 *
 * Always answers, for every shop, with the same shape:
 *
 *   url            the address to open
 *   onItsOwnPage   true when that address IS the shop's sign in page. False when
 *                  it is the shop's own site and the person taps the shop's own
 *                  sign in themselves, which is all that exists for some shops.
 *   shopName       the shop's own name, for the words on screen
 *   why            in plain words, for a report and for whoever reads this next
 */
export function whereTheySignIn(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  const shop = PLATFORMS[key];
  if (!shop) {
    return {
      url: null, onItsOwnPage: false, tapsItsOwnControl: false, shopName: null,
      why: 'Fayr does not know this shop.',
    };
  }

  const home = typeof shop.startUrl === 'string' ? shop.startUrl : null;
  const page = typeof shop.signInUrl === 'string' && shop.signInUrl.trim() !== ''
    ? shop.signInUrl.trim()
    : null;

  // THE DAY AMAZON'S OFFICIAL SERVICE ARRIVES, its one case goes here, above the
  // shop's own page, and nothing else in the app changes.

  if (page == null) {
    // A shop with no sign in page of its own. Three of the seven are like that,
    // and each one's own site is opened and its own sign in control tapped for
    // them. A shop with neither is the thing the check next door refuses.
    const taps = signInTapScript(key) != null;
    return {
      url: home,
      onItsOwnPage: false,
      tapsItsOwnControl: taps,
      shopName: shop.name || key,
      why: taps
        ? 'This shop has no sign in page with an address of its own, so its own site '
          + 'opens and its own sign in control is tapped for them.'
        : 'We have not established how this shop’s sign in is reached, so it opens '
          + 'the shop’s own site and nothing is guessed.',
    };
  }

  // The same host rule. See the note at the top of this file: the connect screen
  // saves this shop's sign in against this address's own origin.
  if (hostOf(page) !== hostOf(home)) {
    return {
      url: home,
      onItsOwnPage: false,
      shopName: shop.name || key,
      tapsItsOwnControl: signInTapScript(key) != null,
      why: 'That sign in address is on another host, so it is refused and the shop’s own site opens.',
    };
  }

  return {
    url: page,
    onItsOwnPage: true,
    // Nothing to hunt for: the address opens the shop's own sign in directly.
    tapsItsOwnControl: false,
    shopName: shop.name || key,
    why: 'The shop’s own sign in page.',
  };
}

/**
 * THE SHOP AS THE CONNECT SCREEN SHOULD SEE IT, when the person is going there to
 * sign in.
 *
 * The frozen connect screen is handed its shop as a whole thing and reads that
 * thing's `startUrl`. So this hands it the same shop with the sign in address in
 * that one place — same host, so everything else that address is used for keeps
 * working. The connect screen is not touched, and neither is anything else in
 * platforms.js.
 */
export function shopForSigningIn(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  const shop = PLATFORMS[key];
  if (!shop) return null;
  const where = whereTheySignIn(key);
  if (!where.onItsOwnPage || !where.url) return shop;
  return { ...shop, startUrl: where.url };
}

/** Every shop, and where each one's sign in lives. For the check next door. */
export function everyShopsSignIn() {
  return Object.keys(PLATFORMS).map((key) => ({ key, ...whereTheySignIn(key) }));
}

/**
 * THE NAME ON A SHOP ACCOUNT, read off the shop's own page.
 *
 * Pure, and deliberately narrow. These are the greetings shops actually print at
 * the top of their own pages. Anything else answers null, and the card then says
 * the account is connected and shows no name at all.
 *
 * IT NEVER INVENTS A NAME. A wrong name on a card that says "verified" is worse
 * than no name, because it would tell somebody we had checked something we had
 * not.
 */
export function readAccountName(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;

  // The greetings shops really print at the top of their own pages.
  const greetings = [/\bHello,\s+/, /\bHi\s+/, /\bHey\s+/];
  // A capitalised word that could be part of somebody's name.
  const NAME_WORD = /^[A-Z][A-Za-z'’.-]{1,30}$/;

  // WORDS THAT FOLLOW A GREETING AND ARE PLAINLY NOT A NAME. Page text runs
  // together with no spaces to tell us where a heading starts, so "Hello, Manisha
  // Dahiya Orders" would otherwise read as a three word name. These are the words
  // that sit around a greeting on a real shop page.
  const FURNITURE = new Set([
    'sign', 'signin', 'signout', 'guest', 'there', 'user', 'select', 'account',
    'accounts', 'welcome', 'friend', 'customer', 'and', 'the', 'your', 'orders',
    'order', 'lists', 'list', 'cart', 'basket', 'help', 'returns', 'wishlist',
    'profile', 'logout', 'menu', 'home', 'out', 'in', 'settings', 'wallet',
    'rewards', 'coupons', 'search', 'deals', 'prime', 'more', 'my',
  ]);

  for (const greeting of greetings) {
    const at = greeting.exec(text);
    if (!at) continue;
    const after = text.slice(at.index + at[0].length);
    const words = after.split(/\s+/).slice(0, 4);

    // Take capitalised words while they last, at most three.
    const taken = [];
    for (const raw of words) {
      const word = raw.replace(/[.,;:!?)\]]+$/, '');
      if (!NAME_WORD.test(word)) break;
      taken.push(word);
      if (taken.length === 3) break;
    }
    // Then drop anything from the end that is page furniture rather than a name.
    while (taken.length > 0 && FURNITURE.has(taken[taken.length - 1].toLowerCase())) {
      taken.pop();
    }
    // And refuse outright if the FIRST word was furniture: "Hello, sign in" is a
    // shop telling us nobody is signed in.
    if (taken.length === 0) continue;
    if (FURNITURE.has(taken[0].toLowerCase())) continue;

    const name = taken.join(' ');
    if (name.length < 2) continue;
    return name;
  }
  return null;
}

/**
 * THE SHOP THE CONNECT SCREEN IS ACTUALLY HANDED, for one visit.
 *
 * THIS IS THE FUNCTION THE APP CALLS, and the only one. The owner found on
 * 2 September 2026 that adding a sign in address to every shop had changed
 * nothing at all on his phone, because nothing read the field. So the wiring goes
 * through one named function, and the check next door calls THIS — not the field
 * in platforms.js — so a field nothing reads can never pass again.
 *
 * ONE VISIT IN TWO, AND THEY WANT DIFFERENT PAGES.
 *
 *   GOING THERE TO SIGN IN. That is the connect journey, and the whole point of
 *   this work: the person lands on the shop's own sign in, not its shopping page.
 *
 *   GOING THERE TO READ. Fayr opens the same screen to read somebody's own orders
 *   and reviews, and for that the landing page matters: Myntra's is its order
 *   list, Meesho's and Zepto's are theirs. Sending a reading visit to a sign in
 *   page would take a working path and break it, so a reading visit is left
 *   exactly as it is.
 *
 * WHERE THIS IS NARROWER THAN THE OWNER'S WORDS, said out loud. He wrote that
 * this function should hand over the sign in shop, without naming the two kinds
 * of visit. Doing it for every visit would have swapped Myntra's order list for
 * Myntra's login page on the reading path, which reads nobody's orders. So it is
 * done for the visit he was complaining about — the connect journey — and the
 * reading path keeps the page it needs. Nothing guesses which kind of visit it
 * is: the screen that sends somebody to sign in says so, in one word.
 */
export function shopHandedToConnectScreen(platformKey, routeParams) {
  const key = String(platformKey || '').toLowerCase();
  const shop = PLATFORMS[key];
  if (!shop) return null;
  const params = routeParams || {};
  if (params.toSignIn !== true) return shop;

  const going = shopForSigningIn(key) || shop;

  // A SHOP WITH NO SIGN IN PAGE OF ITS OWN gets its own site opened and then a
  // small script that finds and taps the shop's own sign in control. Three of the
  // seven are like that, and every label and class name in those scripts was read
  // off the shop's own page in a real browser. See src/signinTap.js.
  //
  // THE SCRAPER'S OWN SCRIPTS ARE NOT TOUCHED. This adds a SECOND script after
  // the shop's own one, only for a visit somebody makes in order to sign in.
  // src/platforms.js keeps all twelve of its injected scripts byte for byte, and
  // the connect screen is not edited either — it is handed a shop, and this is
  // the shop it is handed.
  const tap = signInTapScript(key);
  if (!tap) return going;
  const own = typeof going.beforeLoadScript === 'string' ? going.beforeLoadScript : '';
  return { ...going, beforeLoadScript: `${own}\n${tap}` };
}
