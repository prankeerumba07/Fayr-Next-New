// THE ORDER FAYR WATCHED: TOLD ONCE, TO OUR SIDE, AND THEN FAYR'S OWN PAGE — Phase 8A, Task 2.
//
// Two things are worth proving hardest. That the body sent to our side carries
// the key and NOTHING the engine would act on — a place to look is not a fact
// about money. And that the two identifiers, the key in the address and the
// number on the page, never land in each other's column on either side.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANNOT_TELL, NOT_PLACED, PLACED } from './theOrderPlaced.js';
import {
  WATCHED_ORDER_KEY_PREFIX, whatToTellOurSide, whereToHandOver,
} from './theWatchedOrder.js';

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

const KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';

console.log('=== 1. WHAT IS TOLD: THE KEY, ONCE, AND NOTHING THE ENGINE READS ===');
{
  const tell = whatToTellOurSide({ said: PLACED, orderKey: KEY, alreadyTold: new Set() });
  ok(tell != null && tell.body != null, 'a placed order with a key is told');
  ok(tell.body.watchedOrderKey === KEY, 'the body carries the key');
  ok(tell.body.key === `${WATCHED_ORDER_KEY_PREFIX}${KEY}`, 'under an idempotency key that names it');
  ok(Object.keys(tell.body).sort().join(',') === 'key,watchedOrderKey',
    'AND NOTHING ELSE: no order, no delivery, no review, no blocker, no returned');
  // THE SAME SHAPE THE SERVER'S DTO ACCEPTS FOR AN IDEMPOTENCY KEY.
  ok(/^[A-Za-z0-9:._-]{1,200}$/.test(tell.body.key), 'and the idempotency key is one the server takes');

  ok(whatToTellOurSide({ said: PLACED, orderKey: KEY, alreadyTold: new Set([KEY]) }) === null,
    'A KEY ALREADY TOLD IS NOT TOLD AGAIN');
  ok(whatToTellOurSide({ said: PLACED, orderKey: KEY, alreadyTold: [KEY] }) === null,
    'whether the memory is a set or a list');
  ok(whatToTellOurSide({ said: NOT_PLACED, orderKey: KEY }) === null, 'a page that placed nothing tells nothing');
  ok(whatToTellOurSide({ said: CANNOT_TELL, orderKey: KEY }) === null, 'nor does one nobody could read');
  ok(whatToTellOurSide({ said: PLACED, orderKey: null }) === null, 'and PLACED with no key tells nothing');
  for (const bad of ['a/b', 'a b', 'a?b', '', 7, {}]) {
    ok(whatToTellOurSide({ said: PLACED, orderKey: bad }) === null,
      `${JSON.stringify(bad)} is not a key and is not sent`);
  }
  ok(whatToTellOurSide() === null && whatToTellOurSide({}) === null, 'and nothing at all is nothing');
}

console.log('\n=== 2. WHERE THE SHOP SCREEN HANDS OVER ===');
{
  const withKey = whereToHandOver({ orderKey: KEY });
  ok(withKey.to === 'Journey', 'WITH A KEY: FAYR’S OWN TASK PAGE, in the owner’s words');
  ok(withKey.writesTheLookedNote === false, 'and no note: the key on the record is what says an order was seen');
  const without = whereToHandOver({ orderKey: null });
  ok(without.to === 'LookingForIt', 'without one: the list read, exactly as Phase 7 left it');
  ok(without.writesTheLookedNote === true, 'with the note written before the move');
  ok(whereToHandOver({}).to === 'LookingForIt' && whereToHandOver().to === 'LookingForIt',
    'and nothing at all is the old path');
  ok(whereToHandOver({ orderKey: 'a/b' }).to === 'LookingForIt', 'a key that is not a key is no key');
}

console.log('\n=== 3. THE SHOP SCREEN WIRES IT, AND DECIDES NOTHING ITSELF ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/import \{ syncEvidence \} from '\.\.\/backend\/evidenceSync';/.test(screen),
    'THE EXISTING DEVICE-EVIDENCE ROUTE, with its outbox and its retry, and nothing new');
  ok(/import \{ whatToTellOurSide, whereToHandOver \} from '\.\/theWatchedOrder';/.test(screen),
    'and both decisions come from next door');
  ok((screen.match(/syncEvidence\(/g) || []).length === 1, 'one POST site');
  ok(/syncEvidence\(taskId, tell\.body\)/.test(screen), 'sending the body the decision built');
  // TOLD ONCE: the memory is written BEFORE the POST goes out.
  const remembered = screen.indexOf('toldKeys.current.add(out.orderKey);');
  const posted = screen.indexOf('syncEvidence(taskId, tell.body)');
  ok(remembered > -1 && posted > remembered, 'the key is remembered before the request leaves, so a repeat cannot race it');
  ok(/setOrderKey\(\(have\) => \(have == null \? out\.orderKey : have\)\);/.test(screen),
    'and the FIRST key seen is the one kept for the session');
  ok(!/setOrderKey\(null\)/.test(screen), 'and it is never unset');

  // THE HAND-OFF: one decision, made in two places by the same function.
  ok((screen.match(/const handOff = whereToHandOver\(\{ orderKey \}\);/g) || []).length === 2,
    'the timer and the back tap ask the same one question');
  ok((screen.match(/navigation\.replace\(handOff\.to, \{ campaignId \}\)/g) || []).length === 2,
    'and go where it says');
  ok(/if \(handOff\.writesTheLookedNote\) markVisitedShop\(campaignId, LOOKED_FOR_THE_ORDER\);/.test(screen),
    'writing the note only on the path that needs it');
  // AND THE HAND-OFF WAITS FOR OUR SIDE TO ANSWER, so the task page it lands on
  // can see the key. A parked body is an answer too.
  ok(/Promise\.resolve\(told\.current\)\.then\(\(\) => \{[\s\S]{0,400}navigation\.replace\(handOff\.to/.test(screen),
    'the timer’s move waits for the POST to settle');
  // THE FLAG MOVES INTO THE TIMER'S CALLBACK, or the key arriving as its own
  // piece of state would re-run the effect, find the flag set, and never move.
  ok(/const t = setTimeout\(\(\) => \{\s*if \(handedOver\.current\) return;\s*handedOver\.current = true;/.test(screen),
    'the once-only flag is set when the move happens, inside the pause');
  ok(/\}, \[orderSeen, orderKey, campaignId, navigation\]\);/.test(screen),
    'and the key is a dependency, so the pause is measured from the last thing learned');

  // THE ORDER LANDING TAKES THE KEY, NEVER THE NUMBER.
  ok(/theOrderPage\(howThisShopNamesAnOrder\(key\), params\.orderKey\)/.test(screen),
    'the review step’s door is built from the key');
  ok(!/params\.orderId/.test(screen), 'and never from the order number');

  // NO SECOND NOTION OF "CAME BACK". insideFayr.js already tracks wentToPayAt.
  ok((screen.match(/AppState\.addEventListener/g) || []).length === 1,
    'one app-state listener, the one Phase 1 wrote');
  ok(/comingBackFromPaying\(\{/.test(screen), 'and the return is still decided by insideFayr.js');
  ok(!/onResume|didBecomeActive|cameBackFromPayment/.test(screen), 'and nothing new listens for a return');

  // THE BAR STILL SAYS "ORDER PLACED" AS IT DID.
  ok(/orderPlaced: orderSeen,/.test(screen), 'the bar is told the order was seen, as before');
  ok(/if \(out\.said === PLACED\) setOrderSeen\(true\);/.test(screen), 'by the same flag');

  // AND STILL NOTHING ABOUT MONEY, AND NO READ. The screen tells one fact.
  ok(!/dispatch\(|postEvidence|applyAuthoritative|confirmOrder|markReviewed/.test(screen),
    'the screen moves no task');
  ok(!/refund|wallet|paise/i.test(screen), 'and decides nothing about money');
  ok(!/harvestRendered|openOneOrderWith|parseOrderText|readDetailStep/.test(screen),
    'and reads no order');
}

console.log('\n=== 4. OUR SIDE TAKES IT, ONCE, OUTSIDE THE ENGINE, AND IN ITS OWN COLUMN ===');
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const dto = strip(read('backend/src/tasks/dto/submit-evidence.dto.ts'));
  ok(/@IsOptional\(\) @IsString\(\) @Matches\(WATCHED_ORDER_KEY_SHAPE\) watchedOrderKey\?: string;/.test(dto),
    'the DTO takes the key, bounded to what may be part of an address');
  const rules = strip(read('backend/src/tasks/engine/watched-order.ts'));
  ok(/export const WATCHED_ORDER_KEY_SHAPE = \/\^\[A-Za-z0-9\._-\]\{1,120\}\$\/;/.test(rules),
    'and the shape is the phone’s shape with a length on it');
  const service = strip(read('backend/src/tasks/task.service.ts'));
  const submit = service.slice(service.indexOf('async submitEvidence('), service.indexOf('private async recordWatchedOrderKey('));
  ok(submit.length > 100, 'submitEvidence is where expected');
  ok(submit.indexOf('recordWatchedOrderKey(userId, taskId, dto.watchedOrderKey)') > -1
    && submit.indexOf('carriesOnlyTheWatchedKey(') > -1
    && submit.indexOf('carriesOnlyTheWatchedKey(') < submit.indexOf('return this.runEvent('),
  'THE KEY IS RECORDED FIRST, and a key-only body returns BEFORE the engine runs');
  ok(/where: \{ id: taskId, userId, watchedOrderKey: null \},\s*data: \{ watchedOrderKey: key \}/.test(service),
    'WRITTEN ONCE: conditional on the column still being null, like wentToShopAt');
  ok(!/watchedOrderKey: null,\s*data: \{ orderId/.test(service) && !/orderId: key/.test(service),
    'and never into the order number’s column');
  const schema = read('backend/prisma/schema.prisma');
  ok(/\n  watchedOrderKey String\?\n/.test(schema), 'the column exists, nullable');
  const sql = read('backend/prisma/migrations/20260919090000_watched_order_key/migration.sql')
    .replace(/--.*$/gm, '');
  ok(/ADD COLUMN "watchedOrderKey" TEXT;/.test(sql) && !/NOT NULL|DEFAULT|DROP|UPDATE/i.test(sql),
    'by a migration that adds one nullable column and nothing else');
  ok(/watchedOrderKey: row\.watchedOrderKey \?\? null,/.test(strip(read('backend/src/tasks/task.response.ts'))),
    'and the response carries it back, so a reinstall keeps the place to look');
  ok(/orderId: task\.order\?\.id \?\? null,/.test(strip(read('backend/src/tasks/task.mapper.ts'))),
    'while orderId is still promoted from the page’s number and nothing else');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
