// WHERE THE HOME REMINDER CARD SITS, CHECKED AGAINST THE DESIGN ITSELF.
//
// THIS CHECK DOES NOT COPY THE DESIGN'S NUMBERS. It READS them out of
// fayr-design.browser.jsx every time it runs and compares them with what the app
// uses. That is the owner's own requirement, and the reason for it is that a
// check with the numbers typed into it goes on passing after the design changes,
// which is worse than no check at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DESIGN_BOTTOM, DESIGN_CARD_HEIGHT, DESIGN_LAYER, DESIGN_SIDE, GAP_BELOW_LIST,
  bottomAboveBar, roomToReserve,
} from './waitingPlace.js';

let checks = 0;
const ok = (c, what) => { checks += 1; assert.ok(c, what); };
const eq = (a, b, what) => { checks += 1; assert.deepStrictEqual(a, b, what); };

const design = readFileSync(new URL('../../fayr-design.browser.jsx', import.meta.url), 'utf8');
const box = readFileSync(new URL('./WaitingBox.js', import.meta.url), 'utf8');
const home = readFileSync(new URL('../HomeScreen.js', import.meta.url), 'utf8');
const stagebits = readFileSync(new URL('./stagebits.js', import.meta.url), 'utf8');

// ── 1. FIND THE DESIGN'S OWN PLACEMENT, and fail loudly if it moved ──────────
// The one place in the design that fixes the reminder card above the nav. Found
// by its own comment rather than by a line number, so the check survives the file
// growing a line somewhere above.
const marker = 'purchased-product reminder';
const at = design.indexOf(marker);
ok(at > 0, 'the design still has the purchased product reminder on Home');
const placement = design.slice(at, at + 700);

const read = (what, pattern) => {
  const m = pattern.exec(placement);
  ok(m, `the design still states the card's ${what}`);
  return m ? m[1] : null;
};

const designBottom = Number(read('distance from the bottom', /bottom:\s*(\d+)/));
const designSide = Number(read('side margins', /padding:\s*"0\s+(\d+)px"/));
const designLayer = Number(read('layer', /zIndex:\s*(\d+)/));

// ── 2. THE APP USES EXACTLY THOSE NUMBERS ────────────────────────────────────
eq(DESIGN_BOTTOM, designBottom,
  `the design puts the card ${designBottom} from the bottom and the app says ${DESIGN_BOTTOM}`);
eq(DESIGN_SIDE, designSide,
  `the design leaves ${designSide} at the sides and the app says ${DESIGN_SIDE}`);
eq(DESIGN_LAYER, designLayer,
  `the design draws the card on layer ${designLayer} and the app says ${DESIGN_LAYER}`);

// ── 3. AND THE CARD ITSELF ASKS FOR THEM RATHER THAN TYPING ITS OWN ─────────
ok(box.includes("from './waitingPlace.js'"),
  'the card takes its place from the one file that holds the design’s numbers');
ok(box.includes('bottom: bottomAboveBar(tabBarHeight)'),
  'the card sits above the tab bar by the design’s own leftover');
ok(box.includes('paddingHorizontal: DESIGN_SIDE'),
  'the side margins are the design’s, by name');
ok(box.includes('zIndex: DESIGN_LAYER'),
  'the layer is the design’s, by name');
// THE BUG THAT PUT IT IN THE MIDDLE OF THE SCREEN. It stepped over a bar that had
// already been stepped over.
ok(!box.includes('tabBarHeight + 10'),
  'the card no longer adds a whole tab bar on top of a tab bar');

// ── 4. THE SUM THE OWNER SAW, AND THE SUM NOW ────────────────────────────────
// His phone's tab bar is about 83 points: a 49 point row of tabs plus the 34
// point home bar at the very bottom. That is the space the card was floating in.
const HIS_BAR = 83;
eq(bottomAboveBar(HIS_BAR), 0,
  'on his phone the card now sits flush on top of the bar, as the design draws it');
eq(HIS_BAR + 10, 93, 'the old value lifted it 93 points above the bar');
ok(HIS_BAR + 10 - bottomAboveBar(HIS_BAR) >= 80,
  'which is more than a whole tab bar of empty space, which is what he photographed');
// A shorter bar keeps the design's own few points.
eq(bottomAboveBar(57), 13, 'a phone with no home bar keeps the design’s small gap');
eq(bottomAboveBar(70), 0, 'a bar exactly the design’s size sits flush');
// Never negative, never off the bottom of the screen.
for (const bar of [0, 1, 70, 83, 200, -5, NaN, null, undefined, 'tall']) {
  const v = bottomAboveBar(bar);
  ok(typeof v === 'number' && Number.isFinite(v) && v >= 0,
    `a bar of ${String(bar)} still gives a real distance`);
  ok(v <= DESIGN_BOTTOM, 'and never more than the design asks for');
}

// ── 5. THE TONE COLOURS REALLY ARE THE DESIGN'S NOTE_TONE ───────────────────
// Read the design's own table and compare it with the app's, colour by colour.
const toneAt = design.indexOf('const NOTE_TONE');
ok(toneAt > 0, 'the design still has NOTE_TONE');
const toneLine = design.slice(toneAt, design.indexOf('\n', toneAt));
for (const name of ['amber', 'blue', 'purple', 'green']) {
  const m = new RegExp(`${name}:\\s*\\{\\s*bg:\\s*"([^"]+)",\\s*dot:\\s*"([^"]+)"`).exec(toneLine);
  ok(m, `the design still states the ${name} tone`);
  const [, bg, dot] = m;
  const appTone = new RegExp(`${name}:\\s*\\{[^}]*bg:\\s*'([^']+)'[^}]*dot:\\s*([^,}]+)`).exec(stagebits);
  ok(appTone, `the app still states the ${name} tone`);
  eq(appTone[1].toUpperCase(), bg.toUpperCase(), `${name} background matches the design`);
  ok(appTone[2].trim().replace(/'/g, '').toUpperCase() === dot.toUpperCase()
    || appTone[2].includes('COLOR.'),
  `${name} dot matches the design, or is a named colour`);
}

// ── 6. NOTHING IS PERMANENTLY HIDDEN ────────────────────────────────────────
eq(DESIGN_CARD_HEIGHT, 82, 'the design’s card adds up to 82 points tall');
eq(roomToReserve(true), DESIGN_CARD_HEIGHT + GAP_BELOW_LIST,
  'the list leaves the card’s height and a gap at its end');
ok(roomToReserve(true) >= DESIGN_CARD_HEIGHT,
  'the room reserved is never smaller than the card');
eq(roomToReserve(false), 0, 'and nothing is reserved when no card is drawn');
ok(home.includes('paddingBottom: SPACE.xxl + roomForCard'),
  'the home list really adds that room at its end');
ok(home.includes('onRoomNeeded={setRoomForCard}'),
  'and the card is the one that says how much');

// ── 7. THE DESIGN'S TWO LAYERS FOR TAPS ─────────────────────────────────────
ok(placement.includes('pointerEvents: "none"'),
  'the design’s wrapper takes no taps');
ok(placement.includes('pointerEvents: "auto"'),
  'and the card inside it does');
// CHANGED ON 2 SEPTEMBER 2026, AND THE OLD FORM OF THIS LINE WAS WRONG.
//
// It used to require the app to write the design's two words, "none" then "auto",
// straight into the file. It did, and the whole card went dead: on a phone "none"
// switches taps off for a view AND everything inside it, before it looks at a
// child, so the "auto" was never read. The design's idiom is a web one and does
// not survive the crossing.
//
// The value that MEANS what the design means is box-none: the strip takes no taps,
// the card inside it does. So the app is now required to use it, and required not
// to use the word that broke it. The whole rule, with React Native's own code
// quoted, is in src/ui/pointerEvents.test.mjs. This is NOT a weaker check: it went
// from asking for a word to asking for the behaviour the design is after.
ok(box.includes('pointerEvents="box-none"'),
  'the strip around the card must refuse taps on ITSELF and let the card work, so '
  + 'empty space beside the card does not swallow a tap meant for the campaign behind');
ok(box.includes('pointerEvents="auto"'),
  'and the card inside it says out loud that it takes taps, as the design does');
ok(!/pointerEvents="none"/.test(box),
  'nothing on this card may refuse every tap; that is the defect where the cross, '
  + 'the card and the dots all went dead at once');

// ── 8. THE ROTATION IS THE DESIGN'S OWN TIMING ──────────────────────────────
const rotateAt = design.indexOf('function RotatingStatusCard');
ok(rotateAt > 0, 'the design still has the rotating card');
// The interval the setInterval itself runs on, not the 200 millisecond fade
// inside it. Anchored on the clearInterval that follows it, so the two can never
// be confused: the fade has no clearInterval under it.
const rotate = /\},\s*(\d{3,5})\);\s*\n\s*return \(\) => clearInterval/
  .exec(design.slice(rotateAt, rotateAt + 900));
ok(rotate, 'the design still states how often it changes');
const designRotate = Number(rotate[1]);
eq(designRotate, 3500, 'the design changes the card every 3500 milliseconds');
ok(box.includes(`const ROTATE_MS = ${designRotate};`),
  `the app uses the design's own ${designRotate}`);

// ── 9. THE CROSS CLOSES THE WHOLE BOX ───────────────────────────────────────
//
// The owner's words: "when I click on it, it should vanish. The box should
// vanish. It should not show me the next notification. It should clearly vanish."
//
// It used to close one MESSAGE, keyed by dismissKeyFor, so closing one showed the
// next. These read the card's own source and hold it to what he asked for.
const noComments = box
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

// ONE FLAG FOR THE WHOLE BOX, not a set of messages.
ok(noComments.includes('let boxClosed = false;'),
  'there is one flag for the whole box');
ok(!/const closed = new Set\(\)/.test(noComments),
  'and no set of closed messages any more');

// THE CROSS SETS THAT FLAG AND NOTHING ELSE.
const crossAt = noComments.indexOf('const dismiss = useCallback(');
ok(crossAt > 0, 'the cross still has its own handler');
const cross = noComments.slice(crossAt, noComments.indexOf('}, [', crossAt) + 8);
ok(cross.includes('boxClosed = true'), 'the cross closes the box');
ok(cross.includes('setGone(true)'), 'and tells the screen to redraw without it');
// IT MUST NOT MOVE TO THE NEXT ONE. Those were the two lines that did.
ok(!cross.includes('setIdx('), 'the cross does not move to another reminder');
ok(!cross.includes('dismissKeyFor'), 'and it is not keyed to one message');

// AND ONCE CLOSED, THERE IS NOTHING LEFT TO DRAW.
ok(noComments.includes('const boxes = gone ? [] : waitingBoxes('),
  'once closed there are no reminders at all, so nothing can take its place');

// SLIDING SIDEWAYS STAYS. The owner asked for that to keep working.
ok(noComments.includes('setIdx(k)'), 'tapping a dot still moves between reminders');
ok(noComments.includes(`const ROTATE_MS = ${designRotate};`),
  'and it still changes by itself on the design’s own timing');

// dismissKeyFor is kept because the dots still need a stable key per reminder,
// which is exactly what the owner allowed.
ok(box.includes('key={dismissKeyFor(b)}'),
  'dismissKeyFor is still used, for the dots’ own keys');

console.log(`waitingPlace: ${checks} checks passed in total`);
