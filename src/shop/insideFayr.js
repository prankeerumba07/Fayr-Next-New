// SHOPPING INSIDE FAYR: WHICH SHOPS, WHERE THEY OPEN, AND WHAT THE VIEW MAY LOAD.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
//
// Zepto, Blinkit and Swiggy Instamart are to be shopped INSIDE Fayr: the shop's
// own mobile site in a web view a person can see and use, with a bar across the
// top carrying the product they claimed, from the moment they tap Open until
// they leave. This file holds every decision that flow makes and not one line
// that touches a phone. The screen next door, ShopScreen.js, is the wiring.
//
// Same split as src/ui/shopApp.js and src/openShop.js, and as
// src/foregroundRefresh.js and the few lines of App.js that use it: everything
// decidable is here and is walked under node, because a phone cannot be made to
// produce a payment app, a blocked address or a person coming back on demand.
//
// ── WHY IT IS A NEW FILE AND NOT A ROW IN platforms.js ──────────────────────
//
// platforms.js is frozen. It is the READER's file — twelve injected browser
// scripts measured against real pages — and src/orderhistory.js says so in as
// many words where it explains why it cannot add an order list page there.
// ConnectScreen.js is frozen for the same reason. So the shopping flow gets its
// own settings here, and that leaves TWO files in the app that know about shops,
// which must not be allowed to disagree.
//
// ── HOW THE TWO FILES ARE STOPPED FROM DISAGREEING ABOUT AN ADDRESS ─────────
//
// NOT ONE SHOP ADDRESS IS WRITTEN IN THIS FILE. That is the whole mechanism,
// and it is the same one ui/shopApp.js uses for the same reason: the caller
// reads `startUrl` off the frozen platforms.js and HANDS IT IN, and
// whereToLand() derives what it needs from that. There is therefore no second
// copy of a domain anywhere to drift, and if platforms.js ever changes a shop's
// address this file follows it without being edited.
//
// Only the PATH is ours, and the only path we ever choose is the root — because
// somebody going shopping must not land on their own order history, which is
// exactly where zepto's startUrl points, since the reader needs it to. The
// domain in front of that root is platforms.js's, character for character.
//
// The check next door enforces this rather than trusting it: it refuses this
// file if an http address ever appears anywhere in it.
//
// ── AND NO SEARCH ADDRESS IS INVENTED HERE ──────────────────────────────────
//
// Landing on the shop's own root and letting the person search is a deliberate
// choice and not a gap. Nobody has measured what a search-results address looks
// like on any of these three shops, and a guessed one would drop somebody on a
// dead page at the moment they are trying to spend money. Learning those shapes
// is part of what the log this flow writes is for.

/**
 * THE SHOPS THAT ARE SHOPPED INSIDE FAYR. ALL THREE QUICK-COMMERCE SHOPS.
 *
 * Zepto since Phase 1; Blinkit and Instamart since 18 September 2026.
 *
 * A shop that is not in here keeps the behaviour it has now: src/openShop.js
 * opens its own installed app and falls back to its website in the phone's
 * browser. Amazon, Flipkart, Meesho and Myntra are all in that second group on
 * purpose, and nothing in this phase changes them.
 *
 * ── BEING IN THIS LIST AND HAVING BEEN MEASURED ARE TWO DIFFERENT THINGS ────
 *
 * `inApp: true` says only "shop here, inside Fayr". It says nothing about what
 * this shop's pages look like, and the two must never be allowed to imply one
 * another: Zepto's order table below is a labelled guess, and Blinkit's and
 * Instamart's are deliberately EMPTY. An empty table answers CANNOT_TELL and
 * can never answer NOT_PLACED — see whatTheOrderPageSays, where that is a rule
 * of its own and runs first.
 *
 * `inApp`       whether this shop shops inside Fayr at all.
 * `orderPlaced` what its confirmation page looks like, or `{}` for a shop
 *               nobody has watched place an order. Never absent, so that the
 *               difference between "not taught" and "not listed" stays visible.
 * `userAgent`   what to tell the shop we are, or null for the view's own default.
 *
 * THERE IS NO ADDRESS FIELD, and that is deliberate — see the note at the top of
 * this file about the two shop-knowing files not being allowed to disagree. The
 * address comes from the frozen platforms.js by way of whereToLand().
 */
export const SHOPS_INSIDE_FAYR = {
  zepto: {
    inApp: true,
    // ── WHAT THIS SHOP'S "ORDER PLACED" PAGE LOOKS LIKE — EVERY LINE A GUESS ──
    //
    // NOBODY HAS MEASURED IT. Not one of the phrases or paths below came off a
    // real Zepto confirmation page, because nobody has ever placed an order
    // inside this screen and watched what appeared. They are what an Indian
    // quick-commerce shop ordinarily titles that page, which is a guess with
    // good manners, and they are labelled as one here for the same reason
    // theRightProduct.js labels its thresholds.
    //
    // PHASE 1'S LOG IS WHAT CORRECTS THEM. One real purchase writes the real
    // title and the real address into the console, and this table is then
    // rewritten from a fact instead of from an expectation.
    //
    // ── AND IT LEANS SHY, BECAUSE THE TWO MISTAKES DO NOT COST THE SAME ──────
    //
    // A MISSED order costs one extra tap: "Did you buy it?" is still on the
    // journey and still works, for every shop, unchanged.
    //
    // A FALSE order sends somebody into a read for a purchase that never
    // happened, which ends in "we could not find it" and looks broken.
    //
    // So a page has to POSITIVELY say so, and anything unrecognised answers
    // "cannot tell" rather than being guessed at in either direction.
    //
    // A NOTE ON PATHS AND THE RULE THAT NO ADDRESS IS WRITTEN IN THIS FILE: the
    // strings below are path FRAGMENTS to recognise, never addresses to open.
    // Nothing navigates to one. The rule at the top of this file is about not
    // holding a second copy of a shop's DOMAIN, and there is still none here.
    orderPlaced: {
      // A page whose title says it outright.
      titleSays: [
        'order placed', 'order confirmed', 'order confirmation',
        'order successful', 'order success', 'order received',
        'thank you for your order', 'thanks for your order',
      ],
      // Or whose address does.
      pathSays: [
        '/order-confirmation', '/order-confirmed', '/order-success',
        '/order-successful', '/order-placed', '/checkout/success',
        '/checkout/confirmation', '/thank-you', '/thankyou',
      ],
      // ── AND THE PAGES THAT ARE AN ORDER BUT NOT A NEW ONE ─────────────────
      //
      // THIS RULE RUNS FIRST, and it has to. Zepto's order history is where its
      // startUrl already points, and its own order page prints "Order Placed
      // at / 21 Jul 2026, 5:07 PM" — MEASURED, on the owner's real order, and
      // quoted in backend/src/ocr/order-text.ts. So the words "order placed"
      // genuinely appear on a page that is not a fresh purchase, and without
      // this rule browsing old orders would fire a read every time.
      //
      // THE KNOWN COST, WRITTEN DOWN: if Zepto's checkout turns out to land
      // straight on /order/<uuid> — which plenty of shops do — this rule
      // suppresses the real signal and the person taps "Did you buy it?"
      // instead. That is the shy direction, on purpose, and the log will say
      // within one purchase whether it is what happens.
      notAFreshOrder: ['/account/orders', '/order/'],
    },
    // NULL MEANS THE PHONE'S OWN, and for shopping that is the right answer.
    // ConnectScreen overrides the user agent for exactly one shop — Amazon —
    // and its own comment says why: amazon.in serves a mobile orders page whose
    // DOM the PARSER cannot read, so the reader asks for the desktop site. That
    // is a reader's reason and it does not apply here. A person shopping wants
    // the mobile site, and the truest way to be served it is to be honest about
    // what we are.
    userAgent: null,
  },
  // ── BLINKIT AND INSTAMART, ADDED 18 SEPTEMBER 2026, WITH NOTHING MEASURED ──
  //
  // THE OWNER'S REASON, in his own words on 18 September 2026: "we are opening a
  // web view inside the Fayr app for all the marketplaces ... so the user is not
  // out of our vision for a single time." Zepto alone was Phase 1 being careful;
  // leaving these two outside is now the thing that costs him sight of them.
  //
  // ── AND THEIR ORDER TABLES ARE EMPTY, WHICH IS THE WHOLE POINT ────────────
  //
  // NOBODY HAS EVER WATCHED EITHER SHOP'S CONFIRMATION PAGE. Zepto's phrases
  // above are already labelled a guess with good manners; copying that guess
  // into two more shops would turn one unmeasured table into three and make
  // them look measured by weight of numbers. An EMPTY table cannot be mistaken
  // for a measurement, and whatTheOrderPageSays answers CANNOT_TELL to it
  // explicitly — never NOT_PLACED, which would be a claim about a page nobody
  // has seen.
  //
  // THE COST IS ONE TAP AND IT IS THE SHY DIRECTION. An order placed on Blinkit
  // is simply not noticed, and "Did you buy it?" is still on the journey, for
  // every shop, exactly as it is today.
  //
  // ── THERE *IS* MEASURED MATERIAL FOR BOTH, AND IT ANSWERS A DIFFERENT
  //    QUESTION ───────────────────────────────────────────────────────────────
  //
  // src/platforms.js:1499 (Blinkit) and src/platforms.js:1640 (Instamart) both
  // carry real findings — but about whether an order has been RATED, not about
  // whether one was just PLACED, and both read it out of captured JSON rather
  // than off anything the page prints:
  //
  //   Blinkit    /v1/layout/order_history, an entry whose type === "edit_rating"
  //   Instamart  /mapi/order/dash, shipments[].rating_info.is_rated
  //
  // platforms.js is frozen and that logic stays where it is. It is cited here so
  // the next person to look at these two empty tables knows the measurement that
  // exists is about something else, rather than going looking for it again.
  //
  // WHAT FILLS THESE IN is the log. ShopScreen writes a line on every page load
  // naming this shop as untaught, with the real title and the real address, so
  // the owner's first real Blinkit purchase IS the measurement.
  blinkit: {
    inApp: true,
    orderPlaced: {},
    userAgent: null,
  },
  instamart: {
    inApp: true,
    orderPlaced: {},
    userAgent: null,
  },
};

/**
 * ANDROID'S OWN WEB VIEW NEEDS TELLING, and this is the string ConnectScreen has
 * used all along.
 *
 * Copied rather than imported because ConnectScreen.js is frozen and exports
 * nothing. It is here, as a named constant with this note, rather than inline in
 * the screen, so the one place it can be read from is a file that is checked.
 */
export const ANDROID_LIKE_A_PHONE =
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/136.0.0.0 Mobile Safari/537.36';

/** Does this shop shop inside Fayr? Anything unknown is a plain no. */
export function shopsInsideFayr(key) {
  const row = typeof key === 'string' ? SHOPS_INSIDE_FAYR[key] : null;
  return !!(row && row.inApp === true);
}

/**
 * What to tell the shop we are, or null to leave the view's own default alone.
 *
 * `os` is handed in — 'ios' or 'android' — rather than read off Platform, so
 * both answers can be walked under node.
 */
export function userAgentFor(key, os) {
  if (!shopsInsideFayr(key)) return null;
  const mine = SHOPS_INSIDE_FAYR[key].userAgent;
  if (typeof mine === 'string' && mine !== '') return mine;
  return os === 'android' ? ANDROID_LIKE_A_PHONE : null;
}

/**
 * What this shop's "order placed" page looks like, or null for a shop that has
 * not been taught — which is every shop but Zepto today.
 *
 * A shop with no entry can never be said to have placed an order, which is the
 * shy direction and the same shape as every other per-shop answer here.
 */
export function orderMarksFor(key) {
  if (!shopsInsideFayr(key)) return null;
  const marks = SHOPS_INSIDE_FAYR[key].orderPlaced;
  // AN EMPTY TABLE IS NOT THE SAME ANSWER AS NO TABLE, and this line is what
  // keeps the two apart. `null` means "this shop does not shop inside Fayr at
  // all"; `{}` means "it does, and nobody has ever watched it place an order".
  // Collapsing the second into the first with `|| null` would have hidden
  // Blinkit and Instamart behind the answer meant for Amazon.
  return marks && typeof marks === 'object' ? marks : null;
}

/**
 * HAS ANYBODY ACTUALLY WATCHED THIS SHOP PLACE AN ORDER?
 *
 * False for a shop inside Fayr whose order table is empty, which today is
 * Blinkit and Instamart. Asked separately from orderMarksFor because the answer
 * changes what is LOGGED as well as what is decided: a page load on an untaught
 * shop is the one thing that can fill the table in, so it is written down loudly
 * rather than passing as one more line saying nothing was recognised.
 *
 * A shop that is not inside Fayr answers false as well. It has no table to be
 * empty, and there is no honest way to call that "measured".
 */
export function anybodyHasMeasured(key) {
  const marks = orderMarksFor(key);
  if (marks == null) return false;
  const titles = Array.isArray(marks.titleSays) ? marks.titleSays : [];
  const paths = Array.isArray(marks.pathSays) ? marks.pathSays : [];
  return titles.length > 0 || paths.length > 0;
}

/**
 * THE SCHEME OF AN ADDRESS, or null when there is not one.
 *
 * A regex and not `new URL()`: Hermes ships an incomplete URL implementation, so
 * a thing that parses under node is not a thing that parses on the phone, and
 * this answer decides whether an address is loaded at all. src/connect/gate.js
 * reads a path the same way and for the same reason.
 */
export function schemeOf(url) {
  if (typeof url !== 'string') return null;
  const found = url.match(/^([a-z][a-z0-9+.-]*):/i);
  return found ? found[1].toLowerCase() : null;
}

/**
 * THE ONLY TWO SCHEMES FAYR'S OWN VIEW LOADS.
 *
 * A WHITELIST, AND THAT DIRECTION IS THE WHOLE DESIGN. The list of payment apps
 * in India is not something this file can ever be complete about — upi, gpay,
 * phonepe, tez, paytmmp, and whatever a bank ships next month — so it does not
 * try. It names what we load and everything else is the phone's.
 *
 * Getting it wrong in this direction costs nothing: the phone refuses an address
 * it cannot open, the person stays on the page they were on, and the log says
 * what was refused. Getting it wrong the other way is the bug this exists to
 * close — a person taps Pay, the view cannot load upi://, and they land nowhere.
 */
export const WE_LOAD = ['http', 'https'];

/**
 * WHOSE ADDRESS IS THIS TO OPEN — OURS OR THE PHONE'S?
 *
 * 'us'    load it in Fayr's own view, as normal.
 * 'phone' do not load it; hand it to the phone and write it down.
 *
 * ANYTHING UNRECOGNISED IS THE PHONE'S, including an address with no scheme at
 * all and the empty one. That follows from this being a whitelist rather than
 * being a separate rule: a shape this file does not know is not a shape it may
 * load.
 *
 * about:blank lands here too, and it is the phone's by that same rule. It is
 * worth saying out loud because a web view uses about:blank for its own
 * purposes: a page that opens a blank window and writes a payment form into it
 * would be stopped by this, and that is a real risk of a closed list. It is
 * accepted for this phase rather than guessed about, because the log records
 * every refusal with its address, so if a shop's checkout really does that we
 * will see the line saying so instead of wondering.
 */
export function whoOpensThis(url) {
  const scheme = schemeOf(url);
  if (scheme == null) return 'phone';
  return WE_LOAD.indexOf(scheme) >= 0 ? 'us' : 'phone';
}

/**
 * THE ORIGIN OF AN http OR https ADDRESS — scheme and host, nothing after it.
 *
 * Deliberately refuses everything else, so no address that is not a web address
 * can become somewhere a person is sent.
 */
export function originOf(url) {
  if (typeof url !== 'string') return null;
  const found = url.match(/^(https?:\/\/[^/?#]+)/i);
  return found ? found[1] : null;
}

/**
 * WHERE A SHOPPING SESSION LANDS.
 *
 * `productUrl` the campaign's own product address, when the campaign carries
 *              one. All fifteen campaigns carry null today, so the second
 *              branch is the one that actually runs.
 * `startUrl`   read by the CALLER off the frozen platforms.js and handed in, so
 *              no domain in this file can disagree with the reader's.
 *
 * Answers `{ kind: 'product' | 'shop', url }`, or null when there is nowhere
 * honest to go — no address is ever invented to fill that hole.
 *
 * AND IT REFUSES A SHOP THAT DOES NOT SHOP INSIDE FAYR. That is the second of
 * two independent guards. The first is the branch at the call site, which only
 * sends a listed shop this way; this one means that even if some future call
 * site gets that branch wrong, there is no address for the screen to open and
 * nothing happens — rather than Amazon quietly appearing inside a web view.
 *
 * A productUrl is only used if it is an address FAYR'S OWN VIEW WOULD LOAD, by
 * the same whitelist the view itself uses. A campaign carrying `javascript:` or
 * `file:` in that field is a campaign with no product address, not a way to make
 * the view load something else.
 */
export function whereToLand(key, where) {
  if (!shopsInsideFayr(key)) return null;
  const at = where || {};
  // ── ONE ORDER'S OWN PAGE — THE REVIEW STEP'S LANDING, PHASE 7 ────────────
  //
  // A third kind, and NOT a loosening of the two below it. A shopping session
  // still lands on the product or the front page and never an order list; this
  // branch only runs when the caller hands in an `orderUrl`, which only the
  // review step does. It is accepted only if Fayr's own view would load it AND
  // it is on the same origin as the shop's own front door, so a record cannot
  // send the view to another site. See theOrderPage.js for how it is built.
  const order = typeof at.orderUrl === 'string' ? at.orderUrl.trim() : '';
  if (order !== '') {
    const sameShop = originOf(order) != null && originOf(order) === originOf(at.startUrl);
    if (whoOpensThis(order) === 'us' && sameShop) {
      return { kind: 'order', url: order };
    }
    // AN ORDER ADDRESS THAT CANNOT BE TRUSTED IS NOWHERE, not the front page.
    // Dropping somebody who came to rate an order on the shop's home page would
    // look like it worked and leave them hunting for the order themselves.
    return null;
  }
  const product = typeof at.productUrl === 'string' ? at.productUrl.trim() : '';
  if (product !== '' && whoOpensThis(product) === 'us') {
    return { kind: 'product', url: product };
  }
  // THE SHOP'S OWN SITE, AND ONLY ITS ROOT. The path that came with startUrl is
  // dropped on purpose: for zepto that path is /account/orders, which is where
  // the reader needs to be and the last place to put somebody who came to buy
  // something.
  const origin = originOf(at.startUrl);
  return origin ? { kind: 'shop', url: `${origin}/` } : null;
}

/**
 * DID THEY JUST COME BACK FROM PAYING, AND HOW LONG WERE THEY GONE?
 *
 * ── WHY THERE IS A SECOND QUESTION ABOUT AN "active" EVENT ──────────────────
 *
 * src/foregroundRefresh.js already answers one: should we ask our own side what
 * changed while somebody was away. It is wired once, in App.js, it is throttled,
 * and it keeps working exactly as it does now — nothing here changes it or
 * replaces it.
 *
 * This is a different question that it cannot answer, because it knows nothing
 * about the hand-off: how long was THIS person away at a payment app, having
 * been sent there by THIS screen. The hand-off moment is the input, and only
 * this screen has it.
 *
 * `wentToPayAt` of null is what keeps the shade, the app switcher and a
 * dismissed call out of this: they are all "active" events, and with no hand-off
 * recorded none of them is somebody coming back from paying.
 *
 * Answers null for "not a return worth writing down", or `{ awayMs }` for one.
 * `awayMs` of null inside that object means they did come back and the clock
 * cannot say how long — which is honest, where a zero would be a made-up number.
 */
export function comingBackFromPaying({ nextState, wentToPayAt, now }) {
  if (nextState !== 'active') return null;
  if (typeof wentToPayAt !== 'number' || !Number.isFinite(wentToPayAt)) return null;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  if (at < wentToPayAt) return { awayMs: null };
  return { awayMs: at - wentToPayAt };
}
