// Clipboard, isolated behind one function.
//
// WHY the deprecated core API and not expo-clipboard: expo-clipboard is a NATIVE
// module, so adding it forces a fresh native build — and this project's iOS build
// has already needed hand-patching once (the fmt/Xcode-26 consteval header fix).
// Taking that risk days before a deadline, for a convenience button, is a bad
// trade. React Native 0.81 still ships core Clipboard; it only warns.
//
// MIGRATION TRIGGER — do this the next time a native rebuild happens anyway, or
// the moment RN drops the export (it is announced for "a future release"):
//   npx expo install expo-clipboard
//   then replace the import below with `import * as Clipboard from 'expo-clipboard'`
//   and the call with `await Clipboard.setStringAsync(text)`.
// Nothing else in the app touches the clipboard, so that is this file only.
import { Clipboard } from 'react-native';

/**
 * Copy `text` to the clipboard. Returns true on success.
 *
 * Never throws: a failed copy must not take down the screen it sits on. The
 * caller shows confirmation only on a true return, so a silent failure reads as
 * "nothing happened" rather than a false "Copied!".
 */
export function copyToClipboard(text) {
  const s = text == null ? '' : String(text);
  if (!s.trim()) return false;
  try {
    Clipboard.setString(s);
    return true;
  } catch (e) {
    return false;
  }
}
