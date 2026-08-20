// Guards on the staff console.
//
// The panel is a single static file with no build step, so a typo ships silently
// and only shows up as a blank screen in front of whoever is demoing. These are
// the checks that would have caught each way this file has been broken or could
// be:
//
//   - a syntax error anywhere in a 100KB script tag;
//   - a tab wired into the sidebar but not into the router, the title map or the
//     role map — which renders an empty pane for one role and not another;
//   - the panel growing its OWN money arithmetic. Three defects so far have come
//     from a number reached by a second route, and a staff console that
//     multiplies an amount by a percentage itself would be the fourth.

import fs from 'node:fs';
import path from 'node:path';

const file = path.join(import.meta.dirname, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const script = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1] || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== 1. the whole script parses ===');
{
  ok(script.length > 1000, 'the script block was found');
  let parsed = true, err = null;
  try { new Function(script); } catch (e) { parsed = false; err = e.message; }
  ok(parsed, 'index.html parses as JavaScript' + (err ? ` (${err})` : ''));
}

console.log('\n=== 2. every tab is wired all the way through ===');
{
  // Sidebar ids, from NAV_GROUPS.
  const navBlock = (script.match(/var NAV_GROUPS = \[([\s\S]*?)\n    \];/) || [])[1] || '';
  const ids = [...navBlock.matchAll(/\["([a-z]+)",\s*"/g)].map((m) => m[1]);
  ok(ids.length >= 7, `found ${ids.length} sidebar entries`);
  for (const id of ids) {
    ok(new RegExp(`\\b${id}:\\s*\\[`).test(script), `${id} has a role list (TAB_ROLES)`);
    ok(new RegExp(`\\b${id}:\\s*\\[\\s*"`).test(script), `${id} has a screen title`);
    ok(
      new RegExp(`state\\.screen === "${id}"`).test(script),
      `${id} is dispatched by the router — not a tab that opens an empty pane`,
    );
  }
  ok(ids.includes('amounts'), 'the unit-count queue is in the sidebar, not hidden in a menu');
}

console.log('\n=== 3. the panel never computes money itself ===');
{
  // It may DISPLAY payoutPercent and it may pass a quantity to the server. It may
  // not do arithmetic that reproduces the payout.
  const arithmetic = /payoutPercent\s*[*/]|[*/]\s*payoutPercent|itemPaise\s*\*|\*\s*itemPaise/;
  ok(!arithmetic.test(script), 'no percentage arithmetic on an amount anywhere in the panel');
  ok(script.includes('quantity-preview'),
    'what a count will pay comes from the server preview, the same resolver the payout uses');
}

console.log('\n=== 4. the reason for a payout decision cannot be empty ===');
{
  // An audit row that says nothing is worse than none: it looks like diligence.
  const card = (script.match(/function AmountCard\(it\)[\s\S]*?\n    }\n/) || [])[0] || '';
  ok(card.length > 500, 'the unit-count card was found');
  ok(/reasonIn\.value\.trim\(\)\.length\s*<\s*3/.test(card),
    'submitting is refused when the reason is blank');
  ok(!/placeholder[^)]*"confirmed"/i.test(card) && !/value:\s*"confirmed"/i.test(card),
    'and there is no invented default like "confirmed"');
  ok(/required/i.test(card), 'the field is labelled as required to the person typing');
}

console.log('\n=== 5. a correction reads as a correction ===');
{
  ok(script.includes('is already on file'),
    'an existing count is stated back before it can be overwritten');
  ok(script.includes('Save correction'), 'and the button says so');
}

console.log('\n=== 5b. no banner is invisible ===');
{
  // `.flash` on its own has padding but no colour or background — text in one is
  // effectively invisible. Every banner needs a modifier.
  ok(!/class:\s*"flash"/.test(script),
    'every flash banner carries flash-info or flash-err, never a bare flash');
}

console.log('\n=== 6. the hold is explained in words, never as an enum ===');
{
  ok(script.includes('heldExplanation'), 'the server sentence is rendered');
  ok(!/quantity-unknown|quantity-not-divisible/.test(script),
    'no internal reason string is printed to the screen');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
