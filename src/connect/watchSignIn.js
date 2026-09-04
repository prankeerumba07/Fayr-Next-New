// WATCHING FOR TWO THINGS ON A SHOP'S OWN PAGE, AND TYPING NOTHING.
//
// ── WHAT IT WATCHES FOR, AND NOTHING ELSE ───────────────────────────────────
//
//   THE SIGN IN IS UP.  A field asking for a number or an email is on screen, or
//                       the address is the shop's own sign in path. That is when
//                       our loading screen comes off and the person sees the
//                       shop's own page.
//
//   THEY ARE IN.        The shop's own page is greeting somebody by name, or the
//                       shop's own sign out control is on the page. Both are
//                       things a shop shows only to somebody already signed in.
//                       That is when the shop's page closes itself.
//
// ── WHAT IT MAY NEVER DO, AND THE CHECK ON OUR SIDE PROVES EACH ONE ─────────
//
//  * IT TYPES NOTHING. There is no assignment to a value anywhere in it, no
//    dispatch of a typing event, no form submit, and no click on a field or a
//    button. It asks whether things EXIST and it reads the words a shop PRINTS.
//
//  * IT NEVER READS WHAT ANYBODY TYPED. It never looks at `.value` of anything,
//    never at a cookie, never at storage, never at a token. The two questions it
//    asks about a field are "is it on screen" and "what words did the shop put on
//    it", and the shop wrote those words, not the person.
//
//  * IT SENDS NO SECRET. The only things it can ever send are one of two words
//    and, at most, the name the shop itself printed at the top of its own page.
//
//  * IT GOES NOWHERE NEAR A PAYING PAGE, and nowhere near anything asking whether
//    somebody is a person. A checkout, a cart, a payment page and a puzzle are all
//    left completely alone, and on a puzzle it says nothing at all rather than
//    reporting a sign in that is not there.
//
// ── WHY IT IS A SEPARATE SCRIPT ─────────────────────────────────────────────
//
// The scraper's own twelve injected scripts in src/platforms.js are frozen and
// stay frozen, byte for byte. This is added after them, and only for a visit
// somebody makes in order to sign in. Same arrangement src/signinTap.js already
// uses, and for the same reason.

/** The shop's own sign in paths. Being on one means the sign in is up. */
const OWN_SIGN_IN_PATH = String.raw`/^\/(login|signin|sign-in|auth|ap\/signin|gp\/sign-in)\b/`;

/**
 * THE PAGES THIS SCRIPT WILL NOT LOOK AT.
 *
 * A checkout or a payment page, and anything that is a puzzle asking whether
 * somebody is a person. On any of these it reports nothing at all, which leaves
 * the person on our loading screen rather than on a shop page we cannot read.
 */
const LEAVE_ALONE = String.raw`/^\/(checkout|cart|payment|pay|order-payment|errors\/validateCaptcha)\b/`;

/**
 * A PUZZLE ASKING WHETHER THEY ARE A PERSON.
 *
 * Never touched, never answered, and never reported as a sign in. The words are
 * the ones the shops themselves print on those pages.
 */
const IS_A_PUZZLE = String.raw`
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
 * IS THE SHOP'S OWN SIGN IN ON SCREEN?
 *
 * Asks whether a field exists and reads the words the SHOP put on it. Never once
 * looks at a value. Lifted from the same question src/signinTap.js already asks,
 * so the two cannot disagree about what a sign in looks like.
 */
const SIGN_IN_IS_UP = String.raw`
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
 * IS THIS PERSON ALREADY IN?
 *
 * TWO SIGNALS AND BOTH ARE THINGS THE SHOP ITSELF PRINTS. Not a cookie, not a
 * token, not storage: every one of the seven shops keeps the thing that says
 * "signed in" where nothing running in the page can read it, on purpose, so any
 * check built on that would be a guess dressed up as a fact.
 *
 *   THE GREETING. A shop prints "Hello, <name>" at the top of its own page only
 *   for somebody who is in. The words are read here and the NAME is worked out on
 *   our own side by readAccountName in src/signin.js, which already refuses
 *   "Hello, sign in", "Hello, Guest" and "Hello, there".
 *
 *   THE SIGN OUT CONTROL. A control whose WHOLE label is sign out or log out. A
 *   shop only ever shows one to somebody who is signed in. Matched on the whole
 *   label and never a part of one, so a shopping page with the word "out"
 *   somewhere on it can never match.
 */
const THEY_ARE_IN = String.raw`
  function fayrWholeLabelExists(words){
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
          if (box.width > 0 && box.height > 0) return true;
        }
      }
      return false;
    } catch(e){ return false; }
  }
  function fayrGreeting(){
    try {
      // Only the top of the page, where a shop puts its greeting. The whole page
      // would pick up a product review that happens to start with "Hi".
      var head = document.querySelector("header") || document.body;
      var text = (head && head.innerText || "").slice(0, 400);
      return text;
    } catch(e){ return ""; }
  }
`;

/**
 * THE SCRIPT ITSELF.
 *
 * It looks every second and a half, the same beat src/signinTap.js uses, and it
 * says each of its two things AT MOST ONCE. Saying "the sign in is up" twice
 * would be harmless; saying "they are in" twice must not write two rows, and the
 * database refuses a second one anyway, so this is the belt and that is the
 * braces.
 */
export function watchSignInScript() {
  return String.raw`
(function(){
  try {
    if (window.__fayrWatching) return;
    window.__fayrWatching = true;
    ${IS_A_PUZZLE}
    ${SIGN_IN_IS_UP}
    ${THEY_ARE_IN}
    var saidUp = false;
    var saidIn = false;
    function tell(o){
      try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){}
    }
    function look(){
      try {
        if (saidIn) return;
        var path = location.pathname || "/";
        // A paying page or a puzzle: say nothing at all. The person stays on our
        // own screen rather than being shown a page we cannot read.
        if (${LEAVE_ALONE}.test(path)) return;
        if (fayrIsAPuzzle()) return;

        // ALREADY IN. Checked FIRST, so somebody who was signed in at this shop
        // all along is finished the moment the page paints rather than being made
        // to watch a sign in they do not need.
        if (fayrWholeLabelExists(["sign out","log out","logout","signout"])) {
          saidIn = true;
          tell({ __fayrSignIn: "in", __fayrGreeting: fayrGreeting() });
          return;
        }
        var greeting = fayrGreeting();
        if (/\b(Hello,|Hi |Hey )/.test(greeting)) {
          saidIn = true;
          tell({ __fayrSignIn: "in", __fayrGreeting: greeting });
          return;
        }

        // THE SIGN IN IS UP, so our loading screen comes off and the person sees
        // the shop's own page. Said once.
        if (saidUp) return;
        if (fayrSignInIsUp() || ${OWN_SIGN_IN_PATH}.test(path)) {
          saidUp = true;
          tell({ __fayrSignIn: "up" });
        }
      } catch(e){}
    }
    look();
    setInterval(look, 1500);
  } catch(e){}
})();
`;
}
