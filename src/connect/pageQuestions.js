// THE QUESTIONS ASKED OF A SHOP'S OWN PAGE, WRITTEN ONCE.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// Three things needed to know what a sign in looks like: the watcher
// (src/connect/watchSignIn.js), the tap script (src/signinTap.js) and the gate
// itself (src/connect/gate.js). Each had written the answer out for itself, and
// they had ALREADY drifted: the tap script counted only a telephone box as a sign
// in field, the watcher counted a telephone box or a password box, and neither
// knew the other had a different answer.
//
// The owner named this on 5 September 2026: "a third copy in the screen is how
// they start disagreeing". So there is one copy, here, and everything that needs
// the answer takes it from this file.
//
// ── WHY THEY ARE STRINGS AND NOT FUNCTIONS ──────────────────────────────────
//
// These run INSIDE a shop's own page, and the only way to get code in there is to
// hand the web view a string. A tempting alternative is to write them as ordinary
// functions and turn each one into a string with toString() when it is injected,
// so that our own checks can call the very same function. THAT DOES NOT WORK
// HERE: the app is built with Hermes, which compiles a function to bytecode and
// answers toString() with "function name() { [bytecode] }". The injected script
// would be a stub, silently, on a real phone and never in a check.
//
// So the split is the other way round, and it is the better one anyway: THE PAGE
// GATHERS FACTS AND OUR OWN SIDE DECIDES. Everything below only ever answers "is
// this on the page" or "what words did the shop print". Not one decision is made
// in here. Every decision is in src/connect/gate.js, which is plain checked code.
//
// ── AND NOTHING IN HERE WRITES ──────────────────────────────────────────────
//
// No assignment into a field, no typing event, no form submit, no tap, no cursor
// put anywhere, no cookie, no storage, no token, and never once the value of
// anything. backend/src/shops/connect-words.spec.ts reads this file from disk and
// refuses every one of those shapes.

/**
 * THE SHOP'S OWN SIGN IN PATHS, as one pattern, in one place.
 *
 * ── /ap/ IS A WIDENING AND IT WAS MEASURED ──────────────────────────────────
 *
 * It used to read `ap/signin` alone, which is Amazon's FIRST sign in page and not
 * its only one. Amazon asks for the number on one page and then moves the person
 * to another page of its own for the password or the code, and those live at
 * /ap/cvf/..., /ap/challenge and /ap/mfa. With only the first one listed, the
 * moment Amazon moved somebody from step one to step two we would have read it as
 * leaving the sign in, and our own cover would have flashed on over the middle of
 * their sign in.
 *
 * /ap/ IS AMAZON'S AUTHENTICATION PORTAL AND NOTHING ELSE LIVES THERE. Checked on
 * 6 September 2026 in a real WebKit browser with a real iPhone user agent:
 * /gp/sign-in.html lands on /ap/signin with a sign in box on it, and /ap/signin,
 * /ap/register, /ap/forgotpassword, /ap/cvf/request and /ap/challenge are all real
 * paths under it. There is no shopping page anywhere under /ap/.
 *
 * ── AND /ax/ IS A SECOND WIDENING, FROM THE OWNER'S OWN DEVICE LOG ─────────
 *
 * IT HAPPENED AGAIN, AND THE SAME WAY. 15 September 2026, 16:59:02. He typed his
 * mobile number on /ap/signin, tapped Continue, and Amazon moved him to
 *
 *   /ax/claim
 *
 * which is not under /ap/ and was not in this pattern. Five milliseconds later
 * the screen read that as leaving the sign in, put our own cover back over
 * Amazon's password page, and the watcher then had nothing new to say — so the
 * quiet clock ran out and he was asked whether it had worked, over a page that
 * was working. It is the identical failure the paragraph above describes, at a
 * step Amazon has moved since that paragraph was written.
 *
 * WHAT /ax/claim REALLY IS, READ OFF HIS OWN DEVICE AND NOT ASSUMED. The page's
 * own text on it was: Password, Forgot password?, Sign in with a passkey, Sign in
 * with Amazon shopping app, Sign in with an OTP. The watcher also found a real
 * sign in box on it. That is Amazon's password step and nothing else.
 *
 * AND WHAT ELSE IS UNDER /ax/, PROBED ON 15 SEPTEMBER 2026 with a desktop user
 * agent, signed out. /ax/claim and /ax/challenge answer like real addresses that
 * turn a signed out visitor away, and /ax/signin answers that the request was
 * wrong rather than that there is no such page. Every SHOPPING shaped address
 * tried under it — /ax/orders, /ax/account, /ax/cart, /ax/help, /ax/register —
 * does not exist at all.
 *
 * SAID PLAINLY, BECAUSE IT IS NARROWER THAN THE /ap/ PARAGRAPH ABOVE: that one
 * was read in a browser signed in, and this one could not be. Nobody has walked
 * /ax/ while signed in. What is established is that the one page we have seen
 * there is a sign in step, and that nothing to do with shopping answers there.
 *
 * SO WHY THE WHOLE PORTAL AND NOT /ax/claim ALONE. Because naming one page is
 * exactly what broke twice: `ap/signin` alone broke at Amazon's second step, and
 * this pattern without /ax/ broke the moment Amazon added a step. A page under
 * /ax/ that we have not seen is far likelier to be another sign in step than a
 * shopping page, and reading a sign in step as "they left the sign in" is the
 * failure in front of us.
 *
 * AND THE RISK IT CARRIES IS BOUNDED, which is why this is safe to widen at all.
 * whatThePageShows asks whether the page is a puzzle, and whether it is a paying
 * page, BEFORE it asks this. So neither a robot check nor a checkout under /ax/
 * could be uncovered by this, whatever else moves.
 *
 * Anchored at the start and closed at a word boundary, so a shopping page that
 * merely has one of these words somewhere in it can never match.
 */
export const SIGN_IN_PATH = String.raw`^\/(login|signin|sign-in|auth|ap\/|ax\/|gp\/sign-in)\b`;

/**
 * A SHOP'S OWN ORDERS PAGE — A PAGE THAT ONLY EXISTS FOR SOMEBODY SIGNED IN.
 *
 * ── WHY THIS IS HERE, FROM THE OWNER'S OWN DEVICE, 20 SEPTEMBER 2026 ───────
 *
 * He signed in to Zepto inside Fayr and was then asked whether it had worked:
 *
 *   PAGE SAID {"fieldIsThere":false,"signInControlIsThere":false,
 *              "signOutIsThere":false,"looksLikeAGreeting":false,
 *              "path":"/account/orders","greeting":"\nOrders\n"}
 *   READ AS signInIsUp=false theyAreIn=false signInIsGone=true
 *   GATE shop -> cannotTell because signInIsGone
 *
 * Zepto greets nobody by name and prints no way out, so the two rules that
 * answer "in" could not fire, and he got "we cannot tell if it worked" on a
 * page that could only be on his screen BECAUSE it had worked. His words:
 * "I don't want this page ever again."
 *
 * AND THE SAME PAGE, SIGNED OUT, FROM THE SAME DEVICE AN HOUR EARLIER:
 *
 *   PAGE SAID {"signInControlIsThere":true,"path":"/account/orders",
 *              "greeting":"Please Login\nPlease login to check orders.\n\nLogin\n"}
 *
 * So the shop says which it is, plainly, in a way that needs no name and no way
 * out: signed out the orders page offers a way IN, and signed in it does not.
 * That is the whole of the rule in gate.js, and this is the path half of it.
 *
 * A BLOCKLIST WOULD BE WRONG HERE AND AN ALLOWLIST IS RIGHT, which is the
 * opposite of the choice the paying-page list below makes, and for the opposite
 * reason: this one is used to say somebody IS signed in, so a path nobody has
 * measured must never match. Every entry below was read off a real log.
 *
 * AND THAT LIST IS NOT NAMED HERE ON PURPOSE. connect-words.spec.ts on our own
 * side reads the first three hundred characters after its name in this file and
 * holds them to naming a checkout, a cart and a payment page. Writing the name
 * above its own definition moved that window onto this comment and failed two
 * checks that were entirely right to fail.
 */
// IT ENDS AT A SLASH OR AT THE END, AND NOT AT A WORD BOUNDARY. The first
// writing used \b, and the check next door refuted it the same minute:
// "/orders-are-us" matched, because a hyphen is a word boundary. A path that
// merely STARTS like an orders page is not one, and this answer is the one that
// says somebody is signed in — so it has to end where the path segment ends.
export const ORDERS_PATH = String.raw`^\/(account\/orders|orders|my-orders|order-history|gp\/css\/order-history|gp\/your-account\/order-list)(\/|$)`;

/**
 * THE PAGES NOTHING HERE WILL LOOK AT.
 *
 * A checkout, a cart or a payment page. A blocklist and not an allowlist, which
 * is the choice src/platforms.js already made for the same reason: a shop can
 * rewrite its own paths at any time, and an allowlist built on a path shape
 * nobody has watched would quietly switch the whole thing off instead of failing
 * where somebody can see it.
 */
/*
 * AND THE CAPTCHA ADDRESS IS TWO ADDRESSES, BECAUSE THE SHOPS SPELL IT
 * DIFFERENTLY. This list carried `errors/validateCaptcha`, which is Flipkart's.
 * Amazon's real one, MEASURED FROM THE OWNER'S OWN LOG ON 9 SEPTEMBER 2026, is
 *
 *   https://www.amazon.in/errors_page/validateCaptcha
 *
 * one word apart — errors_page, not errors — so it never matched, and this list
 * is anchored at `^\/` so it could not have matched further along either. The
 * consequence was not cosmetic: the page that says "we have decided you are a
 * robot" was read as an ordinary shop page.
 *
 * Both are here rather than one loosened pattern. `errors[_a-z]*\/` would also
 * match an address neither shop has, and a pattern that matches things nobody
 * has seen is a pattern nobody can check.
 */
export const PAYING_PATH = String.raw`^\/(checkout|cart|payment|pay|order-payment|errors\/validateCaptcha|errors_page\/validateCaptcha)\b`;

/**
 * A PUZZLE ASKING WHETHER THEY ARE A PERSON.
 *
 * Never touched, never answered, and never reported as anything. The words are
 * the ones the shops themselves print on those pages.
 */
export const IS_A_PUZZLE = String.raw`
  function fayrIsAPuzzle(){
    try {
      var body = (document.body && document.body.innerText || "").toLowerCase();
      if (/enter the characters you see|type the characters|are you a human|i am not a robot|unusual traffic|verify you are human/.test(body)) return true;
      // AND IT HAS TO BE ON SCREEN, which is the rule the other two questions in
      // this file have always kept and this one did not. querySelector matches a
      // node that is display:none, so a hidden captcha container sitting in a
      // shop's ordinary markup read as a puzzle — and the watcher returns before
      // gathering a single fact on a puzzle, for that page's WHOLE LIFE. One
      // invisible node could mute Fayr on a page where a person was signing in
      // perfectly well, and nothing would ever say why.
      //
      // Same shape as fayrSignInIsUp and fayrWholeLabel above: a box with real
      // width and real height, or it does not count.
      var puzzles = document.querySelectorAll('iframe[src*="recaptcha"],iframe[title*="challenge"],[id*="captcha"],[class*="captcha"]');
      for (var p=0;p<puzzles.length;p++){
        var pbox = puzzles[p].getBoundingClientRect();
        if (pbox.width > 0 && pbox.height > 0) return true;
      }
      return false;
    } catch(e){ return true; }
  }
`;

/**
 * THE SHOP IS ASKING US TO SLOW DOWN, AND IT SAYS SO WITH A PAGE.
 *
 * ── WHAT THIS IS, MEASURED ──────────────────────────────────────────────────
 *
 * From the owner's log, 9 September 2026, after the app asked Amazon for its
 * sign in page a second time inside four minutes. Amazon served, in order:
 *
 *   a page whose WHOLE BODY was "Click the button below to continue shopping"
 *   HTTP 503 on /gp/sign-in.html
 *   its robot puzzle
 *
 * That first page is not a shop that failed to open, and it is not a sign in
 * page, and until now nothing recognised it at all — so it fell through as an
 * ordinary page with no signal in it, and the app went on asking.
 *
 * ── MATCHED ON WHAT THE PAGE SAYS, NOT WHERE IT IS ──────────────────────────
 *
 * The address was plain `/` both times, so there is nothing in it to match. The
 * body is the only evidence there is.
 *
 * ── AND IT CANNOT MATCH A REAL SHOP PAGE ────────────────────────────────────
 *
 * Two conditions together, and the second is what makes it safe. The words have
 * to be there AND the page has to be practically empty of anything else: a real
 * Amazon page carrying a "continue shopping" button somewhere in it runs to
 * thousands of characters, and this one was a single sentence. So the length is
 * part of the test rather than the wording alone.
 *
 * It reports `false` on its own error, not `true`. Being wrong towards "the shop
 * is fine" costs one more attempt; being wrong towards "the shop is blocking us"
 * would stop a person who had no problem at all.
 */
export const IS_A_DEAD_END = String.raw`
  function fayrIsADeadEnd(){
    try {
      var text = (document.body && document.body.innerText || "").trim();
      if (text.length === 0) return false;
      if (text.length > 400) return false;
      var said = text.toLowerCase();
      if (/click the button below to continue shopping/.test(said)) return true;
      if (/continue shopping/.test(said) && text.length < 120) return true;
      return false;
    } catch(e){ return false; }
  }
`;

/**
 * IS THE SHOP'S OWN SIGN IN BOX ON SCREEN?
 *
 * Asks whether a box exists and reads the words the SHOP put on it. It never once
 * looks at what is in one.
 *
 * A TELEPHONE BOX OR A PASSWORD BOX, and the tap script used to count only the
 * first. That mattered: Amazon's second sign in page carries a password box and
 * nothing else, so the tap script would not have known the job was done there.
 *
 * IT CANNOT SEE FLIPKART'S OWN BOX AND THAT IS MEASURED, NOT ASSUMED. Flipkart's
 * own sign in page carries one box written as a plain number field with no type,
 * no name, no placeholder and no label, so there is nothing on it to read. Opened
 * on 6 September 2026 in a real WebKit browser: flipkart.com/account/login lands
 * on /login, prints "Log in for the best experience" and "Enter your phone number
 * to continue", and this question answers NO on it. The path is what says the
 * sign in is up for Flipkart, which is why SIGN_IN_PATH exists.
 */
export const SIGN_IN_IS_UP = String.raw`
  function fayrSignInIsUp(){
    try {
      var ins = document.getElementsByTagName("input");
      for (var i=0;i<ins.length;i++){
        var el = ins[i];
        var box = el.getBoundingClientRect();
        if (!(box.width > 0 && box.height > 0)) continue;
        var type = (el.type || "").toLowerCase();
        if (type === "tel" || type === "password") return true;
        var said = ((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")
                   + " " + (el.name || "")).toLowerCase();
        if (/mobile|phone number|enter phone|email|tel-national/.test(said)) return true;
      }
      return false;
    } catch(e){ return false; }
  }
`;

/**
 * A CONTROL WHOSE WHOLE VISIBLE LABEL IS ONE OF THESE WORDS. Never a part of one.
 *
 * Answers the control itself, or null. The tap script needs the control; the
 * watcher only needs to know whether there is one, and asks the same question and
 * looks at whether the answer is null.
 *
 * At most one thing inside it, so a whole wrapper holding the page cannot match
 * the words its children happen to contain. This is the rule src/platforms.js
 * already uses for Blinkit's own Orders entry.
 */
export const WHOLE_LABEL = String.raw`
  function fayrWholeLabel(words){
    try {
      var els = document.querySelectorAll("a,button,li,div,span,[role=button],[role=menuitem]");
      for (var w=0; w<words.length; w++){
        for (var i=0;i<els.length;i++){
          var el = els[i];
          if (el.children.length > 1) continue;
          var text = (el.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
          var aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
          if (text !== words[w] && aria !== words[w]) continue;
          var box = el.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) return el;
        }
      }
      return null;
    } catch(e){ return null; }
  }
`;

/**
 * THE WORDS THE SHOP PRINTED AT THE TOP OF ITS OWN PAGE.
 *
 * Only the top, where a shop puts its greeting. The whole page would pick up a
 * product review that happens to start with "Hi". Whether those words are a name
 * is decided on our own side, by readAccountName in src/signin.js.
 */
export const GREETING = String.raw`
  function fayrGreeting(){
    try {
      var head = document.querySelector("header") || document.body;
      var text = (head && head.innerText || "").slice(0, 400);
      return text;
    } catch(e){ return ""; }
  }
`;

/** The whole labels that mean a shop is offering somebody a way in. */
export const A_WAY_IN = ['log in', 'login', 'sign in', 'signin'];

/** The whole labels a shop only ever shows to somebody already signed in. */
export const A_WAY_OUT = ['sign out', 'log out', 'logout', 'signout'];
