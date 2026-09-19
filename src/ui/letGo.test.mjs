// A CLAIM THAT WAS LET GO TURNS BACK INTO "CLAIM" — Phase 8A, Task 7.
//
// The owner: "'Continue' for ever ... A claim that was released and never
// bought keeps its card on 'Continue'." And the rule: "the card must use that
// same definition" as seats.ts. So the thing proved hardest here is that the
// phone's idea of let-go and the server's idea of a freed seat are the SAME three
// facts — read off seats.ts's own source — and that a REFUNDED task still shows
// as done, because closed does not mean gone.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLetGo } from './letGo.js';
import { closedInfo } from './stages.js';
import { STATES } from '../taskflow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const CLOSED = '2026-09-18T14:00:00.000Z';

console.log('=== 1. THE ONE SHAPE THAT IS LET GO, AND EVERY SHAPE THAT IS NOT ===');
{
  ok(isLetGo({ state: STATES.CLAIMED, closedAt: CLOSED, order: null }) === true,
    'CLOSED, STILL CLAIMED, NO ORDER: LET GO');
  ok(isLetGo({ state: STATES.CLAIMED, closedAt: CLOSED }) === true, 'with the order simply absent too');
  ok(isLetGo({ state: STATES.CLAIMED, closedAt: CLOSED, order: { id: null } }) === true,
    'and an order with no number is no order');
  ok(isLetGo({ state: STATES.CLAIMED, closedAt: null, order: null }) === false,
    'A CLAIM STILL RUNNING IS NOT LET GO');
  ok(isLetGo({ state: STATES.CLAIMED, closedAt: CLOSED, order: { id: 'JKL123' } }) === false,
    'a closed CLAIMED claim WITH an order keeps its place — the ambiguous case seats.ts does not widen to');
  ok(isLetGo({ state: STATES.PURCHASED, closedAt: CLOSED, order: { id: 'JKL123' } }) === false,
    'a purchased claim is not let go, closed or not');
  ok(isLetGo({ state: STATES.REFUNDED, closedAt: CLOSED, order: { id: 'JKL123' } }) === false,
    'A REFUNDED TASK IS NOT LET GO: closed does not mean gone, and it still shows as done');
  for (const st of [STATES.PURCHASED, STATES.DELIVERED, STATES.REVIEWED, STATES.HOLDING, STATES.REFUNDED]) {
    ok(isLetGo({ state: st, closedAt: CLOSED, order: null }) === false,
      `${st} with a close date and no order is still not let go: it moved past CLAIMED`);
  }
  for (const junk of [null, undefined, 'CLAIMED', 7, [], {}]) {
    ok(isLetGo(junk) === false, `${JSON.stringify(junk)} is not a task, and is not let go`);
  }
  // EXACTLY ONE CORNER OF THE GRID FREES. Two states of closedAt, three of
  // state, two of order: twelve rows, one true.
  let trues = 0;
  for (const closedAt of [null, CLOSED]) {
    for (const state of [STATES.CLAIMED, STATES.PURCHASED, STATES.REFUNDED]) {
      for (const order of [null, { id: 'X1' }]) {
        if (isLetGo({ state, closedAt, order })) trues += 1;
      }
    }
  }
  ok(trues === 1, `exactly one row of twelve is let go, found ${trues}`);
}

console.log('\n=== 2. THE SAME THREE FACTS seats.ts EXCLUDES, READ OFF ITS OWN SOURCE ===');
{
  const seats = strip(read('backend/src/campaigns/seats.ts'));
  const taken = seats.slice(seats.indexOf('export const SEAT_TAKEN_BY'), seats.indexOf('export function seatIsTakenBy'));
  ok(taken.length > 20, 'SEAT_TAKEN_BY is where expected');
  ok(/NOT: \{\s*closedAt: \{ not: null \},\s*state: 'CLAIMED',\s*orderId: null,\s*\}/.test(taken),
    'the server frees a seat for closed AND CLAIMED AND no order, written as one NOT over one conjunction');
  const twin = seats.slice(seats.indexOf('export function seatIsTakenBy'), seats.indexOf('export function CLAIMED_SEATS_WHERE'));
  ok(/row\.closedAt != null && row\.state === 'CLAIMED' && row\.orderId == null/.test(twin),
    'and its in-memory twin says the same three things');
  const mine = strip(read('src/ui/letGo.js'));
  ok(/closedAt != null && t\.closedAt !== ''/.test(mine) && /t\.state === STATES\.CLAIMED/.test(mine)
    && /t\.order\.id/.test(mine) && /return closed && stillClaimed && noOrder;/.test(mine),
  'and the phone says the same three, in the same conjunction');
  ok(/seats\.ts/.test(read('src/ui/letGo.js')), 'and names seats.ts, so the two are found together when either moves');
  // THE SAME ROWS THROUGH BOTH, by the twin's own arithmetic written here from
  // its source: taken = NOT(closed && CLAIMED && no order). letGo must be its complement.
  const seatIsTakenBy = (row) => !(row.closedAt != null && row.state === 'CLAIMED' && row.orderId == null);
  for (const closedAt of [null, CLOSED]) {
    for (const state of [STATES.CLAIMED, STATES.PURCHASED, STATES.REFUNDED]) {
      for (const orderId of [null, 'X1']) {
        const asTheServerSeesIt = { closedAt, state, orderId };
        const asThePhoneSeesIt = { closedAt, state, order: orderId == null ? null : { id: orderId } };
        ok(isLetGo(asThePhoneSeesIt) === !seatIsTakenBy(asTheServerSeesIt),
          `${state} ${closedAt ? 'closed' : 'open'} ${orderId ? 'with' : 'without'} an order: the phone and the seat agree`);
      }
    }
  }
}

console.log('\n=== 3. hasTask MEANS A LIVE CLAIM, THE CARDS READ IT, AND NOTHING IS FILTERED OUT ===');
{
  const store = strip(read('src/taskStore.js'));
  ok(/import \{ isLetGo \} from '\.\/ui\/letGo';/.test(store), 'the store asks letGo.js');
  ok(/export function hasTask\(campaignId\) \{\s*const e = entries\[campaignId\];\s*return !!\(e && e\.taskId && !isLetGo\(e\.authoritative\)\);\s*\}/.test(store),
    'hasTask is "a task id AND not let go"');
  ok(!/closedAt/.test(store), 'and the store holds no second idea of "closed" anywhere');
  ok(/for \(const tr of answer\.tasks\) applyAuthoritative\(tr\);/.test(store),
    'every task our side sends is still applied — closed ones included');
  ok(!/filter\([^)]*closed|isLetGo\(tr\)/.test(store), 'and none is filtered out on the way in');
  const home = strip(read('src/HomeScreen.js'));
  ok(/hasTask\(c\.id\) \? 'Journey' : 'Detail'/.test(home), 'the Home card opens the journey only for a live claim');
  ok(/claimed \? 'Continue ›' : 'Claim →'/.test(home), 'and says Claim, not Continue, for a claim that was let go');
  ok(/claimed=\{hasTask\(c\.id\)\}/.test(home), 'reading the same one answer');
  const detail = strip(read('src/DetailScreen.js'));
  ok((detail.match(/setClaimed\(hasTask\(campaignId\)\)/g) || []).length >= 2, 'and the Detail page reads it too');
  // OUR SIDE STILL SENDS CLOSED TASKS. Filtering them there would lose REFUNDED history.
  const service = strip(read('backend/src/tasks/task.service.ts'));
  const list = service.slice(service.indexOf('async listForUser('), service.indexOf('async getForUser('));
  ok(list.length > 50 && /where: \{ userId \},/.test(list) && !/closedAt/.test(list),
    'listForUser still returns every task, closed or not — nothing is filtered on our side');
  // AND A REFUNDED TASK STILL SHOWS AS DONE.
  const done = closedInfo({ state: STATES.REFUNDED, closedAt: CLOSED, closeReason: 'refunded' });
  ok(done.closed === true && done.label === 'Refunded', 'a refunded task is closed AND shown as done');
  ok(isLetGo({ state: STATES.REFUNDED, closedAt: CLOSED, order: { id: 'X' } }) === false
    && isLetGo({ state: STATES.REFUNDED, closedAt: CLOSED, order: null }) === false,
  'and is never let go, whatever its order says');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
