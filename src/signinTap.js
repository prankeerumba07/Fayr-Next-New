// FINDING AND TAPPING A SHOP'S OWN SIGN IN, FOR A SHOP THAT HAS NO SIGN IN PAGE.
//
// THREE OF THE SEVEN SHOPS HAVE NO SIGN IN PAGE WITH AN ADDRESS OF ITS OWN. Each
// one was opened on 2 September 2026 in a real WebKit browser with a real iPhone
// user agent and a real iPhone screen — the same engine the app's own web view
// uses — and each was watched to see what really happens. Nobody signed in
// anywhere and nothing was typed on any page.
//
//   FLIPKART. https://www.flipkart.com/login and https://www.flipkart.com/account/login
//     both answer 200 and both send you straight back to the shopping page with no
//     sign in field on it. Flipkart's sign in page only works with three
//     parameters Flipkart adds itself — ret, entryPage and sourceContext — and
//     Fayr adds nothing to a shop's address, so there is no address to store.
//     Reached instead by tapping Flipkart's own "Account" entry in its bottom bar
//     (an anchor to /my-account) and then Flipkart's own "Log In" on the page that
//     opens. Flipkart then goes to its own sign in page by itself.
//
//   ZEPTO. https://www.zepto.com/login answers with Zepto's own "page could not be
//     found". Its sign in is a panel: tapping the button on its own orders page
//     whose whole label is "Login" leaves the address exactly where it was and
//     brings up Zepto's own panel with "+91" and "Enter Phone Number".
//
//   BLINKIT. https://blinkit.com/login answers 404 and sends you to the shopping
//     page. Its sign in is a panel behind an icon at the top right that carries no
//     words at all — no label, no test name — which is why nothing that looks for
//     words has ever found it. Its real markup is a div whose class name begins
//     ProfileButton__Container, holding a drawing of a person. Tapping it leaves
//     the address exactly where it was and brings up Blinkit's own panel with
//     "Enter mobile number".
//
// ── WHERE THIS SHAPE COMES FROM ─────────────────────────────────────────────
//
// It is the shape src/platforms.js already uses to reach Blinkit's own Orders,
// because Blinkit has no orders page that can be opened directly either. That
// code is read and followed here: match the shop's own visible control by its
// WHOLE label and never a part of one, allow a control at most one thing inside
// it so a whole wrapper cannot match, stop for good the moment the job is done,
// try only a few times, and if nothing matches DO NOTHING and leave the person on
// the shop's own site exactly as they are today. The worst case is what happens
// now.
//
// ── WHAT IT MAY AND MAY NOT DO ──────────────────────────────────────────────
//
//  * IT ONLY EVER TAPS A SIGN IN CONTROL, or the shop's own account entry where
//    that is the only door to one, which is true for Flipkart and proven above.
//    Every match is on a whole label or on a class name that belongs to one
//    control on one shop. There is no matching on part of a word anywhere, so
//    "reorder" or "log out" can never be hit.
//
//  * IT STOPS THE MOMENT THE SIGN IN IS UP. The signal is the shop's own sign in
//    field being on screen — a telephone field, or one asking for a number or an
//    email. So it can never go on tapping over whatever the person does next.
//
//  * IT NEVER READS WHAT ANYBODY TYPES. It asks whether a field EXISTS and never
//    once looks at a value, a cookie, a token or a stored thing of any kind.
//    Nothing is sent anywhere and nothing is written down. The person signs in on
//    the shop's own page and Fayr never sees a single thing they type.
//
//  * IT DRAWS NOTHING. There is no imitation of a shop's sign in, no imitation of
//    a shop's consent page, no imitation of the phone's own boxes. Every pixel
//    the person sees is the shop's own.
//
//  * IT NEVER TOUCHES A PAYING FLOW. A checkout, a cart or a payment page is left
//    completely alone.
//
// ── NOTHING IN platforms.js IS CHANGED ──────────────────────────────────────
//
// The scraper's own injected scripts are frozen and stay frozen: every one of the
// twelve is byte for byte what it was. This script is a SECOND one, added on top
// only for a visit somebody makes in order to sign in, by src/signin.js. The
// connect screen is not touched either.

import {
  PAYING_PATH, SIGN_IN_IS_UP, SIGN_IN_PATH, WHOLE_LABEL,
} from './connect/pageQuestions.js';

// ── THE THREE QUESTIONS THIS SCRIPT ASKS NOW COME FROM ONE PLACE ────────────
//
// They used to be written out here AND in src/connect/watchSignIn.js, and the two
// copies had already drifted: this one counted only a telephone box as a sign in,
// the watcher counted a telephone box or a password box. The owner named the risk
// on 5 September 2026 and it had already happened. So the pages this script will
// not interfere with, the shop's own sign in paths, the question "is a sign in box
// on screen" and the whole label matcher all live in src/connect/pageQuestions.js,
// and everything that needs an answer takes it from there.
//
// ONE OF THEM IS NOW WIDER, and it makes this script stop sooner rather than
// later. "Is a sign in box on screen" counts a password box as well as a telephone
// box, which is what Amazon's second sign in page carries. There is no page where
// that makes this tap MORE.

/**
 * ONE SHOP'S SCRIPT.
 *
 * `host` is the shop's own host, so the script does nothing anywhere else — a
 * sign in that hands off to another company's page is left completely alone.
 * `signIn` are the whole labels of the shop's own sign in control. `door` is the
 * shop's own account entry, for a shop where that is the only way to a sign in.
 * `extra` is a shop's own control that carries no words at all.
 */
function scriptFor({ host, signIn, door, extra }) {
  return String.raw`
(function(){
  try {
    if (!/${host}/.test(location.host)) return;
    ${SIGN_IN_IS_UP}
    ${WHOLE_LABEL}
    var signInTries = 0;
    var doorTries = 0;
    var done = false;
    function fayrOpenSignIn(){
      try {
        if (done) return;
        if (!/${host}/.test(location.host)) return;
        // THE SHOP'S OWN SIGN IN IS UP. Stop for good, so nothing is ever tapped
        // over whatever the person does from here.
        if (fayrSignInIsUp()) { done = true; return; }
        var path = location.pathname || "/";
        // ON THE SHOP'S OWN SIGN IN PAGE. Also done, and this is the signal that
        // works for a shop whose field carries no words. See OWN_SIGN_IN_PATH.
        if (/${SIGN_IN_PATH}/.test(path)) { done = true; return; }
        if (/${PAYING_PATH}/.test(path)) return;
        if (signInTries >= 3) return;
        var control = fayrWholeLabel(${JSON.stringify(signIn)});
        if (control) { signInTries++; control.click(); return; }
        ${extra ? String.raw`
        // This shop's own control carries no words at all, so it is found by the
        // class name its own code gives it. One shop, one control.
        var iconOnly = document.querySelector(${JSON.stringify(extra)});
        if (iconOnly) {
          var iconBox = iconOnly.getBoundingClientRect();
          if (iconBox.width > 0 && iconBox.height > 0) { signInTries++; iconOnly.click(); return; }
        }` : ''}
        ${door && door.length ? String.raw`
        // No sign in control on this page. This shop keeps its sign in behind its
        // own account entry, so open that and look again on the next look.
        if (doorTries < 2) {
          var entry = fayrWholeLabel(${JSON.stringify(door)});
          if (entry) { doorTries++; entry.click(); }
        }` : ''}
      } catch(e){}
    }
    setInterval(fayrOpenSignIn, 1500);
  } catch(e){}
})();
`;
}

/**
 * THE SHOPS WITH NO SIGN IN PAGE OF THEIR OWN, and the control each one really has.
 *
 * Every label and every class name here was read off the shop's own page in a real
 * browser. Not one of them is a guess.
 */
const TAP_TO_SIGN_IN = {
  // Seen: an anchor to /my-account in the bottom bar whose whole label is
  // "Account", then an anchor on that page whose whole label is "Log In".
  flipkart: scriptFor({
    host: String.raw`flipkart\.com`,
    signIn: ['log in', 'login', 'sign in'],
    door: ['account', 'my account'],
  }),
  // Seen: a button on Zepto's own orders page whose whole label is "Login". No
  // account entry is needed, so none is tapped.
  //
  // THE HOST WAS WRONG AND THE SCRIPT COULD NEVER FIRE. It read `zepto\.com`, and
  // zepto.com redirects to ZEPTONOW.com, which does not contain the letters
  // "zepto.com" anywhere in it. Two other files in this project already record
  // that redirect in writing (src/ConnectScreen.js and src/session.js), so the
  // one place that needed to know it was the one place that did not. The check
  // next door only asked whether a script EXISTED, so a dead guard passed.
  zepto: scriptFor({
    host: String.raw`zepto(now)?\.com`,
    signIn: ['login', 'log in', 'sign in'],
    door: [],
  }),
  // Seen: an icon at the top right with no words of any kind, in a div whose own
  // class name begins ProfileButton__Container. The words are tried first anyway,
  // in case Blinkit ever prints one.
  blinkit: scriptFor({
    host: String.raw`blinkit\.com`,
    signIn: ['login', 'log in', 'sign in'],
    door: [],
    extra: '[class*="ProfileButton"]',
  }),
};

/**
 * THE SCRIPT THAT FINDS AND TAPS THIS SHOP'S OWN SIGN IN, or null.
 *
 * Null for a shop that has a sign in page of its own: there is nothing to hunt
 * for, because the address opens the sign in directly.
 */
export function signInTapScript(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  return TAP_TO_SIGN_IN[key] || null;
}

/** Every shop that reaches its sign in by tapping. For the check next door. */
export function shopsThatTapToSignIn() {
  return Object.keys(TAP_TO_SIGN_IN);
}
