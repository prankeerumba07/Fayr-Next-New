import { readFileSync } from 'fs';
import {
  STATES, BLOCKERS, SOURCES, DAY, createTask, transition, readAmazonEvidence,
  resolveDeliveryDate, refundEligibility, shouldRecheckVisibility, describe, createPolicy,
} from './taskflow.js';

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  PASS '+m);} else {fail++;console.log('  FAIL '+m);} };

console.log('=== 1. delivery year derivation (Amazon gives "5 June", no year) ===');
const d1=resolveDeliveryDate('5 June','2 June 2026');
ok(d1===Date.parse('5 June 2026'), 'plain: "5 June" + order 2026 -> '+new Date(d1).toDateString());
const d2=resolveDeliveryDate('3 January','28 December 2026');
ok(d2===Date.parse('3 January 2027'), 'Dec->Jan rollover -> '+new Date(d2).toDateString());
ok(resolveDeliveryDate('5 June 2026','2 June 2026')===Date.parse('5 June 2026'), 'explicit year passes through');
ok(resolveDeliveryDate('5 June',null)===null, 'no order anchor -> null (refuses to guess)');
const dj=resolveDeliveryDate('5 January','1 January 2027');
ok(dj===Date.parse('5 January 2027'), 'local/UTC year bug: order 1 Jan 2027 IST -> '+new Date(dj).toDateString());

console.log('\n=== 2. real captured payload ===');
const raw=JSON.parse(readFileSync('/private/tmp/claude-501/-Users-prakashtamang-FAYR-Review-Verifier/6cd81486-5ed5-4775-b27f-a0b8e53d5f2b/scratchpad/captures6/fayr-amazon-1784116808818.json','utf8'));
const ev=readAmazonEvidence(raw,{asin:'B0CDX8FTFY'});
ok(ev.blocker===null,'no blocker on a good order');
ok(ev.order && ev.order.id==='408-5094957-4481129','order id from real payload: '+(ev.order&&ev.order.id));
ok(ev.order && ev.order.amount===249,'amount parsed 249.00 -> '+(ev.order&&ev.order.amount));
ok(ev.order && ev.order.source===SOURCES.ORDER_DETAILS,'source tagged order-details');
ok(ev.delivery && ev.delivery.at===Date.parse('5 June 2026'),'delivery "5 June" resolved -> '+(ev.delivery&&new Date(ev.delivery.at).toDateString()));
ok(ev.review.published===true,'published true (permalink 200)');
ok(ev.returned===false,'returned false (proven)');
ok(ev.review.reviewDate===null,'reviewDate NOT surfaced (selector is broken) ');

console.log('\n=== 3. full happy path ===');
let t=createTask({id:'t1',asin:'B0CDX8FTFY',category:'grocery'});
const P=createPolicy({byCategory:{grocery:0}});
ok(t.state===STATES.CLAIMED,'starts CLAIMED');
t=transition(t,{type:'EVIDENCE',key:'e1',evidence:ev,at:1}).task;
ok(t.state===STATES.DELIVERED,'evidence -> DELIVERED (order+delivery present) got '+t.state);
t=transition(t,{type:'CONFIRM_ORDER',key:'c1',at:2}).task;
t=transition(t,{type:'MARK_REVIEWED',key:'m1',at:3}).task;
ok(t.state===STATES.REVIEWED,'-> REVIEWED');
t=transition(t,{type:'START_HOLD',key:'h1',at:4}).task;
ok(t.state===STATES.HOLDING,'-> HOLDING');
const after=ev.delivery.at+1*DAY;
const r=transition(t,{type:'RELEASE_REFUND',key:'r1',at:after,policy:P});
ok(r.task.state===STATES.REFUNDED,'window elapsed + published + not returned -> REFUNDED');

console.log('\n=== 4. idempotency + atomicity ===');
const again=transition(r.task,{type:'RELEASE_REFUND',key:'r1',at:after,policy:P});
ok(again.changed===false,'replaying same key is a no-op');
const t2=transition(t,{type:'MARK_REVIEWED',key:'m1',at:9});
ok(t2.changed===false && t2.task===t,'duplicate key returns the SAME object (no partial apply)');
const bad=transition(createTask({id:'x'}),{type:'MARK_REVIEWED',key:'z',at:1});
ok(bad.rejected===true && bad.task.state===STATES.CLAIMED,'reject leaves task untouched: '+bad.reason);

console.log('\n=== 5. refund gate: each condition blocks independently ===');
const early=refundEligibility(t,ev.delivery.at-DAY,createPolicy({byCategory:{grocery:7}}));
ok(!early.eligible && early.reasons.some(x=>/window ends/.test(x)),'window not elapsed blocks: '+early.reasons.join('|'));
const gone={...t,review:{...t.review,published:false}};
ok(!refundEligibility(gone,after,P).eligible,'unpublished blocks');
const ret={...t,returned:true};
ok(!refundEligibility(ret,after,P).eligible,'returned blocks');
const unk={...t,returned:null};
ok(!refundEligibility(unk,after,P).eligible,'returned UNKNOWN blocks (fails closed)');

console.log('\n=== 6. deleted review during HOLDING ===');
let h=transition(t,{type:'VISIBILITY_CHECK',key:'v1',published:false,at:100});
ok(h.task.state===STATES.REVIEWED,'review vanished -> regress HOLDING->REVIEWED');
ok(!refundEligibility(h.task,after,P).eligible,'and refund is blocked');
const back=transition({...h.task,review:{...h.task.review,published:true}},{type:'START_HOLD',key:'h2',at:200}).task;
ok(back.state===STATES.HOLDING,'re-enters HOLDING when public again');
ok(refundEligibility(back,after,P).windowEndsAt===refundEligibility(t,after,P).windowEndsAt,'window anchored to DELIVERY, not hold start (no restart penalty)');
ok(shouldRecheckVisibility(back,300+DAY,DAY)===true,'recheck due after interval');

console.log('\n=== 7. gap 2: signinRedirect -> reconnect ===');
const rawSignin={...raw,__amazonOrdersSample:{...raw.__amazonOrdersSample,orderDetailProbe:[{orderid:'x',signinRedirect:true}]}};
const evS=readAmazonEvidence(rawSignin,{asin:'B0CDX8FTFY'});
ok(evS.blocker===BLOCKERS.RECONNECT,'signin -> RECONNECT blocker');
let ts=transition(createTask({id:'s',asin:'B0CDX8FTFY'}),{type:'EVIDENCE',key:'e',evidence:evS,at:1}).task;
ok(ts.state===STATES.CLAIMED && ts.blocker===BLOCKERS.RECONNECT,'task stalls, does not advance');
ok(describe(ts,1,P).gaps[0].action==='reconnect','UI told to reconnect, not shown blanks');
ok(describe(ts,1,P).order===null,'order is null (gap rendered, not an empty card)');

console.log('\n=== 8. gap 1: empty detail page -> DKIM, never blanks ===');
const rawEmpty={...raw,reviews:raw.reviews.map(r=>({...r,ordersource:undefined,orderid:undefined}))};
const evE=readAmazonEvidence(rawEmpty,{asin:'B0CDX8FTFY'});
ok(evE.blocker===BLOCKERS.ORDER_UNREADABLE,'unreadable order detected');
ok(evE.fallback===SOURCES.DKIM,'routes to DKIM');
ok(evE.review && evE.review.published===true,'review facts still usable (permalink independent of orders)');
const te=transition(createTask({id:'e',asin:'B0CDX8FTFY'}),{type:'EVIDENCE',key:'e',evidence:evE,at:1}).task;
ok(te.order===null && describe(te,1,P).gaps.some(g=>g.action===SOURCES.DKIM),'UI shows DKIM gap, order stays null');

console.log('\n=== 9. gap 3: policy table per category ===');
const pol=createPolicy({defaultDays:7,byCategory:{electronics:10}});
const te2={...t,category:'electronics'};
const w1=refundEligibility(te2,after,pol).windowEndsAt;
ok(w1===ev.delivery.at+10*DAY,'electronics -> 10 days from delivery');
const td={...t,category:'unknown-thing'};
ok(refundEligibility(td,after,pol).windowEndsAt===ev.delivery.at+7*DAY,'unknown category -> defaultDays');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
