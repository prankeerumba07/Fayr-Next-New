// WHAT PAGE ARE THEY ON, ON A SHOP THAT CHANGES PAGE WITHOUT NAVIGATING?
//
// ── THE HOLE THIS CLOSES, AND WHO SAID IT WAS THERE ─────────────────────────
//
// ShopScreen judged the page from document.title as reported by
// onNavigationStateChange, and its own note from Phase 2 said the rest: "A
// single-page shop can change its title without any navigation, so this can go
// stale. Nothing is done about that yet, deliberately ... the fix — a tiny
// script that watches document.title and posts back the title and nothing else
// — is not worth writing against an imagined problem."
//
// IT IS NOT IMAGINED. Zepto rewrites the screen without navigating, so the
// title the view reported on the way in was the title the verdict was judging
// for the whole session — one stale string — and the owner stood in front of a
// bar that "was not showing whether this is the right product or the wrong
// product". This is that tiny script.
//
// ── THE PAGE REPORTS AND OUR SIDE DECIDES, and the page does NOTHING ELSE ───
//
// Same rule as every script this project puts into a shop's page, and the same
// check as src/order/drawnList.test.mjs holds them to: it taps nothing, types
// nothing, submits nothing, and reads no cookie, no storage and no token. It
// reads two strings — the title and the address — and posts them back every
// time either changes, however the change happened:
//
//   pushState / replaceState   wrapped, because a single-page shop moves between
//                              its pages with these and fires no event at all
//   popstate / hashchange      the phone's own back gesture and anchor moves
//   a MutationObserver on the <title> element, because the title can change
//                              with no address change at all
//
// EVERY REPORT IS LOGGED BY THE SCREEN. That log is the measurement: nobody has
// watched what Zepto's titles and addresses do across a session, and this is
// how it gets watched. No selector and no address rule is written from it here
// — see the top of theRightProduct.js for why the verdict stays on the title.
//
// ── A STRING, NOT A FUNCTION, FOR THE REASON pageQuestions.js GIVES ─────────
//
// Hermes compiles a function to bytecode and answers toString() with a stub. So
// the script is a string, and our side's reader below is ordinary checked code.

/** The one key a report carries, so ShopScreen can tell it from the sign-in watcher's. */
export const TITLE_REPORT_KEY = '__fayrTitle';

/**
 * THE SCRIPT PUT INTO THE PAGE.
 *
 * It says the same thing twice only when the title or the address has really
 * changed, so a shop that re-renders on every scroll does not flood the log.
 */
export function watchTheTitleScript() {
  return String.raw`
(function(){
  try {
    if (window.__fayrWatchingTitle) return;
    window.__fayrWatchingTitle = true;
    var last = '';
    function tell(){
      try {
        var title = String(document.title || '');
        var url = String(location.href || '');
        var now = title + ' | ' + url;
        if (now === last) return;
        last = now;
        window.ReactNativeWebView.postMessage(JSON.stringify({ ${TITLE_REPORT_KEY}: { title: title, url: url } }));
      } catch(e){}
    }
    function wrap(name){
      try {
        var original = history[name];
        if (typeof original !== 'function') return;
        history[name] = function(){
          var out = original.apply(this, arguments);
          setTimeout(tell, 0);
          return out;
        };
      } catch(e){}
    }
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', function(){ setTimeout(tell, 0); });
    window.addEventListener('hashchange', function(){ setTimeout(tell, 0); });
    function watchTitle(){
      try {
        // ── THE HEAD, NOT THE TITLE NODE — 21 SEPTEMBER 2026 ──────────────
        //
        // This used to observe document.querySelector('title'). A single-page
        // shop that REPLACES that node rather than editing it leaves the
        // observer watching an element no longer in the document, and it never
        // fires again — so the first title the view ever had is the only one
        // Fayr hears, for the whole session.
        //
        // MEASURED: the owner scrolled to a Zepto product and the bar never
        // turned green. Every report in his log carried the shell title,
        // "Everything delivered in minutes* | Zepto", while an earlier session
        // on the same shop proves the real one exists and is exactly what the
        // matcher wants: "Lakme 9 To 5 Cc Cream … - Buy at ₹366 Online |
        // Instant Delivery - Zepto". The product name is right there in it.
        //
        // The head is always the same node, so observing IT with subtree on
        // catches a <title> that is edited, replaced, removed or added later.
        // Strictly more than before and never less.
        var head = document.head || document.querySelector('head');
        if (!head || !window.MutationObserver) return false;
        new MutationObserver(function(){ tell(); })
          .observe(head, { childList: true, characterData: true, subtree: true });
        return true;
      } catch(e){ return false; }
    }
    if (!watchTitle()) {
      document.addEventListener('DOMContentLoaded', watchTitle);
    }
    tell();
  } catch(e){}
})();
true;`;
}

/**
 * WHAT THE WATCHER SAID, or null when this message is not the watcher's.
 *
 * Both strings are coerced, because a page can put anything at all in a message
 * and both of these end up on a log line and in a verdict.
 */
export function whatTheTitleWatcherSaid(message) {
  if (message == null || typeof message !== 'object') return null;
  const said = message[TITLE_REPORT_KEY];
  if (said == null || typeof said !== 'object') return null;
  const title = typeof said.title === 'string' ? said.title : '';
  const url = typeof said.url === 'string' ? said.url : '';
  return { title: title === '' ? null : title, url: url === '' ? null : url };
}
