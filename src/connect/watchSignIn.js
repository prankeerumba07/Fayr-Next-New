// LOOKING AT A SHOP'S OWN PAGE, GATHERING FACTS, AND TYPING NOTHING.
//
// ── IT DECIDES NOTHING, AND THAT IS THE CHANGE ──────────────────────────────
//
// This used to work out for itself whether somebody was signed in, inside the
// shop's page, and post its verdict. That put the one rule that matters somewhere
// no check could reach: an injected script cannot be run under node, so every
// combination of what a shop's page might show was untested by construction.
//
// NOW IT ONLY GATHERS FACTS. Is a sign in box on screen, is there a way in, is
// there a way out, what words did the shop print at the top of itself, what is the
// address, is this a puzzle, and how many looks in a row these have held. It posts
// those and stops. Every decision made about them is in src/connect/gate.js, which
// is plain checked code, and gate.test.mjs walks every combination of them.
//
// ── WHAT IT MAY NEVER DO, AND THE CHECK ON OUR SIDE PROVES EACH ONE ─────────
//
//  * IT TYPES NOTHING. There is no assignment to a value anywhere in it, no
//    dispatch of a typing event, no form submit, and no click on a box or a
//    button. It asks whether things EXIST and it reads the words a shop PRINTS.
//
//  * IT NEVER READS WHAT ANYBODY TYPED. It never looks at the value of anything,
//    never at a cookie, never at storage, never at a token. The two questions it
//    asks about a box are "is it on screen" and "what words did the shop put on
//    it", and the shop wrote those words, not the person.
//
//  * IT SENDS NO SECRET. The only things it can ever send are a handful of yes or
//    no answers, the address of the page, and the words the shop itself printed at
//    the top of its own page.
//
//  * IT GOES NOWHERE NEAR A PAYING PAGE, and nowhere near anything asking whether
//    somebody is a person. A checkout, a cart, a payment page and a puzzle are all
//    left completely alone, and on either it says nothing at all rather than
//    reporting something about a page it cannot read.
//
// ── WHY IT IS A SEPARATE SCRIPT ─────────────────────────────────────────────
//
// The scraper's own twelve injected scripts in src/platforms.js are frozen and
// stay frozen, byte for byte. This is added after them, and only for a visit
// somebody makes in order to sign in. Same arrangement src/signinTap.js already
// uses, and for the same reason.

import { HOW_OFTEN_IT_LOOKS_MS } from './gate.js';
import {
  A_WAY_IN, A_WAY_OUT, GREETING, IS_A_PUZZLE, PAYING_PATH, SIGN_IN_IS_UP,
  SIGN_IN_PATH, WHOLE_LABEL,
} from './pageQuestions.js';

/**
 * THE SCRIPT ITSELF.
 *
 * ── WHEN IT SPEAKS, AND WHY NOT ON EVERY LOOK ───────────────────────────────
 *
 * It looks several times a second now (see HOW_OFTEN_IT_LOOKS_MS in gate.js for
 * the measurement behind that), and posting on every look would be three messages
 * a second across the bridge for nothing. So it posts when the facts CHANGE, and
 * once more one look later if they have not changed, which is the second look in
 * a row the gate needs before it will believe a sign in has gone. At most two
 * messages per distinct thing the page is showing.
 *
 * ── THE GREETING IS OUTSIDE THE COUNT, ON PURPOSE ───────────────────────────
 *
 * Blinkit's own header cycles its search wording every second or so. If the exact
 * greeting text were part of what has to hold still, the count would reset on
 * every look and "the sign in has gone" could never be reached on that shop at
 * all. So what holds still is the yes and no answers, the address, and WHETHER the
 * words look like a greeting; the greeting itself is carried along for our own
 * side to read a name out of.
 */
export function watchSignInScript() {
  return String.raw`
(function(){
  try {
    if (window.__fayrWatching) return;
    window.__fayrWatching = true;
    ${IS_A_PUZZLE}
    ${SIGN_IN_IS_UP}
    ${WHOLE_LABEL}
    ${GREETING}
    var steady = "";
    var sameCount = 0;
    function tell(o){
      try { window.ReactNativeWebView.postMessage(JSON.stringify({ __fayrPage: o })); } catch(e){}
    }
    function look(){
      try {
        var path = location.pathname || "/";
        // A PAYING PAGE OR A PUZZLE: say nothing at all. Our own side refuses
        // these too, so this is the belt and that is the braces. The person stays
        // on our own screen rather than being shown a page we cannot read.
        if (/${PAYING_PATH}/.test(path)) return;
        if (fayrIsAPuzzle()) return;

        var fieldIsThere = fayrSignInIsUp();
        var greeting = fayrGreeting();
        // WHETHER A SIGN IN WAS EVER UP IS NOT IN HERE, and that is on purpose.
        // A shop that reloads the whole page on signing in gives this script a
        // brand new life with no memory of the page before it, so a memory kept
        // here would be false exactly when it matters most. Our own side keeps it
        // and puts it in. See whatTheShopSaid in gate.js.
        var facts = {
          fieldIsThere: fieldIsThere,
          signInControlIsThere: fayrWholeLabel(${JSON.stringify(A_WAY_IN)}) != null,
          signOutIsThere: fayrWholeLabel(${JSON.stringify(A_WAY_OUT)}) != null,
          // A CHEAP FILTER AND NOT A DECISION. Whether these words are really a
          // name is settled on our own side by readAccountName, which refuses
          // "Hello, sign in", "Hello, Guest" and "Hello, there". This only keeps
          // a header that cycles its own wording from resetting the count below.
          looksLikeAGreeting: /\b(Hello,|Hi |Hey )/.test(greeting),
          path: path
        };
        var now = JSON.stringify(facts);
        if (now === steady) {
          sameCount = sameCount + 1;
          // The second look in a row, said once. After that nothing more is said
          // until the page itself changes.
          if (sameCount === 2) { facts.looksInARow = 2; facts.greeting = greeting; tell(facts); }
          return;
        }
        steady = now;
        sameCount = 1;
        facts.looksInARow = 1;
        facts.greeting = greeting;
        tell(facts);
      } catch(e){}
    }
    look();
    setInterval(look, ${HOW_OFTEN_IT_LOOKS_MS});
  } catch(e){}
})();
`;
}
