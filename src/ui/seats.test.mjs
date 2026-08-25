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
import { seatsLine, joinedLine, isFullCampaign } from './seats.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
