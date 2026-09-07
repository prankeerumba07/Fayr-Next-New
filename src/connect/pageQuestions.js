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
 * Anchored at the start and closed at a word boundary, so a shopping page that
 * merely has one of these words somewhere in it can never match.
 */
export const SIGN_IN_PATH = String.raw`^\/(login|signin|sign-in|auth|ap\/|gp\/sign-in)\b`;

/**
 * THE PAGES NOTHING HERE WILL LOOK AT.
 *
 * A checkout, a cart or a payment page. A blocklist and not an allowlist, which
 * is the choice src/platforms.js already made for the same reason: a shop can
 * rewrite its own paths at any time, and an allowlist built on a path shape
 * nobody has watched would quietly switch the whole thing off instead of failing
 * where somebody can see it.
 */
export const PAYING_PATH = String.raw`^\/(checkout|cart|payment|pay|order-payment|errors\/validateCaptcha)\b`;

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
      if (document.querySelector('iframe[src*="recaptcha"],iframe[title*="challenge"],[id*="captcha"],[class*="captcha"]')) return true;
      return false;
    } catch(e){ return true; }
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
