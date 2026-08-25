// THE APP MUST NOT CLAIM A PUBLIC PAGE THAT DOES NOT EXIST.
//
// Found by re-reading the demo run-sheet against the real strings rather than
// against the run-sheet's own text. The review stage said, on every platform:
//
//     Review confirmed live / Publicly visible on the product page
//
// On Blinkit, Zepto and Instamart there is no public review page at all. Those
// apps show a rating on the order inside the account and publish nothing a
// shopper can read — so the sentence was not a loose paraphrase, it was a claim
// with nowhere to point. And it is on the demo path: the Blinkit task walks
// straight through that stage, so the first director to say "show me the review"
// would have found nothing to show.
//
// The pending copy for those three had the mirror-image problem and was fixed
// with the eyes-on-page action: it promised "a Fayr reviewer confirms your
// rating" when no reviewer was involved and none was waited for.
//
// This is a source-level guard because a React Native screen cannot be imported
// under node. It checks the claim, not the wording, so a rewrite is free.

import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const src = fs.readFileSync(
  path.join(import.meta.dirname, 'TaskScreen.js'), 'utf8',
);
const block = (src.match(/const REVIEW_VERIFY = \{([\s\S]*?)\n\};/) || [])[1] || '';

// Which platforms genuinely publish a review a stranger can read. Not derived
// from our code on purpose — it is a fact about the marketplaces, and writing it
// out is the whole point of the test.
const HAS_PUBLIC_REVIEW_PAGE = ['amazon', 'flipkart', 'meesho', 'myntra'];
const NO_PUBLIC_REVIEW_PAGE = ['blinkit', 'zepto', 'instamart'];

console.log('=== 1. every marketplace has its own answer ===');
{
  ok(block.length > 500, 'the REVIEW_VERIFY map was found');
  for (const p of [...HAS_PUBLIC_REVIEW_PAGE, ...NO_PUBLIC_REVIEW_PAGE]) {
    ok(new RegExp(`\\n  ${p}: \\{`).test(block), `${p} has an entry`);
  }
}

// Split the map into per-platform chunks so a claim can be attributed.
function entryFor(platform) {
  const m = block.match(new RegExp(`\\n  ${platform}: \\{([\\s\\S]*?)\\n  \\},`));
  return m ? m[1] : '';
}

console.log('\n=== 2. no platform without a public review page claims one ===');
{
  // THE test this file exists for.
  const claims = /public|product page|publicly/i;
  for (const p of NO_PUBLIC_REVIEW_PAGE) {
    const e = entryFor(p);
    ok(e.length > 20, `${p}: entry read`);
    ok(!claims.test(e),
      `${p}: says nothing about a public product page, because it has none`);
    // And it must override the DONE copy, or it inherits the default sentence
    // that makes exactly that claim.
    ok(/doneTitle:/.test(e) && /doneSub:/.test(e),
      `${p}: overrides the done copy rather than inheriting "publicly visible"`);
  }
}

console.log('\n=== 3. and none of them promises a reviewer who does not exist ===');
{
  // Those three advance on the marketplace's own rating marker, read from the
  // account. No person is involved and none is waited for. Meesho is the ONLY
  // platform where a Fayr reviewer really looks.
  for (const p of NO_PUBLIC_REVIEW_PAGE) {
    ok(!/reviewer/i.test(entryFor(p)),
      `${p}: no promise of a Fayr reviewer checking anything`);
  }
  ok(/reviewer/i.test(entryFor('meesho')),
    'meesho DOES promise a reviewer — and now there is one, with a queue');
}

console.log('\n=== 4. the default done copy still exists for the rest ===');
{
  ok(/REVIEW_DONE_DEFAULT = \{/.test(src), 'the shared done copy is declared once');
  ok(/Publicly visible on the product page/.test(src),
    'and still says the true thing for the platforms that do publish reviews');
  // Read through the fallback, so a platform that adds no override keeps today's
  // wording instead of rendering a blank stage title.
  ok(/rv\.doneTitle \|\| REVIEW_DONE_DEFAULT\.title/.test(src),
    'platforms with no override fall back rather than showing an empty title');
  for (const p of HAS_PUBLIC_REVIEW_PAGE) {
    ok(!/doneSub:/.test(entryFor(p)) || /product page/i.test(entryFor(p)),
      `${p}: either inherits the default or states the public page itself`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
