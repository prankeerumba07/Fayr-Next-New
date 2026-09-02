// WHERE THE HOME REMINDER CARD SITS, AND HOW MUCH ROOM IT NEEDS.
//
// THE OWNER'S COMPLAINT, on 2 September 2026, in his own words: "one screenshot is
// the actual design screenshot, where you will see that notification box, that
// pop-up notification box at the bottom nav page. If you check what you have
// created, the notification box is coming in the middle of the screen. Why?"
//
// HE IS RIGHT, AND HERE IS THE MEASUREMENT.
//
//   THE DESIGN, fayr-design.browser.jsx:1699, with its own comment one line above
//   reading "FIXED just above the nav (does not scroll)":
//
//       position   absolute
//       left       0
//       right      0
//       bottom     70
//       padding    0 12px
//       zIndex     60
//       taps       none on the wrapper, auto on the card inside it
//
//   AND THE DESIGN'S OWN BOTTOM BAR, fayr-design.browser.jsx:1334, is about 70
//   points tall: 8 above, 12 below, and a button of roughly 49 in between (5 of
//   its own padding at each end, a 19 point icon, a 3 point gap and a 10.5 point
//   label). So "bottom 70" in the design means FLUSH ON TOP OF THE BAR, with no
//   gap at all. That is the whole instruction.
//
//   THE APP, src/ui/WaitingBox.js before this change:
//
//       position   absolute
//       left       0
//       right      0
//       bottom     the tab bar's height plus 10
//       padding    12 at the sides
//       zIndex     60
//
// THE DIFFERENCE, AND WHY IT PUT THE CARD IN THE MIDDLE. In the design the card
// sits inside a box that runs to the very bottom of the phone, with the bar drawn
// on top of it, so "bottom 70" has to step over the bar itself. In the app the
// card's box ALREADY STOPS at the top of the tab bar, because the tab bar is a
// real part of the layout rather than something floating over it. So "the tab
// bar's height plus 10" stepped over a bar that had already been stepped over,
// and lifted the card a whole bar's height too high. On the owner's phone that is
// about 83 points, which is exactly the empty space his screenshot shows between
// the card and the tab bar.
//
// SO THE DESIGN'S NUMBER IS KEPT AND MEASURED FROM THE RIGHT PLACE. The card
// clears the bar by what the design's number leaves over once the bar is
// accounted for, and never less than nothing. On a phone whose bar is 83 tall
// that is zero, which is the design's own flush-on-top-of-the-bar. On a phone
// with a shorter bar it is the few points the design leaves.
//
// PURE. No React, no phone. The number the design states is read out of the
// design file by the check next door, so if the design ever changes the check
// fails instead of quietly passing.

/** The design's own distance from the bottom of the phone. :1699 */
export const DESIGN_BOTTOM = 70;

/** The design's own side margins. :1699, padding "0 12px". */
export const DESIGN_SIDE = 12;

/** The design's own layer, so the card is above the campaign deck. :1699 */
export const DESIGN_LAYER = 60;

/**
 * The design's own card height, added up from its own numbers at :3760 onwards:
 * 10 above and 10 below, a 12 point top row with a 6 point gap under it, and a
 * row as tall as its 44 point picture.
 */
export const DESIGN_CARD_HEIGHT = 10 + 12 + 6 + 44 + 10;

/** A breathing gap between the last campaign and the card. */
export const GAP_BELOW_LIST = 12;

/**
 * How far above the tab bar the card sits.
 *
 * `barHeight` is the real height of the app's own tab bar, which the phone
 * decides: it includes the home bar at the bottom of a modern phone. The design's
 * number already covers a bar of its own, so what is left over is the gap.
 */
export function bottomAboveBar(barHeight) {
  const bar = typeof barHeight === 'number' && Number.isFinite(barHeight) && barHeight > 0
    ? barHeight
    : 0;
  const left = DESIGN_BOTTOM - bar;
  return left > 0 ? left : 0;
}

/**
 * How much empty room the bottom of the home list needs.
 *
 * NOTHING IS EVER PERMANENTLY HIDDEN. The card floats over the list, which is
 * what the design does and what the owner's design screenshot shows. Left alone
 * that would bury the last campaign for good, so the list carries this much empty
 * room at its end and scrolling to the bottom always brings the last campaign out
 * from under the card.
 */
export function roomToReserve(showing) {
  return showing === true ? DESIGN_CARD_HEIGHT + GAP_BELOW_LIST : 0;
}
