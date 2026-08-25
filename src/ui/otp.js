// Filling the six-box code input.
//
// The boxes were built for ONE KEYSTROKE AT A TIME: the handler did
// `v.replace(/\D/g, '').slice(-1)` with maxLength={1}, so six digits arriving at
// once — the iOS keyboard suggestion, Android's sms-otp autofill, or a plain paste
// — kept only the LAST digit and threw the other five away.
//
// Autofill is a BONUS, never a dependency. These free SMS routes send from a random
// numeric sender, so it may not trigger at all, and typing by hand has to stay
// perfect. That is why this is one pure function used by every input path rather
// than a special case bolted onto autofill.
//
// Pure, so it can be tested under node (same reason as stages.js / apiBase.js).

/** Number of boxes. Matches the backend's OTP_LENGTH. */
export const OTP_LENGTH = 6;

/** Coerce whatever React hands us into a safe array of six single digits. */
function normalise(current) {
  const out = Array(OTP_LENGTH).fill('');
  if (!Array.isArray(current)) return out;
  for (let i = 0; i < OTP_LENGTH; i++) {
    const v = current[i];
    if (typeof v === 'string' && /^\d$/.test(v)) out[i] = v;
  }
  return out;
}

/** The first empty box, or the last box when the code is full. */
export function nextFocus(digits) {
  const safe = normalise(digits);
  const gap = safe.findIndex((d) => d === '');
  return gap === -1 ? OTP_LENGTH - 1 : gap;
}

/**
 * Apply an input event to the boxes, whatever shape it arrived in.
 *
 * `incoming` may be a single keystroke, an entire six-digit code, a messy paste
 * ("483 920", "code: 483920"), or an empty string meaning "this box was cleared".
 * Non-digits are stripped — deliberately, because iOS hands over strings like
 * "483 920" and a strict check would reject a perfectly good autofill.
 *
 * Returns the new boxes, where focus should go, and whether the code is now
 * complete, so the caller never has to re-derive any of it.
 */
export function fillOtp(current, index, incoming) {
  const digits = normalise(current);
  const at =
    Number.isInteger(index) && index >= 0 && index < OTP_LENGTH ? index : 0;

  const text = typeof incoming === 'string' ? incoming : '';
  // ASCII digits only: \d in a JS regex does not match Eastern Arabic numerals, and
  // a box must never hold a character the backend would reject.
  const incomingDigits = text.replace(/[^0-9]/g, '');

  if (incomingDigits.length === 0) {
    // The box was cleared (or the paste held nothing usable). Clear THIS box only,
    // and leave focus where it is so the user can retype in place.
    digits[at] = '';
    return { digits, focus: at, complete: false };
  }

  if (incomingDigits.length === 1) {
    // The ordinary case: one digit into one box, then move on.
    digits[at] = incomingDigits;
    const complete = digits.every((d) => d !== '');
    return {
      digits,
      focus: complete ? OTP_LENGTH - 1 : Math.min(at + 1, OTP_LENGTH - 1),
      complete,
    };
  }

  // A blob: autofill, a paste, or fast typing coalesced into one event. Spread it
  // forward from the focused box and drop anything that does not fit — never wrap
  // around, which would scramble the code the user can see.
  for (let i = 0; i < incomingDigits.length && at + i < OTP_LENGTH; i++) {
    digits[at + i] = incomingDigits[i];
  }
  const complete = digits.every((d) => d !== '');
  return { digits, focus: complete ? OTP_LENGTH - 1 : nextFocus(digits), complete };
}
