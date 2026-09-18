// HOW OFTEN FAYR LOOKS FOR A DELIVERY BY ITSELF, AND WHY THAT OFTEN.
//
// ── THE STEP THIS IS FOR ────────────────────────────────────────────────────
//
// Phase 7, 18 September 2026: for a shop inside Fayr there is no "is the product
// delivered?" screen and no tap. The owner: "delivery fetches itself. No screen,
// no tap." The read that fetches it already exists — LookingForItScreen, handed
// the one order number the record carries — and what this file decides is WHEN
// the journey may start it without being asked.
//
// ── TWO THINGS PULL IN OPPOSITE DIRECTIONS ─────────────────────────────────
//
// A QUICK-COMMERCE PARCEL ARRIVES IN ABOUT TEN MINUTES. Zepto's own promise is
// that order of time, so a look that waited an hour would leave the review step
// shut for most of an hour after the thing was in somebody's hand.
//
// A LOOK IS A REQUEST TO THE SHOP, FROM THE PERSON'S OWN SIGNED-IN SESSION. The
// delivery screen's own note says what too many of those cost: "Fayr does not go
// asking a shop for pages every time an app is opened — which is the thing that
// gets an account blocked." Amazon did exactly that to the owner on 9 September
// 2026 after a handful of visits. And a phone that polls all night is a phone
// with a flat battery.
//
// ── SO IT LOOKS ON ARRIVAL, AND NOT AGAIN FOR A WHILE ──────────────────────
//
// The look runs the first time the delivery step is reached in a sitting, and
// then not again until LOOK_AGAIN_AFTER_MS has passed — however many times the
// screen is redrawn or reopened in between. Nothing runs while the app is closed
// or in the background; this is a floor on the gap between looks, never a timer
// that fires on its own.
//
// TEN MINUTES, because that is the shop's own delivery time and the honest unit
// here. Looking sooner than the parcel can arrive is a request for nothing;
// looking much later than that is somebody holding a parcel and a shut step.
// The number is a named constant with this note beside it so the next person
// changes the reasoning and not just the digit.
//
// AND THE PERSON CAN ALWAYS LOOK AT ONCE by opening the step again after the
// gap, which is the same thing the old screen offered with its Yes button —
// minus the button.
//
// PURE, apart from one map that remembers the last look per task in this
// sitting. Keyed by TASK and not by campaign, for the reason
// src/order/deliveryLook.js gives: a note against a campaign outlives the claim
// that wrote it.

/** The floor on the gap between two automatic looks for one claim. */
export const LOOK_AGAIN_AFTER_MS = 10 * 60 * 1000;

/** When we last looked, per task, in this sitting. */
const lastLookAt = new Map();

/**
 * MAY THE JOURNEY START A LOOK FOR THIS CLAIM RIGHT NOW?
 *
 * Yes on the first ask in a sitting, and then only once LOOK_AGAIN_AFTER_MS has
 * passed since the last one. An empty id is never looked for: there is no claim
 * to read the orders against.
 */
export function mayLookForDeliveryNow(taskId, now) {
  if (typeof taskId !== 'string' || taskId === '') return false;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const last = lastLookAt.get(taskId);
  if (last == null) return true;
  return at - last >= LOOK_AGAIN_AFTER_MS;
}

/** Remember that a look started, so the next ask is measured from here. */
export function rememberTheDeliveryLook(taskId, now) {
  if (typeof taskId !== 'string' || taskId === '') return;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  lastLookAt.set(taskId, at);
}

/** For checks only, so one does not leak into the next. */
export function forgetEveryDeliveryLookTime() {
  lastLookAt.clear();
}
