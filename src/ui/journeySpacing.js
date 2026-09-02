// WHO OWNS THE SPACE ABOVE A SCREEN'S BODY INSIDE THE JOURNEY.
//
// THE OWNER REPORTED THIS TWICE, AND THE FIRST DIAGNOSIS WAS WRONG. His second
// screenshot says "Step 1 of 11", so it is from AFTER the first fix, and the empty
// band is still there and is far bigger than what that fix removed. He was right
// to send it back.
//
// ── WHAT THE FIRST ATTEMPT FOUND, AND WHY IT WAS NOT ENOUGH ─────────────────
//
// Three small paddings, none of them wrong on its own:
//
//   the journey strip     paddingBottom  8   (SPACE.sm, ours, below "Next:")
//   the screen's TopBar   paddingTop     6   (the design's own value)
//   the screen's body     paddingTop     4   (the design's own value)
//                                        --
//                                        18 points
//
// Eighteen points is real and it was removed. It was also nowhere near the whole
// band.
//
// ── WHAT WAS ACTUALLY CAUSING IT, MEASURED ──────────────────────────────────
//
// Walking every element between the bottom of the "Next:" line and the first word
// of the screen underneath, on the owner's own phone (a notch of 59 points):
//
//   the journey strip's paddingBottom            8    SPACE.sm, JourneyScreen.js
//   the Screen wrapper's TOP SAFE AREA          59    THE CAUSE
//   the screen's TopBar paddingTop                0    already fixed
//   the screen's body paddingTop                  4    the design's own value
//                                               ---
//                                                71 points of empty colour
//
// Which matches his screenshot: about 76 points measured off the image, the few
// points over being the back button's own height inside the title bar.
//
// ── THE CAUSE, AND WHY THE FIRST FIX COULD NEVER HAVE REACHED IT ────────────
//
// Every one of these screens wraps itself in `Screen` (src/ui/primitives.js),
// which is a SafeAreaView with edges ['top','bottom']. Inside the journey the
// strip above it has ALREADY stepped over the notch, so the Screen steps over it
// a second time and leaves a whole notch of empty colour under the strip.
//
// The first fix tried to say "there is no notch left" by handing a zeroed inset
// down through SafeAreaInsetsContext. THAT CANNOT WORK ON A SafeAreaView, and the
// reason is in the library: react-native-safe-area-context 5.6.2 implements
// SafeAreaView as a thin wrapper that renders NativeSafeAreaView and passes only
// its edges (node_modules/react-native-safe-area-context/src/SafeAreaView.tsx).
// It reads no React context at all — the insets are applied on the native side,
// per view. So the context was being set, and honoured by everything that calls
// useSafeAreaInsets(), and completely ignored by the one view that was causing
// the band. The owner guessed exactly this, and he was right.
//
// ── THE FIX, IN ONE PLACE ───────────────────────────────────────────────────
//
// `Screen` itself asks whether it is inside the journey, and drops its top edge
// when it is. It can ask, because it is an ordinary component of ours that reads
// the context; the native view underneath never has to know. One place, no screen
// changes, and a screen opened on its own still steps over the notch exactly as
// it did before, because then nobody is telling it otherwise.
//
// THE DESIGN'S OWN NUMBERS, measured off the design file rather than chosen:
//   TopBar    padding: "6px 18px 8px"   fayr-design.browser.jsx:397
//   body      padding: "4px 22px 22px"  fayr-design.browser.jsx:2303 (LinkAccount)
// The design has no journey strip at all — that is ours — so the design states no
// value for the space between the strip and a screen. The strip's own
// paddingBottom is the only gap there should be.
//
// THIS FILE IS PURE. It imports nothing, so a plain node test can read every
// decision and add the band up for itself.

/** The design's own top padding on its title bar, in points. */
export const TOP_BAR_TOP = 6;

/** The design's own top padding on a screen's scrolling body, in points. */
export const BODY_TOP = 4;

/**
 * How much top padding a screen should contribute.
 *
 * Zero inside the journey, because the strip above it already owns that space.
 * The screen's own value everywhere else, because on its own it owns it again.
 *
 * `base` is passed in rather than read from here so one function serves the title
 * bar and the body without knowing which is which.
 */
export function topPaddingInside(base, insideJourney) {
  if (insideJourney === true) return 0;
  return typeof base === 'number' && Number.isFinite(base) && base > 0 ? base : 0;
}

/**
 * THE NOTCH ON A MODERN PHONE, in points.
 *
 * The owner's own phone. Used only so the check next door can add the band up the
 * way a phone would; nothing drawn reads it, because a real phone tells us its
 * own number.
 */
export const NOTCH = 59;

/** The strip's own gap below the "Next:" line. SPACE.sm in JourneyScreen.js. */
export const STRIP_BOTTOM = 8;

/**
 * The most empty space allowed between the strip and the first word under it.
 *
 * The strip's own gap, plus the design's own small body padding, and not one
 * point more. Anything above this is the band coming back.
 */
export const MOST_ALLOWED_BAND = STRIP_BOTTOM + BODY_TOP;

/**
 * WHICH EDGES A SCREEN STEPS OVER.
 *
 * Inside the journey the top edge is dropped, because the strip above has already
 * stepped over the notch. Everywhere else the screen keeps every edge it asked
 * for. This is the one place that decision is made.
 */
export function edgesInsideJourney(edges, insideJourney) {
  const wanted = Array.isArray(edges) ? edges : ['top', 'bottom'];
  if (insideJourney !== true) return wanted;
  return wanted.filter((edge) => edge !== 'top');
}

/**
 * HOW BIG THE EMPTY BAND IS, added up.
 *
 * Not an assertion that some padding is zero — a sum of every part, so a part
 * that comes back is caught wherever it comes back from.
 */
export function bandAbove(parts) {
  const p = parts && typeof parts === 'object' ? parts : {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return num(p.stripBottom) + num(p.screenTop) + num(p.topBarTop) + num(p.bodyTop);
}
