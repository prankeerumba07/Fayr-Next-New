// OPENING THE SHOP'S OWN APP, AND PUTTING THE PRODUCT NAME ON THE CLIPBOARD.
//
// Two things the owner asked for, and they belong together because they happen at
// the same moment: the person is being sent to the shop to buy something, and the
// two things that make that easy are landing in the shop's own app and not having
// to type the product name.
//
// PURE. No React, no expo, no Linking, no Clipboard — so every address and every
// sentence can be checked under node. The half that actually opens something is
// src/openShop.js next door. Same split as ui/onlyForUs.js and isItOn.js.
//
// HOW SURE WE ARE ABOUT EACH ADDRESS, said plainly because it matters:
//
//   THE WEB ADDRESS IS CERTAIN. It is read straight off the frozen platforms.js,
//   which is the file the reader itself uses, so it cannot disagree with where
//   Fayr goes to read an order.
//
//   THE APP ADDRESS IS NOT CERTAIN. These are the published custom schemes for
//   each shop's Indian app. They have NOT been confirmed on a device with each of
//   the seven apps installed, and they cannot be from here. That is exactly why
//   the fallback is not an afterthought: openShop.js tries the app address, and
//   the instant the phone says nothing can open it — which is what a wrong or
//   absent scheme looks like — it opens the web address instead. A wrong guess
//   costs a person nothing. Claiming these were verified would be the mistake.
//
// AND A REAL TENSION, WRITTEN DOWN RATHER THAN HIDDEN. Fayr reads an order inside
// its OWN web view, signed in to the shop there. The shop's installed app is a
// different place with a different sign in, and Fayr cannot see inside it. So
// buying in the app is easier for the person and invisible to Fayr until they come
// back and let it read their orders. Both doors are offered, and the screen says
// which is which in one line. Neither is hidden and neither is pretended about.

/**
 * The shop's own app, by the same keys the frozen platforms.js uses.
 *
 * `scheme` is what a phone hands to the installed app. `label` is what a button
 * says. Nothing here is read from platforms.js, and nothing here is written to it.
 */
export const SHOP_APP = {
  amazon: { scheme: 'com.amazon.mobile.shopping://www.amazon.in/', label: 'Amazon' },
  flipkart: { scheme: 'flipkart://www.flipkart.com/', label: 'Flipkart' },
  meesho: { scheme: 'meesho://meesho.com/', label: 'Meesho' },
  blinkit: { scheme: 'blinkit://', label: 'Blinkit' },
  zepto: { scheme: 'zepto://', label: 'Zepto' },
  // Instamart is a section inside Swiggy's app, not an app of its own.
  instamart: { scheme: 'swiggy://', label: 'Instamart' },
  // Myntra is dormant. Its entry is here so the map covers all seven shops and
  // nobody reads a missing row as a gap; nothing about Myntra is being worked on.
  myntra: { scheme: 'myntra://', label: 'Myntra' },
};

/** The address that opens the shop's installed app, or null for a shop we have none for. */
export function appLinkFor(key) {
  const one = SHOP_APP[key];
  return one ? one.scheme : null;
}

/** Does Fayr have an app address to try for this shop at all? */
export function hasAppLink(key) {
  return appLinkFor(key) != null;
}

/**
 * EVERY ADDRESS TO TRY, IN THE ORDER TO TRY THEM.
 *
 * The fallback lives here, in a pure function, rather than as an if inside the
 * file that does the opening — because the fallback is the whole reason a guessed
 * app address is safe, and a rule that matters that much should be checkable
 * without a phone.
 *
 * The shop's own app first, because that is the nicer place to shop and it is what
 * the owner asked for. The website second, because it always works, and because it
 * is what an app that is not installed and a scheme we had wrong both look like.
 *
 * `webUrl` is handed in, from the frozen platforms.js, so no address in this file
 * can disagree with where Fayr goes to read an order.
 */
export function addressesToTry(key, webUrl) {
  const out = [];
  const deep = appLinkFor(key);
  if (deep) out.push({ kind: 'app', url: deep });
  if (typeof webUrl === 'string' && webUrl !== '') out.push({ kind: 'web', url: webUrl });
  return out;
}

/**
 * The exact text to put on the clipboard: the product's name and nothing else.
 *
 * NOTHING IS ADDED TO IT. Not the shop, not the price, not a note from Fayr. The
 * person is going to paste this into a search box, and anything extra in there
 * turns a search that finds the product into a search that finds nothing.
 *
 * Whitespace is collapsed because a product name that came from a database can
 * carry line breaks and runs of spaces, and both break a search box.
 */
export function whatToCopy(productName) {
  if (typeof productName !== 'string') return null;
  const tidy = productName.replace(/\s+/g, ' ').trim();
  return tidy === '' ? null : tidy;
}

/**
 * The one sentence on screen saying what just happened to their clipboard.
 *
 * Said out loud on purpose. Software that quietly changes what is on somebody's
 * clipboard and says nothing is software that has taken something without asking.
 */
export function copyLine(productName, copied) {
  const what = whatToCopy(productName);
  if (what == null) {
    return 'We could not work out the product name to copy for you, so you will '
      + 'have to type it.';
  }
  if (copied === false) {
    return 'We could not copy the product name to your clipboard. It is on the '
      + 'screen above, so you can still type it.';
  }
  return 'The product name is on your clipboard. Tap the shop’s search box and '
    + 'paste it, so you do not have to type it.';
}

/** What the button that opens the shop's own app says. */
export function appButtonLabel(key, shopName) {
  const name = typeof shopName === 'string' && shopName !== ''
    ? shopName
    : (SHOP_APP[key] && SHOP_APP[key].label) || 'the shop';
  return `GO TO ${name.toUpperCase()} NOW`;
}

/**
 * The one line explaining the two doors, so nobody has to guess which to press.
 *
 * This is the honest version of the tension at the top of this file: the shop's
 * own app is the nicer place to shop and Fayr cannot see into it; Fayr's own web
 * view is where Fayr can read the order.
 */
export function whichDoorLine(shopName) {
  const name = typeof shopName === 'string' && shopName !== '' ? shopName : 'the shop';
  return `Either is fine. ${name}’s own app is quicker to shop in. Opening ${name} `
    + 'inside Fayr is how we read your order afterwards, so if you use the app, '
    + 'come back here and open it inside Fayr once before you send us anything.';
}
