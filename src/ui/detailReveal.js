// HAS THE READER REACHED THE BOTTOM OF THE PRODUCT PAGE?
//
// The owner reported on 2 September 2026 that the terms tick box was painting over
// the campaign text. It sat in a bar pinned to the bottom of the screen, so it
// floated on top of whatever was scrolling behind it.
//
// The tick box and the claim button now live at the END of the page, inside the
// scroll, and they only come alive once somebody has actually scrolled down to
// them. That is the point of the tick box: it says "I have read everything above",
// and a box you can tick without scrolling is a box that says nothing.
//
// DECIDED BY POSITION, NEVER BY A TIMER. A timer would let somebody who read
// nothing tick it after three seconds, and would make somebody who reads slowly
// wait for no reason.
//
// THIS FILE IS PURE. It imports nothing, so a plain node test can read the
// decision without a phone.

/**
 * How close to the very bottom still counts as the bottom, in points.
 *
 * Not zero, and that matters. A scroll view rarely reports a position that lands
 * exactly on the end: rounding, a rubber-band bounce and the phone's own pixel
 * ratio all leave a point or two behind, so a test for "exactly the end" can be
 * missed by a pixel and leave the claim button dead with nothing left to scroll.
 */
export const BOTTOM_SLACK = 24;

/**
 * True once the last screenful of the page is in view.
 *
 * The three numbers are the three a scroll view reports:
 *   offsetY         how far down the page has been scrolled
 *   viewportHeight  how tall the visible window is
 *   contentHeight   how tall the whole page is
 *
 * NOTHING TO SCROLL COUNTS AS THE BOTTOM. On a short page, or on a very tall
 * phone, the whole page can already be visible without scrolling at all. Answering
 * false there would leave the claim button permanently dead with no way to reach
 * it, which is the worst failure this function could have.
 *
 * A NUMBER WE CANNOT USE ALSO COUNTS AS THE BOTTOM, for the same reason. If the
 * measurements arrive missing or broken, the safe direction is a button somebody
 * can press, not a page nobody can claim from.
 */
export function reachedBottom(input) {
  const o = input || {};
  const offsetY = o.offsetY;
  const viewportHeight = o.viewportHeight;
  const contentHeight = o.contentHeight;

  const usable = (n) => typeof n === 'number' && Number.isFinite(n);
  if (!usable(offsetY) || !usable(viewportHeight) || !usable(contentHeight)) {
    return true;
  }

  // The whole page already fits, so there is nothing to scroll to.
  if (contentHeight <= viewportHeight) return true;

  return offsetY + viewportHeight >= contentHeight - BOTTOM_SLACK;
}
