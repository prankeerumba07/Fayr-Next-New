// ONE AUTOMATIC READ OF THE SHOP PER TASK, AND A NOTE SAYING IT HAPPENED.
//
// The delivery step reads the person's own order page rather than asking them
// whether their parcel came. That read is src/order/LookingForItScreen.js — the
// same read the purchase step runs, not a second copy of it — and the delivery
// screen starts it by itself the moment it opens.
//
// WHICH NEEDS A NOTE, OR IT NEVER STOPS. The read hands back to the journey when
// it is done. If the shop's page still says nothing about a delivery, the journey
// works out the same step again, the delivery screen opens again, and it would
// start the same read again, for ever. This is the note that makes it once.
//
// ── KEYED BY THE TASK AND NOT BY THE CAMPAIGN ─────────────────────────────
//
// Deliberately, and it is the difference between a bug and not one. A note
// against a CAMPAIGN outlives the claim that wrote it: somebody who leaves an
// offer and claims it again gets a fresh task and the old note, and would be told
// their shop had already been looked at for a claim that no longer exists. A task
// id is made once and never reused, so a new claim cannot inherit anything.
//
// ── AND IT IS NOT WRITTEN DOWN ANYWHERE ───────────────────────────────────
//
// It lives in memory for as long as the app is open and no longer. That is the
// honest lifetime of the fact it holds: "we have already looked, in this sitting".
// Looking again tomorrow is right — the parcel may have arrived overnight — and
// looking again costs one read of a page the person is already signed in to.
// Nothing here is worth surviving a restart, so nothing here does.

/** Task ids we have already started an automatic delivery read for. */
const looked = new Set();

/** Have we already looked at the shop for this task, in this sitting? */
export function alreadyLookedForDelivery(taskId) {
  return typeof taskId === 'string' && taskId !== '' && looked.has(taskId);
}

/** Remember that we looked. Ignores an empty id rather than storing one. */
export function rememberWeLookedForDelivery(taskId) {
  if (typeof taskId !== 'string' || taskId === '') return;
  looked.add(taskId);
}

/**
 * Forget every note. For checks only, so one does not leak into the next.
 *
 * Nothing in the app calls this: there is no moment in a person's use of Fayr
 * when "we already looked" stops being true while the app is still open.
 */
export function forgetEveryDeliveryLook() {
  looked.clear();
}
