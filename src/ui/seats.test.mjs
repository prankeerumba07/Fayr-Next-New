// SEAT COPY — and the silences, which are the part worth testing.
//
// The interesting cases here are not "3 slots left". They are the three ways a
// seat figure can be absent, each of which must produce silence rather than a
// zero: an unlimited campaign, a server that did not send the field, and an old
// app talking to a new server or the reverse.
//
// "0 slots left" printed because a field was missing tells the user an offer is
// closed when it is wide open — a lie in the one direction that loses a sale.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LOCKED_BANNER, LOCKED_CTA, seatsLine, joinedLine, isFullCampaign, lockedLine,
  lockedReason,
} from './seats.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== seatsLine: what it says ===');
ok(seatsLine({ seatsLeft: 3 }) === '3 slots left', 'states the remainder in the design\'s words');
ok(seatsLine({ seatsLeft: 1 }) === '1 slots left', 'does not special-case one — the design does not either');
ok(seatsLine({ seatsLeft: 1240 }) === '1,240 slots left', 'groups Indian-style, via theme.js');
ok(seatsLine({ seatsLeft: 0 }) === 'All seats taken', 'zero left is the full state, in the design\'s words');

console.log('\n=== seatsLine: when it says NOTHING ===');
ok(seatsLine({ seatsLeft: null }) === null, 'an unlimited campaign gets no seats line at all');
ok(seatsLine({}) === null, 'a campaign with no seatsLeft field is silent, NOT "0 slots left"');
ok(seatsLine({ seatsLeft: undefined }) === null, 'undefined is silence');
ok(seatsLine(null) === null, 'no campaign at all is silence, not a crash');
ok(seatsLine(undefined) === null, 'ditto undefined');
ok(seatsLine({ seatsLeft: '3' }) === null,
  'a STRING is not a count — money crosses the wire as a string here and a seat count does not, so a string means something is wrong upstream and the screen stays quiet');
ok(seatsLine({ seatsLeft: 2.5 }) === null, 'a fractional seat is not a seat');
ok(seatsLine({ seatsLeft: NaN }) === null, 'NaN never reaches a screen');

console.log('\n=== seatsLine: never a negative ===');
// The server clamps at 0, but an operator lowering the slot count after claims
// exist is exactly how a negative would arrive if it ever stopped clamping.
ok(seatsLine({ seatsLeft: -2 }) === 'All seats taken', 'a negative reads as full, never as "-2 slots left"');

console.log('\n=== isFullCampaign ===');
ok(isFullCampaign({ seatsLeft: 0 }) === true, 'zero is full');
ok(isFullCampaign({ seatsLeft: -1 }) === true, 'negative is full');
ok(isFullCampaign({ seatsLeft: 1 }) === false, 'one left is not full');
ok(isFullCampaign({ seatsLeft: null }) === false, 'unlimited is never full');
ok(isFullCampaign({}) === false,
  'UNKNOWN is not full — an absent field must not disable a claim button the server would have honoured');
ok(isFullCampaign(null) === false, 'no campaign is not full');

console.log('\n=== joinedLine: zero says nothing, which is the whole rule ===');
ok(joinedLine({ claimedCount: 1240 }) === '1,240 joined', 'states the count, grouped');
ok(joinedLine({ claimedCount: 1 }) === '1 joined', 'one person still counts');
ok(joinedLine({ claimedCount: 0 }) === null,
  '"0 joined" is never shown — it reads as an empty room, and a brand-new offer is exactly when it would appear');
ok(joinedLine({}) === null, 'absent is silent');
ok(joinedLine({ claimedCount: null }) === null, 'null is silent');
ok(joinedLine(null) === null, 'no campaign is silent');
ok(joinedLine({ claimedCount: '5' }) === null, 'a string count is not trusted');

console.log('\n=== the two numbers are never re-derived on the device ===');
{
  // The defect this prevents: computing seatsLeft as totalSlots - claimedCount
  // here. That would be a second definition of a remaining seat, and the feed
  // would offer seats the claim gate refuses — the app lying to the user.
  const src = readFileSync(join(HERE, 'seats.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  ok(!/totalSlots/.test(src), 'seats.js never even looks at totalSlots');
  ok(!/-\s*campaign\.claimedCount|claimedCount\s*-/.test(src), 'and does no arithmetic on the counts');
}

console.log('\n=== the screens read the helper, not the raw fields ===');
{
  // A screen formatting `${c.seatsLeft} slots left` itself would bypass every
  // silence above — which is the only reason this file exists.
  const strip = (p) => readFileSync(join(HERE, '..', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const screen of ['HomeScreen.js', 'DetailScreen.js']) {
    const src = strip(screen);
    ok(/seatsLine|joinedLine|isFullCampaign/.test(src), `${screen} uses the helper`);
    ok(!/slots left|All seats taken|joined`|joined'/.test(src),
      `${screen} does not format the copy itself`);
    ok(!/seatsLeft\s*[-+<>]|claimedCount\s*[-+<>]/.test(src),
      `${screen} does no arithmetic or comparison on the raw counts`);
  }
}

console.log('\n=== A FULL OFFER IS LOCKED, NOT GONE — 18 September 2026 ===');
{
  const FULL = { seatsLeft: 0, ticketCost: 5, id: 'c1' };
  const OPEN = { seatsLeft: 3, ticketCost: 5, id: 'c2' };

  // ── IT SAYS ALL THREE THINGS, IN THE OWNER'S OWN ORDER ──────────────────
  //
  // "It was active, now the slots are full, so it has been locked, and it will
  // come back soon." Any one of the three alone misleads: "was open" without
  // "full now" does not explain why they cannot take it, and "full now" without
  // "comes back" is the dead end "Full" used to be.
  const why = lockedReason(FULL);
  ok(Array.isArray(why) && why.length === 2, 'a locked offer has something to say');
  const all = why.join(' ');
  ok(/was open/.test(all), 'IT WAS OPEN — so somebody who saw it yesterday is not imagining it');
  ok(/every slot is now taken/.test(all), 'IT IS FULL NOW — which is why they cannot take it');
  ok(/comes back/.test(all), 'AND IT COMES BACK — the part "Full" threw away');
  ok(/has not ended/.test(all), 'and it says plainly that it has not ended');

  // ── AND IT PROMISES NO TIME NOBODY KNOWS ────────────────────────────────
  //
  // A slot frees when a claim closes or an operator raises the cap, and neither
  // is on a clock. "Soon" is the owner's word for it and it is deliberately not
  // in these sentences, because it would come back as a broken promise.
  ok(/nobody can say when/.test(all), 'it says outright that nobody knows when');
  for (const promise of [
    'soon', 'shortly', 'tomorrow', 'in a few', 'within', 'hours', 'days',
    'minutes', '24', '48', 'later today',
  ]) {
    ok(!all.toLowerCase().includes(promise), `it does not promise "${promise}"`);
  }

  // ── AND "Full" IS GONE FROM ALL OF IT ───────────────────────────────────
  ok(LOCKED_CTA === 'Locked', 'the tile says Locked');
  ok(LOCKED_CTA !== 'Full', 'and never Full, which reads as a dead end');
  ok(/Locked/.test(LOCKED_BANNER) && /every slot is taken/.test(LOCKED_BANNER),
    'and the banner carries both the state and the reason');
  ok(lockedLine(FULL) === 'Comes back when a slot opens',
    'and the footer line carries what happens next');

  // ── SILENCE FOR AN OFFER THAT IS NOT FULL, the same shape as the rest ───
  for (const notFull of [OPEN, { seatsLeft: null }, {}, null, undefined,
    { seatsLeft: 'nought' }, { seatsLeft: 1 }]) {
    ok(lockedLine(notFull) === null, 'an offer that is not full has no locked line');
    ok(lockedReason(notFull) === null, 'and no locked reason');
  }
  ok(lockedLine({ seatsLeft: -4 }) !== null, 'a negative remainder is still full');
}

console.log('\n=== the locked offer is DRAWN, still in the list, and not claimable ===');
{
  const strip = (p) => readFileSync(join(HERE, '..', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const home = strip('HomeScreen.js');
  const detail = strip('DetailScreen.js');

  // THE WORDING IS DRAWN AND "Full" IS NOT.
  ok(/LOCKED_BANNER/.test(home) && /LOCKED_CTA/.test(home),
    'the tile draws the locked banner and the locked call to action');
  ok(/lockedLine\(c\)/.test(home), 'and the footer line');
  ok(!/'Full'/.test(home), 'and the word "Full" is gone from the tile');
  ok(/lockedReason\(campaign\)/.test(detail), 'the detail screen draws the reason');

  // ── IT IS STILL IN THE LIST. PRESENT, NOT FILTERED OUT ──────────────────
  //
  // The owner's words: "I don't want the campaign to go away or vanish from the
  // app once the slot is full." Nothing filtered it before this change either —
  // the backend's listActive filters on status and never on seats — and this is
  // what stops somebody adding a filter later.
  // ── WRITTEN TWICE, BECAUSE THE FIRST WRITING WAS DEAD ──────────────────
  //
  // It was `/\.filter\([^)]*isFullCampaign/`, and it can never match: the text
  // between `.filter(` and the first `)` in `.filter((c) => !isFullCampaign(c))`
  // is just `(c`, so the class stops before the word it was hunting. The
  // mutation that filters full offers out of the feed passed the whole suite.
  // Caught by breaking it, which is the only reason it is not still there.
  //
  // SO THE LIST IS READ, NOT PATTERN-MATCHED. Every `.filter(` in the screen is
  // taken with what follows it and held to the rule.
  ok(/\bcampaigns\.map\(/.test(home),
    'the feed draws the store\u2019s own list, with nothing between it and the map');
  for (const at of [...home.matchAll(/\.filter\(/g)].map((m) => m.index)) {
    const clause = home.slice(at, at + 160);
    for (const dropped of ['isFullCampaign', 'seatsLeft', 'full', 'locked']) {
      ok(!clause.includes(dropped),
        `a filter in HomeScreen drops offers by ${dropped}: ${clause.slice(0, 60)}`);
    }
  }
  for (const src of [home, strip('backend/campaignStore.js')]) {
    ok(!/seatsLeft\s*<=\s*0/.test(src),
      'and nothing drops a full offer on the way to the screen');
  }
  // AND THE TILE IS STILL A TILE: same Card, same onPress, no early return.
  ok(/<Card onPress=\{onOpen\}/.test(home), 'a locked offer is still tappable');
  ok(!/if \(locked\) return null/.test(home), 'and its card is never skipped');

  // ── IT MUST NOT LOOK CLAIMABLE, AND THE GUARD IS UNTOUCHED ──────────────
  //
  // "Locked" is not "Claim". What is ALLOWED is not this phase's business: the
  // server owns the refusal and answers in its own words, which is the decision
  // already recorded beside the seats row, and a dead button explains nothing.
  ok(/locked \? LOCKED_CTA/.test(home), 'a locked tile says Locked and not Claim');
  ok(/full[\s\S]{0,40}'Locked \u00b7 every slot is taken'/.test(detail),
    'and the detail screen\u2019s button says so too');
  ok(/disabled=\{!claimed && !acceptedTerms\(accepted\)\}/.test(detail),
    'THE EXISTING GUARD IS EXACTLY AS IT WAS — this changed what is drawn, not what is allowed');
  ok(!/disabled=\{[^}]*full/.test(detail),
    'and nothing new disables the claim button on fullness');

  // ── LOCKED IS NOT "NOT RIGHT NOW", AND THE SHOP'S PAGE OUTRANKS IT ──────
  //
  // A dead shop page is a problem a freed slot would not fix, so when both are
  // true the person is told the one that matters.
  ok(/const locked = full && !off && !claimed;/.test(home),
    'a locked banner is not drawn over a shop whose page has died');
  // ── AND NEVER OVER A SEAT THE PERSON IS SITTING IN — 21 SEPTEMBER 2026 ──
  //
  // The owner made a one-slot offer, claimed it, and his home screen told him
  // "Come back when a slot opens" about the seat he was holding. His claim was
  // only findable through My Products, so one offer said two different things in
  // two places. `claimed` was already handed to the row and never consulted.
  //
  // seats.js IS UNTOUCHED BY THIS. The server's count is right and "All seats
  // taken" is a true sentence about a count. What was wrong was reading a count
  // about everybody as a sentence about this one person.
  ok(/claimed={hasTask\(c\.id\)}/.test(home),
    'the row is told whether this person holds a claim');
  ok(/function CampaignRow\(\{ c, claimed, onOpen \}\)/.test(home),
    'and takes it, so the locked line can ask');
  ok(/off \? live\.cta : locked \?/.test(home),
    'and the shop\u2019s own state is asked first');
  ok(/lockedBanner/.test(home) && /offBanner/.test(home),
    'the two states have two different banners and cannot be mistaken for each other');
}

console.log('\n=== and a PAUSED campaign is a different fact entirely ===');
{
  // IT IS NOT IN THE FEED AT ALL, which is why there is no wording for it. The
  // backend's listActive filters on status and sends only ACTIVE campaigns, so a
  // paused offer and a locked one can never be confused: one is absent and the
  // other is present and says so.
  const service = readFileSync(
    join(HERE, '..', '..', 'backend', 'src', 'campaigns', 'campaign.service.ts'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/where: \{ status: 'ACTIVE'/.test(service),
    'listActive sends only ACTIVE campaigns, so a PAUSED one never reaches a screen');
  ok(!/seatsLeft|claimedCount/.test(service.slice(service.indexOf('listActive'),
    service.indexOf('claimedSeats'))),
    'AND IT NEVER FILTERS ON SEATS — a full offer was never dropped from the feed');
  // AND THE APP HAS NO WORDING FOR PAUSED, because there is nothing to draw.
  // STRIPPED FIRST. seats.js EXPLAINS the difference between paused, locked and
  // "not right now" at length, so reading the file whole would be matching the
  // very prose that says the word is not in the code.
  const words = readFileSync(join(HERE, 'seats.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  ok(!/PAUSED|Paused|paused/.test(words),
    'seats.js says nothing about paused, which is the honest amount to say');
  ok(!/status/.test(words),
    'and it never looks at a campaign status at all — that is the server\u2019s filter');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
