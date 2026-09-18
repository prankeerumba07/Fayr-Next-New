// WHAT THE BAR ABOVE THE SHOP SAYS, IN FIVE STATES.
//
// ── THE PRODUCT NAME IS BACK ON THE BAR — REVERSED 18 SEPTEMBER 2026 ────────
//
// The paragraph below this one says Phase 1 put the product name on the bar and
// Phase 2 took it off in favour of the search keyword, because "the design does
// not" carry it. That reasoning is kept, and it is OVERRULED FROM A REAL RUN.
// The owner, on his own phone, on a live Zepto purchase, the same day: "the
// headline did not mention the name of the product ... it was not showing
// whether this is the right product or the wrong product. That is why I haven't
// completed the purchase yet." A bar that names the thing they are there to buy
// stopped a real purchase by not naming it.
//
// SO THE BAR CARRIES THE PRODUCT NAME, ALWAYS, FOR THE WHOLE SESSION, in every
// one of the five states, and the keyword stays underneath it, smaller. The two
// are still two different strings doing two different jobs — the name is what
// the page's title is judged against, the keyword is what a person types — and
// nothing about the verdict changed. What changed is that the person can now see
// which product the verdict is about.
//
// ── THE KEYWORD IS NOT THE PRODUCT NAME, AND THAT IS STILL THE POINT ───────
//
// Phase 1 put the campaign's productName on this bar. The design does not: it
// carries an EXACT SEARCH KEYWORD, a separate phrase written by hand. On the
// owner's own Figma the campaign is "Perfora Purple Whitening Toothpaste, 75ml"
// and the bar reads "purple corrector toothpaste perfora, 75 ml". One is what
// the catalogue calls the thing; the other is what a person types into that
// shop's search box to find it, and a catalogue name pasted into a
// quick-commerce search box very often finds nothing at all.
//
// ── AND THERE IS NO COPY CONTROL ────────────────────────────────────────────
//
// The design draws one. The owner removed it on purpose, and the person types
// the keyword. (The review text, later, CAN be copied — that asymmetry is
// deliberate and is not this phase.) Nothing in this file or the screen beside
// it touches a clipboard, and the checks refuse either of them if it ever does.
//
// ── WHEN THERE IS NO KEYWORD, THE BAR SAYS SO ───────────────────────────────
//
// It NEVER falls back to the product name. A keyword that finds the wrong
// product is worse than no keyword at all, and a quiet fallback would hide from
// ops that the field is empty — the bar would look right while sending people to
// the wrong search. So an empty field is said out loud, on screen, in words.
//
// ── AND THE BAR IS A HINT, NEVER A GATE ─────────────────────────────────────
//
// It blocks nothing, hides nothing, disables nothing and stops nobody. Somebody
// this file calls WRONG can carry on and buy whatever they like. Everything that
// touches money is decided later, on the server, from the order itself. See the
// same paragraph at the top of theRightProduct.js — it is written twice because
// it is the thing a reader will assume the other way round.

// The extension is written out because this file is checked under node, and
// node's own module resolution does not add one. Metro is happy either way.
import { CANNOT_TELL, RIGHT, WRONG } from './theRightProduct.js';

/**
 * The five states.
 *
 * KEYWORD       where every session starts: no page has been looked at yet.
 * CANNOT_TELL   we are on a page and its title does not settle the question.
 * WRONG         the title names a different product.
 * RIGHT         the title is the product they claimed.
 * ORDER_PLACED  the shop's page looks like an order was just placed.
 *
 * ORDER_PLACED OUTRANKS ALL FOUR OTHERS AND THEN STICKS. The shop navigates on
 * after a confirmation page — to the order's own page, to a tracking screen, to
 * its home page — and the bar must not flick back to a product verdict on the
 * next title. An order that happened does not un-happen.
 *
 * The sticking is done by the CALLER, which is what makes it checkable: the
 * screen holds one flag that only ever goes true, and hands it in. This file
 * stays a function of its arguments.
 */
export const BAR = {
  KEYWORD: 'KEYWORD',
  CANNOT_TELL: 'CANNOT_TELL',
  WRONG: 'WRONG',
  RIGHT: 'RIGHT',
  ORDER_PLACED: 'ORDER_PLACED',
};

/**
 * HOW EACH STATE IS DRAWN, as a name and not a colour.
 *
 * 'plain' is the shop's own colour, which is what Phase 1's bar already used.
 * 'good' and 'bad' are the design's green and red. The screen maps these to
 * tokens from ui/theme.js; no colour value is written here, so this file stays
 * pure and the palette stays in one place.
 *
 * KEYWORD AND CANNOT_TELL ARE BOTH 'plain' ON PURPOSE. The owner's rule for
 * CANNOT TELL is that it "must not look like either a yes or a no", and the only
 * way to guarantee that is for it to look like the state that claims nothing.
 * They are still two states, because they say different things and the log tells
 * them apart.
 */
export const TONE = {
  [BAR.KEYWORD]: 'plain',
  [BAR.CANNOT_TELL]: 'plain',
  [BAR.WRONG]: 'bad',
  [BAR.RIGHT]: 'good',
  [BAR.ORDER_PLACED]: 'good',
};

/**
 * The keyword, tidied, or null when there is not one.
 *
 * Whitespace is collapsed because a phrase that came out of a form can carry
 * line breaks and runs of spaces, and a person reading it off a bar to type it
 * should see it the way they will type it.
 *
 * NOT ui/shopApp.js's whatToCopy, which does the same tidying for the clipboard.
 * There is no clipboard here, deliberately, and borrowing a function whose name
 * says "copy" onto a bar that must never offer copying would be the wrong thing
 * to leave behind for the next reader.
 */
export function theKeyword(keyword) {
  if (typeof keyword !== 'string') return null;
  const tidy = keyword.replace(/\s+/g, ' ').trim();
  return tidy === '' ? null : tidy;
}

/** The one line under the keyword, for each state. */
const NO_KEYWORD_YET =
  'No search phrase has been written for this offer yet.';

/**
 * The product's name, tidied the same way, or null when there is not one.
 *
 * Its own function rather than theKeyword reused under a second name, so a
 * check can see that BOTH strings reach the bar and that neither is derived
 * from the other.
 */
export function theProduct(productName) {
  if (typeof productName !== 'string') return null;
  const tidy = productName.replace(/\s+/g, ' ').trim();
  return tidy === '' ? null : tidy;
}

/**
 * WHAT THE BAR SAYS RIGHT NOW.
 *
 * `productName` the campaign's product, for the headline. Carried in EVERY
 *               state since 18 September 2026 — see the top of this file.
 * `keyword`     the campaign's searchKeyword, or null.
 * `verdict`     RIGHT, WRONG, CANNOT_TELL, or null before any page has been seen.
 * `shopName`    the shop's own name, for the one sentence that names it.
 *
 * Answers `{ state, tone, product, keyword, line }`. Both `product` and
 * `keyword` are carried in EVERY state, including RIGHT and WRONG, so both stay
 * on screen for the whole session the way the owner asked — somebody told they
 * are on the wrong product needs to see which product more than anyone.
 */
export function whatTheBarSays({ productName, keyword, verdict, orderPlaced, shopName }) {
  const phrase = theKeyword(keyword);
  const product = theProduct(productName);
  const shop = typeof shopName === 'string' && shopName !== '' ? shopName : 'the shop';

  // FIRST, AND ABOVE EVERY PRODUCT VERDICT. Once the shop's page has looked like
  // an order was placed, no later title may take that back — see the note on
  // BAR.ORDER_PLACED. The flag comes in already stuck; this only honours it.
  //
  // IT IS STILL ONLY A BAR. Nothing about this state blocks, hides or disables
  // anything, exactly as with WRONG. What it actually causes is the screen
  // handing over to the order read that already exists, and THE SERVER decides
  // whether any order matched this campaign.
  if (orderPlaced === true) {
    return {
      state: BAR.ORDER_PLACED,
      tone: TONE[BAR.ORDER_PLACED],
      product,
      keyword: phrase,
      line: 'Order placed.',
    };
  }

  if (verdict === RIGHT) {
    return {
      state: BAR.RIGHT,
      tone: TONE[BAR.RIGHT],
      product,
      keyword: phrase,
      line: 'Yes, this is the right product.',
    };
  }
  if (verdict === WRONG) {
    return {
      state: BAR.WRONG,
      tone: TONE[BAR.WRONG],
      product,
      keyword: phrase,
      line: 'No, this isn’t the correct product — go back & select another product.',
    };
  }
  if (verdict === CANNOT_TELL) {
    return {
      state: BAR.CANNOT_TELL,
      tone: TONE[BAR.CANNOT_TELL],
      product,
      keyword: phrase,
      // NEITHER A YES NOR A NO. It says what we know, which is nothing, and it
      // does not hint in either direction.
      line: phrase == null
        ? NO_KEYWORD_YET
        : 'We can’t tell what’s on screen from this page.',
    };
  }

  // NOTHING LOOKED AT YET, which is where every session starts.
  return {
    state: BAR.KEYWORD,
    tone: TONE[BAR.KEYWORD],
    product,
      keyword: phrase,
    line: phrase == null ? NO_KEYWORD_YET : `Type this into ${shop}’s search box.`,
  };
}
