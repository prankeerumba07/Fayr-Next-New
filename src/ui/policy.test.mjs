// The terms are load-bearing, not decoration.
//
// CLAUDE.md makes clawback rights the countermeasure to loophole 3 — a review
// deleted after payout — and a right the user was never shown does not exist. So
// the clawback clause being present, and being about reclaiming money, is a test
// rather than a hope. Same for the promises the rest of the product depends on:
// the charged-amount basis, gift cards being ineligible, and one purchase paying
// once.

import {
  TERMS, PRIVACY, CONSENT_LINE, POLICY_VERSION, CLAWBACK_CLAUSE_ID, policyDoc,
} from './policy.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const find = (list, id) => list.find((s) => s.id === id);
const allText = (list) => list.map((s) => `${s.heading} ${s.body}`).join(' ');

console.log('=== 1. the clause the fraud model depends on ===');
{
  const clawback = find(TERMS, CLAWBACK_CLAUSE_ID);
  ok(clawback != null, 'the clawback clause exists');
  ok(/reclaim|recover|deduct/i.test(clawback.body), 'and it actually reserves the right to take the money back');
  ok(/delete|remove|hide|rewrite/i.test(clawback.body), 'naming review removal as the trigger');
  ok(/return the product/i.test(clawback.body), 'and a returned product too');
  ok(/tell you why/i.test(clawback.body), 'with notice, not silently');
}

console.log('\n=== 2. the promises the product makes elsewhere ===');
{
  const t = allText(TERMS);
  ok(/ACTUALLY CHARGED/.test(t), 'the refund basis is the charged amount, stated plainly');
  ok(/never a listed, struck-through or sticker price/i.test(t), 'and explicitly not a sticker price');
  ok(/gift cards?/i.test(t) && /not eligible/i.test(t), 'gift cards and wallet credit are excluded');
  ok(/one offer only/i.test(t), 'one purchase pays once — matching the dedup gate');
  ok(/held until a Fayr reviewer/i.test(t), 'and says a person reviews the second claim');
  ok(/return window/i.test(t) && /still publicly visible/i.test(t), 'the holding period and re-check are disclosed');
  ok(/negative review is paid exactly like a positive/i.test(t), 'review honesty is promised in writing');
  ok(/PAN/.test(t), 'PAN anchoring is disclosed in the terms, not just collected');
}

console.log('\n=== 3. privacy says the things a scraper app must say ===');
{
  const p = allText(PRIVACY);
  ok(/only your own order and review pages/i.test(p), 'scope of reading is limited and stated');
  ok(/on your device/i.test(p), 'and says where it happens');
  ok(/never receives, stores or transmits that password/i.test(p), 'marketplace credentials are never ours');
  ok(/never ask you for it, for an OTP/i.test(p), 'and it pre-empts the phishing script');
  ok(/do not sell your data/i.test(p), 'no data sale');
  ok(/not published anywhere/i.test(p), 'screenshots are private');
  ok(/recorded/i.test(p), 'and staff views are audited, which the backend really does');
  ok(/delete your account/i.test(p), 'deletion is offered a route');
}

console.log('\n=== 4. shape and wiring ===');
{
  ok(TERMS.length >= 8 && PRIVACY.length >= 5, 'both documents have real substance');
  for (const s of TERMS.concat(PRIVACY)) {
    ok(!!s.id && !!s.heading && s.body.length > 60, `${s.id}: has an id, a heading and a real paragraph`);
  }
  const ids = TERMS.concat(PRIVACY).map((s) => s.id);
  ok(new Set(ids).size === ids.length, 'every section id is unique');
  ok(/Terms & Conditions/.test(CONSENT_LINE) && /Privacy Policy/.test(CONSENT_LINE),
    'the consent line names both documents');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(POLICY_VERSION), 'there is a dated version to record consent against');
  ok(policyDoc('privacy').title === 'Privacy Policy' && policyDoc('terms').sections === TERMS,
    'policyDoc returns the right document');
  ok(policyDoc(undefined).title === 'Terms & Conditions', 'and defaults to the terms');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
