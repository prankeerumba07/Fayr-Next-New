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
  ok(ids.includes('reviews'), 'the review-check queue is in the sidebar too — a power with no queue is a dead end');
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

console.log('\n=== 4b. the AMOUNT control, which is the dangerous one ===');
{
  const card = (script.match(/function AmountFigureCard\(it\)[\s\S]*?\n    }\n/) || [])[0] || '';
  ok(card.length > 500, 'the amount card was found');

  // Rupees in the field, integer paise on the wire. A float conversion
  // (Math.round(x * 100)) is the classic way money loses a paise.
  ok(/BigInt/.test(card), 'rupees are converted to paise in exact integer arithmetic');
  ok(!/\*\s*100\b(?![n])/.test(card), 'no float multiplication by 100 anywhere in the conversion');

  // All four gates the server enforces have to be visible to the person typing,
  // or they find out by being refused.
  ok(/Where you read it/.test(card), 'WHERE the figure came from is asked for');
  ok(/sourceSel\.value !== ""/.test(card), 'and submitting is refused without it');
  ok(/What you saw/.test(card), 'and what they saw is asked for separately');
  ok(/reasonIn\.value\.trim\(\)\.length >= 3/.test(card), 'which cannot be blank either');
  ok(/The offer says/.test(card), "the campaign's own price is shown beside the field");
  ok(/Most this can be/.test(card), 'the ceiling is shown, with which real figure produced it');
  ok(/needsAck/.test(card) && /ackBox\.checked/.test(card),
    'a disagreement has to be acknowledged before it can be saved');
  ok(/amount-preview/.test(card), 'what it pays comes from the server, not from local arithmetic');
  ok(/Save correction/.test(card), 'and a mistyped figure can still be corrected afterwards');
}

console.log('\n=== 4c. the panel\'s source list matches the server\'s ===');
{
  // A value the server does not accept would 400 at the last moment, after the
  // reviewer has done the work of reading the document.
  const types = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'backend', 'src', 'tasks', 'engine', 'evidence.types.ts'),
    'utf8',
  );
  const block = (types.match(/AMOUNT_EVIDENCE_SOURCES = \[([\s\S]*?)\] as const/) || [])[1] || '';
  const server = [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  ok(server.length === 5, `the server offers ${server.length} sources`);
  for (const value of server) {
    ok(script.includes(`"${value}"`), `the panel offers "${value}" too`);
  }
}

console.log('\n=== 4d. the eyes-on-page review check ===');
{
  const card = (script.match(/function ReviewCheckCard\(it\)[\s\S]*?\n    }\n/) || [])[0] || '';
  ok(card.length > 500, 'the review-check card was found');

  // This action settles `published`, which is what starts the holding period. So
  // it is held to the same standard as the amount: WHERE, and WHAT you saw.
  ok(/The page you opened/.test(card), 'the page the reviewer opened is asked for');
  ok(/https\?:/.test(card), 'and it has to look like a real http(s) address');
  ok(/What you saw/.test(card), 'what they saw is asked for separately');
  ok(/reasonIn\.value\.trim\(\)\.length >= 3/.test(card), 'and it cannot be blank');
  ok(!/placeholder[^)]*"confirmed"/i.test(card) && !/value:\s*"confirmed"/i.test(card),
    'with no invented default like "confirmed"');
  ok(/required/i.test(card), 'both fields are labelled as required to the person typing');

  // A confirmation that cannot be taken back is a one-way door on a payout signal.
  ok(/withdraw/i.test(card), 'a reviewer who was wrong can withdraw it');
  ok(/Save correction/.test(card), 'and a second answer reads as a correction');
  ok(/already confirmed/i.test(card), 'an existing confirmation is stated back before it is overwritten');

  // The hole this action creates has to be visible ON the card, not only in a
  // document nobody reads while doing the work.
  ok(/cannot check it again/i.test(card),
    'the card says plainly that nothing can ever re-check this one');

  // No local verdict-making: the server decides whether this may be recorded.
  ok(/review-visible/.test(card), 'the decision goes to the server, which owns every gate');
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
  ok(script.includes('whyNoMachineCheck'), 'and so is the review-check sentence');
  ok(!/quantity-unknown|quantity-not-divisible/.test(script),
    'no internal reason string is printed to the screen');
  ok(!/staff-confirmed-visible|publishedSource/.test(script),
    'no internal source name is printed to the screen either');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
