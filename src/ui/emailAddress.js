// AN EMAIL ADDRESS, CHECKED AND TIDIED, AND THE COMMON TYPO CAUGHT.
//
// PURE. No React, no fetch — so every judgement about an address can be checked
// under node. Same reason as ui/journey.js and ui/shopApp.js.
//
// WHAT "VALID" MEANS HERE, said plainly because it is easy to overclaim: it means
// the address has the SHAPE of an address. It does not mean the inbox exists, and
// nothing here pretends otherwise. Proving an inbox belongs to somebody is what the
// code sent to it is for, and that part is not built yet.
//
// THE TYPO CATCHER IS THE DESIGN'S OWN IDEA (fayr-design.browser.jsx:2646). Three
// misspellings of gmail account for most of them, and offering the correction is
// far kinder than sending a code into nowhere and letting somebody wait for it.

/** The shape of an address: something, an at sign, something, a dot, something. */
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The misspellings the design catches, and what each one meant. */
const TYPOS = [
  [/@gmial\./i, '@gmail.'],
  [/@gamil\./i, '@gmail.'],
  [/@gmali\./i, '@gmail.'],
  [/@gmail\.co$/i, '@gmail.com'],
  [/@yahooo\./i, '@yahoo.'],
  [/@hotmial\./i, '@hotmail.'],
  [/@outlok\./i, '@outlook.'],
];

/** Lower case and trimmed. The form somebody's address is stored in. */
export function tidyAddress(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

/** Does this have the shape of an address? Not: does the inbox exist. */
export function looksLikeAnAddress(raw) {
  return SHAPE.test(tidyAddress(raw));
}

/**
 * The correction to offer, or null when there is nothing to correct.
 *
 * Only ever OFFERED. Never applied on somebody's behalf: it is their address, and a
 * silent correction to the wrong thing is worse than a typo they can see.
 */
export function typoFix(raw) {
  const tidy = tidyAddress(raw);
  if (tidy === '') return null;
  for (const [wrong, right] of TYPOS) {
    if (wrong.test(tidy)) {
      const fixed = tidy.replace(wrong, right);
      if (fixed !== tidy) return fixed;
    }
  }
  return null;
}

/** The masked form for showing an address back: "pr•••••@gmail.com". */
export function maskAddress(raw) {
  const tidy = tidyAddress(raw);
  const at = tidy.indexOf('@');
  if (at < 1) return null;
  const name = tidy.slice(0, at);
  const rest = tidy.slice(at);
  if (name.length <= 2) return `${name}${'•'.repeat(3)}${rest}`;
  return `${name.slice(0, 2)}${'•'.repeat(Math.min(5, name.length - 2))}${rest}`;
}

/** One digit per box, the six-box code the design draws. Non-digits are dropped. */
export function codeDigits(raw, howMany) {
  const n = Number.isInteger(howMany) && howMany > 0 ? howMany : 6;
  const digits = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  return Array.from({ length: n }, (_, i) => digits[i] || '');
}

/** Is the code complete? */
export function codeIsComplete(raw, howMany) {
  return codeDigits(raw, howMany).every((d) => d !== '');
}
