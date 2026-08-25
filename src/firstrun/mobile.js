// Mobile-number rules for the sign-in screens. Pure, so it runs under node —
// the same reason src/ui/timeline.js and friends are separate from their screens.
//
// This is the gate on the ONLY way into the app, so it is tested rather than
// trusted: an Indian mobile is ten digits starting 6-9, and the design's
// PhoneEntry encodes exactly that.

/** True for a bare 10-digit Indian mobile (no spaces, no +91). */
export function isValidMobile(num) {
  return /^[6-9]\d{9}$/.test(String(num == null ? '' : num));
}

/** "98765 43210" — the design's 5+5 display grouping, applied as you type. */
export function groupMobile(num) {
  const d = String(num == null ? '' : num);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}
