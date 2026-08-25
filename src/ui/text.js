// Text-input transforms that run on every keystroke. Pure, so the caret-safety
// property below can be tested without React Native.

/**
 * Uppercase for DISPLAY, guaranteed not to change the string's length.
 *
 * Why this exists: `autoCapitalize="characters"` is only a hint to the keyboard.
 * Some IMEs and every hardware keyboard ignore it, so a PAN could sit on screen
 * in lowercase while being silently uppercased at submit. PAN is permanently
 * anchored to the account and cannot be edited from the app, so what the user
 * proofreads must be exactly what gets saved.
 *
 * Why length-preservation matters: a controlled TextInput whose `value` comes
 * back a different LENGTH than the native field holds can have its selection
 * reset to the end — so editing the middle of a PAN would throw the caret to the
 * end on every keystroke. Uppercasing is 1:1 for ASCII, but not universally:
 * 'ß'.toUpperCase() is 'SS' (1 → 2) and 'ﬁ' becomes 'FI'. Those characters are
 * left as typed rather than expanded; they are not legal in a PAN or an IFSC
 * anyway, and the server rejects them with a clear message.
 */
export function toDisplayUpper(input) {
  const s = String(input == null ? '' : input);
  let out = '';
  // Iterate by code point so a surrogate pair is never split in half.
  for (const ch of s) {
    const up = ch.toUpperCase();
    out += up.length === ch.length ? up : ch;
  }
  return out;
}
