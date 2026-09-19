// WHAT THE SHOP STEP SHOWS. THE DECISION ONLY — NOTHING DRAWN.
//
// ── THE STEP HAS MORE THAN ONE FACE NOW, AND THE OWNER'S FIVE TASKS SAY WHY ─
//
// "There are 5 different tasks: Claim, Buy, Delivered, Review, Refund." Buy is
// not over when the payment goes through: it is over when Fayr has read the
// order off the shop's own page and the server has matched it. So the journey's
// one step for buying has five faces, met in this order:
//
//   enter      nothing has been watched yet. The step is a door into the shop,
//              exactly as Phase 7 built it — see src/screens/shop.js.
//   telling    an order was watched a moment ago and the key is on its way to
//              our side, parked in the outbox for the next foreground. Nothing
//              can be read until our side has it; say so, and wait.
//   read-now   an order was watched, our side has the key, and the cadence
//              allows a look. Start the read of THAT ONE order's page. No tap.
//   waiting    an order was watched and a look ran too recently. Say so, say
//              when the next one is, and offer the shop again.
//   refused    an order was watched and our side has refused it — the order
//              window, or a page it could not count. Show our side's own words
//              and stop looking: another look at the same page cannot change a
//              rule's answer.
//
// ── WHY FACES OF THE STEP AND NOT A NEW STEP ───────────────────────────────
//
// A new step would mean a new design key, a new file, a thirteenth segment on
// every tracker, and a step the four other shops never reach. What is actually
// true is smaller: the Buy step is not finished until the order is read, and
// this file says which part of it somebody is in.
//
// PURE. No React, no fetch, no clock — `mayLookNow` is handed in, decided by
// src/journey/deliveryCadence.js, which the delivery step already asks for the
// same page. One floor between looks per task, whichever step is asking.

export const SHOP_FACES = ['enter', 'telling', 'read-now', 'waiting', 'refused'];

/**
 * WHICH OF THE FIVE IS THIS?
 *
 * `watchedOrderKey`    the key off the RECORD, or null. With none, the door —
 *                      unless the next argument says the key is on its way.
 * `waitingForOurSide`  the phone has told our side a key and our side has not
 *                      answered yet: the body is in the outbox. True means the
 *                      order was watched even though the record cannot say so.
 * `blocker`            the task's blocker, off the record, or null. Our side's
 *                      refusal of the watched order, when there is one.
 * `mayLookNow`         the cadence's answer: may a look start this instant?
 *
 * THE ORDER OF THE TESTS IS THE DESIGN. A refusal beats the cadence, because a
 * look cannot change a rule's answer and a screen that kept looking would be
 * pretending it could. And "telling" is asked only when the record has no key:
 * once our side has answered, the record is the truth and the outbox is empty.
 */
export function shopStepFace({
  watchedOrderKey, waitingForOurSide, blocker, mayLookNow,
} = {}) {
  const watched = typeof watchedOrderKey === 'string' && watchedOrderKey.trim() !== '';
  if (!watched) return waitingForOurSide === true ? 'telling' : 'enter';
  if (typeof blocker === 'string' && blocker !== '') return 'refused';
  return mayLookNow === true ? 'read-now' : 'waiting';
}
