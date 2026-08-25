// What the app says about how full a campaign is — and when it says nothing.
//
// The server now sends `claimedCount` and `seatsLeft` on every campaign, both
// counted from real tasks through the same definition the claim gate uses. This
// file is only the WORDS. It does no arithmetic on them: subtracting here would
// be a second definition of a remaining seat, and the screen would end up
// offering a seat the server refuses.
//
// Pure module, no RN imports, so it is testable under node (same reason as
// stages.js and confirmJoin.js).

import { groupIndian } from './theme.js'; // explicit extension: also run under node

/**
 * "3 slots left", "All seats taken", or NULL when there is nothing true to say.
 *
 * The design's own words — `👥 {n} slots left` on a card and "All seats taken"
 * when it is full. Not "X of Y seats left": the design never shows the total
 * beside the remainder, and a number nobody asked for is a number to get wrong.
 *
 * Null in two cases, and they are different:
 *   - the campaign has NO limit, so there is no remainder to state;
 *   - the server did not send one, so we do not know.
 * Both mean silence. A screen that says "0 slots left" because a field was
 * missing has told the user the offer is closed when it is wide open.
 */
export function seatsLine(campaign) {
  const left = campaign == null ? null : campaign.seatsLeft;
  if (!Number.isInteger(left)) return null;
  if (left <= 0) return 'All seats taken';
  return `${groupIndian(left)} slots left`;
}

/** True only when the server actually said the campaign is full. */
export function isFullCampaign(campaign) {
  const left = campaign == null ? null : campaign.seatsLeft;
  return Number.isInteger(left) && left <= 0;
}

/**
 * "1,240 joined", or NULL.
 *
 * Zero is deliberately NOT shown. The design shows "1,240 joined"; it never shows
 * "0 joined", which reads as an empty room rather than a new offer — and a new
 * offer is exactly when it would appear. Absent for the same reason every other
 * missing figure is absent.
 *
 * Grouped with groupIndian, not toLocaleString: Hermes ships only part of Intl,
 * so the locale call is unreliable on device. theme.js already solved this.
 */
export function joinedLine(campaign) {
  const n = campaign == null ? null : campaign.claimedCount;
  if (!Number.isInteger(n) || n <= 0) return null;
  return `${groupIndian(n)} joined`;
}
