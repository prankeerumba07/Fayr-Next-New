// IS THE PAGE ON SCREEN THE PRODUCT THEY CLAIMED? — DECIDED FROM THE TITLE ALONE.
//
// ── WHY THE TITLE AND NOTHING ELSE ──────────────────────────────────────────
//
// Nobody has ever read a product page on Zepto, Blinkit or Instamart with a web
// inspector open. So there is no selector to trust, no URL shape to key off, and
// anything written from either would be a guess dressed as a measurement.
//
// A title is different: every page has one, the web view already reports it on
// every navigation, and Phase 1's log has been writing them down since it
// landed. A shop's product page puts the product in its title, because that is
// what a search engine reads. So the whole question is two strings.
//
// ── IT IS A HINT AND IT IS NEVER A GATE ─────────────────────────────────────
//
// Nothing here blocks, hides, disables or refuses anything. Somebody this file
// calls WRONG can carry on and buy whatever they like. Every decision that
// touches money is made later, on the server, from the order itself — this only
// changes what one bar says. The next person to read this file will assume
// otherwise, which is why it is written here in the first three paragraphs.
//
// ── AND BE HONEST ABOUT WHAT IT CANNOT DO ───────────────────────────────────
//
// A shop whose product pages are all titled "Zepto — Online Grocery Delivery"
// will answer CANNOT TELL on every page of the session, and the bar will sit on
// the keyword the whole way through. THAT IS THE CORRECT BEHAVIOUR AND NOT A
// FAILURE. A wrong green is far worse than a permanent grey: it tells somebody
// the thing in their basket is the one that gets refunded when it is not.
//
// Every number below is provisional for the same reason — none of them has met a
// real Zepto title. The log writes the title, the answer, WHICH RULE FIRED and
// the share, so after one real run these can be tuned from what shops actually
// write rather than from what this file imagined they write.

/** The three answers. There is no fourth, and "probably" is CANNOT_TELL. */
export const RIGHT = 'RIGHT';
export const WRONG = 'WRONG';
export const CANNOT_TELL = 'CANNOT_TELL';

/**
 * WHICH RULE FIRED, in words, for the log.
 *
 * The point of naming them is that a run produces a list of titles against rule
 * names, and the rule that is wrong about real pages is then obvious. A bare
 * verdict would not be tunable from anything.
 */
export const BECAUSE = {
  NO_TITLE: 'there is no title yet',
  NOTHING_TO_MATCH: 'the product name has no words worth matching',
  SHOP_FURNITURE: 'a page of the shop’s own, not a product',
  ONLY_THE_SHOP: 'the title is only the shop’s own words',
  WHOLE_NAME: 'the title carries the whole product name',
  ENOUGH_WORDS: 'enough of the product’s own words',
  NAMES_SOMETHING_ELSE: 'the title has its own words and almost none of ours',
  NOT_ENOUGH_EITHER_WAY: 'not enough of the words either way',
};

/**
 * ── HOW THIS DIFFERS FROM THE MATCHER ALREADY IN THE PROJECT ───────────────
 *
 * src/ConnectScreen.js:88 (`productMatches`) asks almost this question: does this
 * string name the product the task is for. It is frozen, so it cannot be
 * imported, and it should not be copied either — it is answering about an ORDER
 * ITEM's name, which is another catalogue string, and this is answering about a
 * TITLE, which a marketer wrote. Five deliberate differences:
 *
 *  1. WHOLE WORDS, NOT SUBSTRINGS. It asks `hay.includes(word)`, so a product
 *     word "pro" matches "product", "protein" and "promotion". Forgiving between
 *     two catalogue strings; badly wrong against marketing prose, where it
 *     manufactures hits and a false green is the worst outcome there is.
 *  2. A REAL STOP LIST, not "longer than two letters". A title is mostly "buy",
 *     "online", "best price", "free delivery" and the shop's own name, and every
 *     one of those would count as a hit against a product name that happened to
 *     contain it.
 *  3. BARE NUMBERS DO NOT COUNT. A title is full of prices, and "500" matching
 *     "500" is as likely to be rupees as grams.
 *  4. THREE ANSWERS, NOT TWO. Its caller has to decide something; this one is
 *     drawing a bar, and most pages in a session genuinely do not settle the
 *     question. A boolean would force a yes or a no onto a cart page.
 *  5. THE SAME 0.6, ON PURPOSE. That threshold is the one number in this project
 *     that has met real order pages, so it is the honest place to start rather
 *     than a new figure invented today.
 */

/** Enough of the product's own words, and the page is the product. */
export const ENOUGH = 0.6;

/**
 * Almost nothing in common — below this the title is about something else.
 *
 * Not zero, because a title can share one word with a product by accident and
 * still be a different thing.
 */
export const ALMOST_NOTHING = 0.2;

/**
 * A TITLE NEEDS THIS MANY WORDS OF ITS OWN BEFORE IT MAY BE CALLED WRONG.
 *
 * Without it, a shop's home page is a false red. "Zepto — 10 Minute Grocery
 * Delivery App" shares none of any product's words, and calling that WRONG would
 * tell somebody standing on the front page that they had opened the wrong
 * product. A title has to be ABOUT something before it can be about the wrong
 * thing.
 *
 * The cost is written down rather than hidden: a genuinely different product
 * with a SHORT title — "Amul Butter | Zepto", two words of its own — reads grey
 * instead of red. That is the direction to be wrong in.
 */
export const ENOUGH_OF_ITS_OWN = 3;

/**
 * WORDS THAT ARE NOT WORTH MATCHING ON: the shops' own names, the vocabulary
 * every shop title is padded with, and ordinary English joining words.
 *
 * NOT MEASURED. Not one of these came off a real Zepto, Blinkit or Instamart
 * title, because nobody has read one. They came from how e-commerce titles are
 * ordinarily written, and the log exists to correct them.
 */
const NOT_WORTH_MATCHING = new Set([
  // the shops themselves
  'zepto', 'zeptonow', 'blinkit', 'grofers', 'swiggy', 'instamart', 'amazon',
  'flipkart', 'meesho', 'myntra',
  // what a shop calls itself
  'grocery', 'groceries', 'supermarket', 'store', 'shop', 'shopping', 'mart',
  'app', 'india', 'indian', 'com', 'www', 'http', 'https',
  // what a marketer puts round a product
  'buy', 'online', 'best', 'price', 'prices', 'offer', 'offers', 'deal', 'deals',
  'sale', 'free', 'delivery', 'deliver', 'delivered', 'minute', 'minutes',
  'fast', 'instant', 'quick', 'now', 'get', 'save', 'saving', 'discount', 'off',
  'lowest', 'cheap', 'cheapest', 'top', 'latest', 'original', 'genuine',
  'quality', 'premium', 'exclusive', 'combo', 'pack', 'packs', 'size', 'qty',
  'piece', 'pieces', 'pcs', 'set', 'count',
  // ordinary joining words
  'the', 'and', 'for', 'with', 'from', 'your', 'you', 'our', 'this', 'that',
  'all', 'any', 'one', 'two', 'per', 'its', 'are', 'was', 'has',
]);

/**
 * A TITLE THAT IS ONE OF THE SHOP'S OWN PAGES, never a product.
 *
 * These make the page CANNOT TELL and they can never make it WRONG, because
 * somebody walking through their own cart has not opened the wrong product —
 * they have not opened a product at all.
 *
 * MATCHED AS WHOLE WORDS. As substrings, "home" would strike "Homesake", which
 * is the brand on one of the two Zepto campaigns sitting in the practice data
 * right now.
 *
 * Deliberately NOT in this list, each for a reason: "bag" and "wallet" are
 * products; "order" singular appears in "pre-order" and "order now", which a
 * marketer writes on a product page; "pay" is too short a word to be safe.
 */
const A_PAGE_OF_THE_SHOPS_OWN = new Set([
  'cart', 'basket', 'checkout', 'payment', 'orders', 'history',
  'account', 'profile', 'login', 'signin', 'signup', 'register', 'logout',
  'wishlist', 'favourites', 'favorites', 'search', 'results', 'result',
  'category', 'categories', 'home', 'address', 'addresses', 'help', 'support',
  'contact', 'about', 'privacy', 'terms', 'policy', 'settings', 'notifications',
  'coupons', 'refer', 'invite', 'track', 'tracking',
]);

/**
 * ONE STRING, TIDIED, so two strings written by different people can be compared.
 *
 * A size written closed up is the same size written open — a marketer picks
 * whichever looks better on the day — so a digit against a letter becomes a
 * digit, a space and a letter. Every other mark becomes a space, because a title
 * uses dashes, pipes, commas and brackets as furniture and none of them is part
 * of a word.
 */
export function tidy(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words in a string that are actually worth comparing. */
export function wordsWorthMatching(text) {
  const out = [];
  for (const word of tidy(text).split(' ')) {
    if (word === '') continue;
    // Two letters or fewer carries no meaning on its own: ml, g, kg, xl, hd.
    if (word.length < 3) continue;
    // A bare number in a title is a price at least as often as it is a size.
    if (/^\d+$/.test(word)) continue;
    if (NOT_WORTH_MATCHING.has(word)) continue;
    out.push(word);
  }
  return out;
}

/** Is this the shop's own furniture rather than a product? */
export function isAPageOfTheShopsOwn(title) {
  for (const word of tidy(title).split(' ')) {
    if (A_PAGE_OF_THE_SHOPS_OWN.has(word)) return true;
  }
  return false;
}

/**
 * Two words that are the same word, allowing for one of them being a plural.
 *
 * The only bending of "whole words" there is, and it earns its place: a title
 * says "headbands" where a catalogue says "headband" often enough to matter, and
 * nothing else about plurals can go wrong.
 */
function sameWord(a, b) {
  return a === b || a === `${b}s` || b === `${a}s`;
}

/**
 * HOW MUCH OF THE PRODUCT'S OWN VOCABULARY THE TITLE CARRIES, 0 to 1.
 *
 * Measured over the PRODUCT's words and not the title's, on purpose: a title is
 * padded with marketing the product name never had, and counting that padding
 * against it would mark down every real product page.
 */
export function howMuchOverlaps(productWords, titleWords) {
  if (!productWords.length) return 0;
  let hits = 0;
  for (const word of productWords) {
    if (titleWords.some((t) => sameWord(word, t))) hits += 1;
  }
  return hits / productWords.length;
}

/**
 * THE ANSWER: is the page on screen the product they claimed?
 *
 * `productName` the campaign's catalogue name — NOT the search keyword. The
 *               keyword is what a person types; this is what the thing is
 *               called, and it is what a title can be compared against.
 * `title`       the page's own title, as the web view reported it.
 *
 * Answers `{ verdict, because, share, matched, of, ofItsOwn }` — the numbers as
 * well as the answer, because the log carries them and they are what makes the
 * thresholds above tunable from a real run.
 *
 * The rules are in the order the owner set them, and the order is load-bearing:
 * furniture is asked about BEFORE the words are counted, so a search results page
 * carrying the product's own words is still not the product page.
 */
export function whatThePageIs(productName, title) {
  const productWords = wordsWorthMatching(productName);
  const titleWords = wordsWorthMatching(title);
  const answer = (verdict, because) => ({
    verdict,
    because,
    share: howMuchOverlaps(productWords, titleWords),
    matched: productWords.filter((w) => titleWords.some((t) => sameWord(w, t))).length,
    of: productWords.length,
    ofItsOwn: titleWords.length,
  });

  if (typeof title !== 'string' || tidy(title) === '') {
    return answer(CANNOT_TELL, BECAUSE.NO_TITLE);
  }
  // A product with no words worth matching cannot be judged by this method at
  // all, and saying so is better than an answer built on nothing.
  if (!productWords.length) return answer(CANNOT_TELL, BECAUSE.NOTHING_TO_MATCH);

  if (isAPageOfTheShopsOwn(title)) return answer(CANNOT_TELL, BECAUSE.SHOP_FURNITURE);
  if (!titleWords.length) return answer(CANNOT_TELL, BECAUSE.ONLY_THE_SHOP);

  // THE STRONGEST SIGNAL THERE IS: the title contains the catalogue name whole.
  // Checked before the counting because it needs no threshold to be trusted.
  if (tidy(title).includes(tidy(productName))) {
    return answer(RIGHT, BECAUSE.WHOLE_NAME);
  }

  const share = howMuchOverlaps(productWords, titleWords);
  if (share >= ENOUGH) return answer(RIGHT, BECAUSE.ENOUGH_WORDS);
  if (share <= ALMOST_NOTHING && titleWords.length >= ENOUGH_OF_ITS_OWN) {
    return answer(WRONG, BECAUSE.NAMES_SOMETHING_ELSE);
  }
  return answer(CANNOT_TELL, BECAUSE.NOT_ENOUGH_EITHER_WAY);
}
