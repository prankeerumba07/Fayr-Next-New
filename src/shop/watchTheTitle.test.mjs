// THE BAR NAMES THE PRODUCT, AND THE PAGE REPORTS ITSELF — Phase 7, Task 2.
//
// Two things the owner measured on his own phone on 18 September 2026 stopped a
// real purchase: the bar did not name the product, and the verdict sat on one
// stale title because Zepto changes page without navigating.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TITLE_REPORT_KEY, watchTheTitleScript, whatTheTitleWatcherSaid } from './watchTheTitle.js';
import { BAR, theProduct, whatTheBarSays } from './theBar.js';
import { CANNOT_TELL, RIGHT, WRONG } from './theRightProduct.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

console.log('=== 1. THE BAR CARRIES THE PRODUCT NAME, ALWAYS, IN EVERY STATE ===');
{
  const name = 'Boldfit Strapless Sports Headband';
  const states = [
    ['before any page', { verdict: null }],
    ['cannot tell', { verdict: CANNOT_TELL }],
    ['right', { verdict: RIGHT }],
    ['wrong', { verdict: WRONG }],
    ['order placed', { verdict: WRONG, orderPlaced: true }],
    // Added 22 September 2026 with the state itself: the shop refusing on
    // device count. Somebody locked out still needs to see WHICH product this
    // was about, so it carries both strings like every other state.
    ['too many devices', { deviceLimit: { hit: true, limit: 2 } }],
  ];
  const seen = new Set();
  for (const [label, over] of states) {
    const bar = whatTheBarSays({ productName: name, keyword: 'boldfit headband', shopName: 'Zepto', ...over });
    seen.add(bar.state);
    ok(bar.product === name, `THE BAR NAMES THE PRODUCT when ${label}`);
    ok(bar.keyword === 'boldfit headband', `and still carries the keyword when ${label}`);
    ok(bar.product !== bar.keyword, `and the two are two different strings when ${label}`);
  }
  // COUNTED AGAINST BAR ITSELF, so a new state must be walked here rather than
  // quietly skipped — which is what this line is for.
  ok(seen.size === Object.keys(BAR).length && Object.values(BAR).every((s) => seen.has(s)),
    `and that was all ${Object.keys(BAR).length} states`);
  // TIDIED, NOT INVENTED.
  ok(theProduct('  Boldfit   Headband \n') === 'Boldfit Headband', 'the name is tidied the way the keyword is');
  ok(theProduct('') === null && theProduct(null) === null && theProduct(7) === null,
    'and an empty or missing name is null, never a placeholder');
  ok(whatTheBarSays({ productName: null, keyword: 'x', verdict: null }).product === null,
    'so a campaign with no name draws no headline rather than a wrong one');
  // AND THE KEYWORD NEVER FALLS BACK TO IT.
  ok(whatTheBarSays({ productName: name, keyword: null, verdict: null }).keyword === null,
    'a missing keyword stays missing, whatever the product is called');
}

console.log('\n=== 2. THE SCREEN DRAWS BOTH, AND THE KEYWORD IS THE LOUD ONE ===');
{
  // ── REVERSED 22 SEPTEMBER 2026, FROM A MEASURED RUN ───────────────────────
  //
  // This section used to be called "THE SCREEN DRAWS IT, FIRST AND LARGEST" and
  // pinned the PRODUCT NAME as the headline in semibold 14 with the keyword
  // smaller underneath. That was the 18 September decision and it had a real run
  // behind it: the owner could not tell which product the verdict was about.
  //
  // It then produced a second real failure, on 21 September. He spent ninety
  // seconds on Swiggy Instamart typing the HEADLINE into the shop's search box —
  // sixteen variations, one of them empty — found nothing, and reported the
  // product as missing from the shop. The keyword "bla bli blu perfume" was on
  // the bar the whole time, two points smaller and dimmer, and was never typed.
  //
  // Both runs are satisfied by the current layout: the keyword is the loudest
  // thing on the bar because it is the string to type, and the product name is
  // still there, in every state, directly under it and saying what it is for.
  // The order and the weight are the fix; nothing else about the bar changed.
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  const bar = screen.slice(screen.indexOf('<View style={styles.barWords}>'),
    screen.indexOf('</View>', screen.indexOf('<View style={styles.barWords}>')));
  const product = bar.indexOf('{bar.product}');
  const keyword = bar.indexOf('{bar.keyword}');
  const line = bar.indexOf('{bar.line}');
  ok(product > -1, 'the product is still drawn, in every state — the 18 September decision stands');
  ok(keyword > -1, 'and so is the keyword');
  ok(keyword < product && product < line,
    'THE KEYWORD IS FIRST, the product under it, and the verdict line under both');
  ok(/barKeyword: \{ fontFamily: FONT\.bodySemi, fontSize: 15/.test(screen),
    'THE KEYWORD IS THE LOUDEST THING ON THE BAR: semibold, and the largest of the three');
  ok(/barProduct: \{ fontFamily: FONT\.body, fontSize: 12/.test(screen),
    'and the product name is quieter than it — it identifies, it is not typed');
  // AND IT SAYS WHICH JOB IT IS DOING, so size is not the only thing carrying it.
  ok(/\{WHAT_IT_IS_FOR\}: \{bar\.product\}/.test(bar),
    'the product line names its own job, so the two strings cannot be confused by somebody skimming');
  ok(/export const WHAT_IT_IS_FOR = 'Buying';/.test(read('src/shop/theBar.js')),
    'and that word lives in theBar.js with the rest of the bar\u2019s words');
  ok(/import \{ WHAT_IT_IS_FOR, whatTheBarSays \}/.test(read('src/shop/ShopScreen.js')),
    'which the screen imports rather than retyping');
}

console.log('\n=== 3. THE PAGE REPORTS ITSELF ON EVERY CHANGE, NAVIGATION OR NOT ===');
{
  const script = watchTheTitleScript();
  ok(script.includes("wrap('pushState')") && script.includes("wrap('replaceState')"),
    'pushState and replaceState are wrapped, because a single-page shop moves with them');
  ok(script.includes("addEventListener('popstate'") && script.includes("addEventListener('hashchange'"),
    'and popstate and hashchange are listened for');
  ok(script.includes('new MutationObserver') && script.includes("document.querySelector('title')"),
    'and the <title> element itself is observed, for a title that changes with no address change');
  ok(script.includes('if (now === last) return;'), 'and the same page is not reported twice');
  ok(script.includes('__fayrWatchingTitle'), 'and a second injection does nothing');
  ok(script.includes(`${TITLE_REPORT_KEY}: { title: title, url: url }`),
    'each report is the title and the address, under the one key');
  ok((script.match(/postMessage/g) || []).length === 1, 'one way out');

  // ── AND IT DOES NOTHING ELSE — THE STANDING RULE, SAME LIST AS drawnList ──
  for (const typing of [
    '.click(', '.focus(', '.blur(', '.submit(', '.value', 'dispatchEvent',
    'document.forms', 'execCommand', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'scrollTo', 'scrollIntoView', 'requestSubmit',
  ]) {
    ok(!script.includes(typing), `the script contains "${typing}", which is typing or tapping`);
  }
  for (const secret of [
    'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB',
    'token', 'Bearer', 'password', 'authorization', 'innerText', 'textContent', 'outerHTML',
  ]) {
    ok(!script.includes(secret), `the script contains "${secret}"`);
  }
}

console.log('\n=== 4. OUR SIDE READS THE REPORT, AND NOTHING ELSE AS ONE ===');
{
  const said = whatTheTitleWatcherSaid({ [TITLE_REPORT_KEY]: { title: 'Boldfit Headband | Zepto', url: 'https://www.zepto.com/pn/x' } });
  ok(said != null && said.title === 'Boldfit Headband | Zepto' && said.url === 'https://www.zepto.com/pn/x',
    'a report is read back as a title and an address');
  ok(whatTheTitleWatcherSaid({ [TITLE_REPORT_KEY]: { title: '', url: '' } }).title === null,
    'and an empty title is null, so the bar says it cannot tell rather than judging ""');
  for (const notOurs of [null, undefined, {}, { __fayrPage: {} }, { ok: true }, 'x', 7, []]) {
    ok(whatTheTitleWatcherSaid(notOurs) === null, `${JSON.stringify(notOurs)} is not the watcher's`);
  }
  ok(whatTheTitleWatcherSaid({ [TITLE_REPORT_KEY]: { title: 42, url: {} } }).title === null,
    'and a page that puts junk in the report gets nothing believed');
}

console.log('\n=== 5. THE SCREEN FEEDS BOTH SOURCES INTO THE SAME TWO SETTERS ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  // A THIRD SCRIPT MAY FOLLOW THESE TWO SINCE 20 SEPTEMBER 2026, and only for a
  // shop nobody has ever measured, on a development build. The two here are
  // unconditional and still first; measureLog.test.mjs is where the third one's
  // condition is proved. See measureLog.js.
  ok(/injectedJavaScript=\{\s*watchSignInScript\(\) \+ watchTheTitleScript\(\)/.test(screen),
    'the title watcher goes into the page beside the sign-in watcher');
  const handler = screen.slice(screen.indexOf('const onShopMessage = useCallback'),
    screen.indexOf('const onNav = useCallback'));
  ok(/const reported = whatTheTitleWatcherSaid\(msg\);/.test(handler),
    'the message handler asks whether this is the watcher’s report');
  ok(/setPageTitle\(reported\.title\);/.test(handler) && /setLastPage\(\{ title: reported\.title, url: reported\.url \}\);/.test(handler),
    'AND FEEDS THE SAME TWO SETTERS THE NAVIGATION EVENT FEEDS — the verdict is not read from onNavigationStateChange alone');
  ok(/logShop\('THE PAGE REPORTED'/.test(handler), 'and every report is logged — that log is the measurement');
  // THE NAVIGATION EVENT STILL FEEDS THEM TOO, so a shop that does navigate loses nothing.
  const nav = screen.slice(screen.indexOf('const onNav = useCallback'), screen.indexOf('const onLoadEnd'));
  ok(/setPageTitle\(/.test(nav) && /setLastPage\(/.test(nav), 'and the navigation event still feeds them as well');
  // AND NO URL RULE OR SELECTOR WAS INVENTED FROM THE REPORT.
  ok(!/reported\.url\.(includes|match|indexOf)|\/pn\/|\/product\//.test(handler),
    'and nothing about the address decides the product verdict — none has been measured');
}

console.log('\nthe title watcher survives a shop that replaces its title node');
{
  // ── THE RUN THIS COMES FROM — 21 SEPTEMBER 2026 ─────────────────────────
  //
  // The owner scrolled to a Zepto product inside Fayr and the bar never turned
  // green. Every report in his log carried the SHELL title:
  //
  //   "Everything delivered in minutes* | Zepto"   share=0 words=0/5
  //
  // while an earlier session on the same shop recorded the real one, and it is
  // exactly what the matcher wants — the product's whole name is in it:
  //
  //   "Lakme 9 To 5 Cc Cream Beige … - Buy at ₹366 Online | Instant Delivery - Zepto"
  //
  // So the matcher was never the problem. The observer was: it was installed on
  // the <title> NODE, and a single-page shop that replaces that node rather than
  // editing it leaves the observer watching an element no longer in the
  // document. It never fires again, and the first title of the session is the
  // only one Fayr ever hears.
  const script = watchTheTitleScript();
  ok(/document\.head \|\| document\.querySelector\('head'\)/.test(script),
    'IT OBSERVES THE HEAD, which is one node and is never replaced');
  ok(!/observe\(el,/.test(script), 'and never the title node, which can be');
  ok(/childList: true, characterData: true, subtree: true/.test(script),
    'with subtree on, so a title edited, replaced, removed or added is all seen');

  // AND IT STILL READS NOTHING IT MAY NOT. Observing the head is not reading the
  // page: the rules this file is held to above are unchanged, and this line is
  // here so that widening the observer can never quietly widen what is read.
  for (const forbidden of ['innerText', 'textContent', 'outerHTML', 'document.cookie']) {
    ok(!script.includes(forbidden), `and still no ${forbidden}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
