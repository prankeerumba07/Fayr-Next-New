// THE DOOR INTO THE SHOP INSIDE FAYR — the wiring, in one place.
//
// ── WHY THERE IS ONE DOOR AND NOT TWO ───────────────────────────────────────
//
// Two things open the shop for a listed shop after Phase 7: the claim on the
// product page, and the journey when somebody comes back to a claim that has
// not been bought yet. Both have to do the same two things in the same order,
// and a second copy of that order is how the two would come to disagree. So both
// call this.
//
// ── THE CONSENT IS STILL RECORDED, AND IT IS RECORDED FIRST ────────────────
//
// The "before you go" screen used to record the shop visit on our side with
// goingToTheShop() before it would open a shop, and refused to open one when
// that call failed, because "a purchase our side has no consent for cannot be
// paid". Phase 7 removes that screen for the three quick-commerce shops. The
// CALL stays and moves here: the same request, the same refusal, and the same
// rule that the shop does not open without it.
//
// IT IS IDEMPOTENT ON THE SERVER — a second call for a claim already recorded
// simply answers the task as it stands — which is what lets the journey call it
// again on every return without spending anything twice.
//
// ── AND IT DOES NOT DECIDE WHICH SHOPS COME HERE ───────────────────────────
//
// The caller asks shopsInsideFayr() first. This file asks it AGAIN before
// opening anything, for the same reason ShopScreen does: a guard at one call
// site is a guard until somebody adds a second call site.

import { goingToTheShop } from '../backend/tasksApi';
import { applyAuthoritative, getTaskId } from '../taskStore';
import { theSentenceTheyGaveUs } from '../journey/refusal.js';
import { shopsInsideFayr } from './insideFayr';

/**
 * RECORD THE VISIT, THEN OPEN THE SHOP.
 *
 * `campaignId`  the offer.
 * `marketplace` the shop's key, for the second guard.
 * `navigation`  the navigator to open the shop on.
 * `how`         'navigate' or 'replace'. The claim replaces — nobody should be
 *               able to go back to a product page and claim twice — and the
 *               journey replaces too, so the door does not stack up behind the
 *               shop.
 *
 * Answers `{ ok: true }` when the shop opened, or `{ ok: false, refusal }` with
 * our own side's sentence when the visit could not be recorded and the shop was
 * therefore NOT opened. Never throws.
 */
export async function enterTheShop({ campaignId, marketplace, navigation, how = 'replace' }) {
  if (!shopsInsideFayr(marketplace)) {
    return { ok: false, refusal: 'This shop is not one Fayr opens inside itself.' };
  }
  const taskId = campaignId ? getTaskId(campaignId) : null;
  if (!taskId) return { ok: false, refusal: 'There is no claim to open the shop for.' };

  const answer = await goingToTheShop(taskId);
  if (!answer || !answer.ok || !answer.task) {
    return { ok: false, refusal: theSentenceTheyGaveUs(answer) };
  }
  // THE STORE IS TOLD FIRST, so every screen that reads the record — the bar
  // above the navigation, My Products, the shop's own countdown — sees the visit
  // at the same moment. Same fix, same reason as the old buy screen.
  applyAuthoritative(answer.task);

  const go = how === 'navigate' && typeof navigation.navigate === 'function'
    ? navigation.navigate
    : navigation.replace;
  go.call(navigation, 'Shop', { campaignId, marketplace });
  return { ok: true };
}
