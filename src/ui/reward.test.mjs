// THE PAYOFF SCREEN — and the two numbers it must never work out for itself.
//
// Step 16 of the demo is the climax: a staff member releases the refund and the
// money lands. Until now tapping that button re-rendered the same timeline with a
// row flipped to done, and the scripted "shot" was a manual tab switch to
// Earnings. This is the screen that moment was missing.
//
// It shows two figures, and BOTH have a history of being reached by a second
// route:
//
//   1. THE AMOUNT PAID. The design derives it as a percentage of the campaign's
//      listed price, floored to whole rupees (`maxBack`). That is the
//      price-shown-vs-paid defect this codebase already closed once: it would read
//      ₹539 where the ledger, the run-sheet and TaskScreen all say ₹539.10, and it
//      would be a percentage of a price the buyer may never have been charged.
//   2. THE PRICE IT WAS BASED ON. The design uses `examplePay`, which maps from
//      the campaign's EXPECTED price — so the sub-line would state a figure the
//      user never paid.
//
// Both are already resolved, once, in src/ui/refund.js, where the backend's own
// answer wins because it is the figure the payout actually used. This module
// therefore takes numbers that are already decided and only chooses WORDS. The
// guards at the bottom enforce that it cannot start deciding them.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rewardView } from './reward.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const PAID = { state: 'REFUNDED', refundPaise: 53910, basedOnPaise: 59900, percent: 90 };

console.log('=== 1. the design\'s own words, once the money has actually moved ===');
{
  const v = rewardView(PAID);
  ok(v !== null, 'a refunded task celebrates');
  ok(v.eyebrow === 'Refund paid', 'eyebrow is the design\'s');
  ok(v.title === "You've been paid", 'title is the design\'s');
  ok(v.chip === '✓ Credited to Fayr Wallet', 'chip is the design\'s, with the app\'s own name');
  ok(!/\bfayr\b/.test(v.chip), 'AND NEVER lower case: the app is always "Fayr"');
  ok(v.amount === '₹539.10', 'the amount is EXACT paise, not floored rupees');
  ok(
    v.sub === 'Paid ₹599.00 × 90% refund. Your honest review made this happen.',
    'the sub states the price the refund was actually based on',
  );
}

console.log('\n=== 2. it never celebrates a payment that has not happened ===');
{
  // The whole point of a celebration is that it is true. Every state short of
  // REFUNDED means the money has not moved, whatever the timeline shows.
  for (const state of ['CLAIMED', 'PURCHASED', 'DELIVERED', 'REVIEWED', 'HOLDING']) {
    ok(rewardView({ ...PAID, state }) === null, `${state} does not celebrate`);
  }
  ok(rewardView({ ...PAID, state: 'refunded' }) === null,
    'and the state is matched exactly — a lowercased value is not a licence to pay out');
  ok(rewardView({ ...PAID, state: null }) === null, 'no state, no celebration');
  ok(rewardView(null) === null, 'no task at all is null, not a crash');
  ok(rewardView(undefined) === null, 'ditto undefined');
}

console.log('\n=== 3. no figure, no screen ===');
{
  // amountPaise and basedOnPaise are null together — one resolver, one answer.
  // With no amount there is nothing to celebrate, and "You've been paid ₹—" is
  // worse than staying on the timeline.
  ok(rewardView({ ...PAID, refundPaise: null }) === null,
    'a refunded task with no resolvable amount does NOT get a celebration');
  ok(rewardView({ ...PAID, refundPaise: undefined }) === null, 'undefined amount is the same');
  ok(rewardView({ ...PAID, refundPaise: '53910' }) === null,
    'a STRING amount is refused — money is resolved to an integer before it reaches here');
  ok(rewardView({ ...PAID, refundPaise: 539.1 }) === null, 'a float is never money');
  ok(rewardView({ ...PAID, refundPaise: NaN }) === null, 'NaN never reaches a screen');
}

console.log('\n=== 4. the sub-line degrades rather than inventing ===');
{
  // The arithmetic half is dropped when either input is missing; the sentence
  // that is always true is kept. On a staff-confirmed per-unit price the basis
  // exists only on the server, so this really happens.
  const noBasis = rewardView({ ...PAID, basedOnPaise: null });
  ok(noBasis.sub === 'Your honest review made this happen.',
    'no basis: the arithmetic goes, the true sentence stays');
  ok(noBasis.amount === '₹539.10', 'and the amount is still shown');

  ok(rewardView({ ...PAID, percent: null }).sub === 'Your honest review made this happen.',
    'no percent: same');
  ok(rewardView({ ...PAID, percent: 0 }).sub === 'Your honest review made this happen.',
    'a zero percent states no arithmetic — it would read "× 0% refund" beside a real payment');
  ok(rewardView({ ...PAID, basedOnPaise: '59900' }).sub === 'Your honest review made this happen.',
    'a string basis is not trusted either');
  ok(!rewardView({ ...PAID, basedOnPaise: null }).sub.includes('₹'),
    'and no stray currency symbol is left behind');
}

console.log('\n=== 5. exact paise, at every awkward value ===');
{
  const amt = (p) => rewardView({ ...PAID, refundPaise: p }).amount;
  ok(amt(50000) === '₹500.00', 'a round amount still shows its paise');
  ok(amt(53910) === '₹539.10', 'the demo\'s own figure');
  ok(amt(1) === '₹0.01', 'one paise');
  ok(amt(99) === '₹0.99', 'under a rupee');
  ok(amt(100) === '₹1.00', 'exactly a rupee');
  ok(amt(449910) === '₹4,499.10' || amt(449910) === '₹4499.10',
    'a four-figure amount formats without losing the paise');
}

console.log('\n=== 6. it does not decide either number ===');
{
  const src = readFileSync(join(HERE, 'reward.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // The defect avoided: recomputing the paid figure here. src/ui/refund.js already
  // resolves it, preferring the backend's answer because that is the one the payout
  // used. A percentage taken again here would be a second route to the money.
  ok(!/percentOfPaise/.test(src), 'reward.js never recomputes a percentage');
  ok(!/payoutCapPaise|capPaise/.test(src), 'and never re-applies the cap');
  ok(!/productPricePaise/.test(src),
    'and never touches the campaign\'s LISTED price — the design\'s mistake');
  ok(/formatPaise/.test(src), 'money is formatted by the one formatter, from money.js');
  ok(!/Math\.floor|toFixed/.test(src), 'and not by hand');
}

console.log('\n=== 7. the screen reads the helper, not the raw payload ===');
{
  const strip = (p) => readFileSync(join(HERE, '..', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // src/RewardScreen.js became src/screens/reward.js on 1 September 2026, when
  // every design screen was given its own file under the design's own key. It is
  // the same screen, and it is the survivor of a double build: the claim journey
  // drew its own version of the refund page as well.
  const screen = strip('screens/reward.js');
  ok(/rewardView/.test(screen), 'the reward screen composes the helper');
  ok(!/You've been paid|Refund paid|Credited to Fayr Wallet/.test(screen),
    'and does not hardcode the copy a second time');
  ok(/displayRefundPaise/.test(screen) && /displayChargedPaise/.test(screen),
    'it resolves both figures through src/ui/refund.js, the existing chain');
  ok(!/percentOfPaise/.test(screen), 'and never recomputes the payout itself');

  // RULES OF HOOKS, guarded because the first version broke them: two
  // useCallbacks sat BELOW the early return, so a render that bailed out called
  // fewer hooks than one that did not. React throws on that — on the
  // most-watched screen in the demo, at the moment the money lands.
  const marker = 'export default function RewardScreen';
  ok(screen.includes(marker), 'the reward screen is still the default export');
  const body = screen.slice(screen.indexOf(marker));
  const afterReturn = body.slice(body.indexOf('if (view == null) return'));
  const strayHooks = afterReturn.match(/\buse[A-Z]\w*\(/g) || [];
  ok(strayHooks.length === 0,
    `no hook is called after the early return (found: ${strayHooks.join(', ') || 'none'})`);
}

console.log('\n=== 8. it is reachable, and only on a confirmed transition ===');
{
  const strip = (p) => readFileSync(join(HERE, '..', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const app = readFileSync(join(HERE, '..', '..', 'App.js'), 'utf8');
  // REGISTERED UNDER THE DESIGN'S OWN KEY, through the one registry, since the
  // split. There is one route name for one component: the old CamelCase alias is
  // gone, because two names for one screen is two things to keep working.
  ok(/name="reward" component=\{DESIGN_SCREENS\.reward\}/.test(app),
    'App.js registers it under the design’s own key, from the registry');
  ok(!/name="Reward"/.test(app), 'and the old second name for it is gone');
  ok(!/import RewardScreen from/.test(app),
    'and App.js does not import it a second way');

  const ts = strip('TaskScreen.js');
  const dest = "navigate('reward'";
  ok(ts.includes(dest), 'TaskScreen navigates to it');
  ok(!/navigate\('Reward'/.test(ts), 'and not to the name that no longer exists');
  // The two rules that keep it from firing wrongly. It must watch the SERVER's
  // task, because the release is asynchronous and the optimistic local state
  // would celebrate before the money moved; and it must require a KNOWN earlier
  // state, or opening an already-paid task from My Products would bounce to a
  // celebration every time and the timeline would be unreadable.
  // THE WINDOW IS TAKEN FROM A STRING THAT IS PROVED TO BE THERE. The first
  // version of this sliced from indexOf(...) - 700 without checking, so when the
  // route was renamed indexOf returned -1, the slice became slice(-701, -1), and
  // the check read a random 700 characters and passed or failed for no reason.
  const where = ts.indexOf(dest);
  ok(where > 0, 'and the call really is in TaskScreen');
  ok(/authoritative/.test(ts.slice(Math.max(0, where - 700), where)),
    'it watches the authoritative (server) task, not the optimistic one');
  ok(/prev\s*!=\s*null/.test(ts), 'and only fires on a move from a KNOWN earlier state');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
