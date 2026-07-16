// On-device session persistence: save the WebView's cookies for a platform to
// the device Keychain/Keystore after login and restore them before the next
// load, so the user logs in once and stays signed in across app launches until
// the cookie truly expires. No server is involved - the session never leaves
// the device.
//
// Requires a custom dev client (npx expo prebuild + a dev build): the native
// cookie module isn't in Expo Go, and the httpOnly auth cookie can't be read
// from injected JS. Both native modules are loaded DEFENSIVELY: if either is
// missing (e.g. still running in plain Expo Go), every function no-ops instead
// of crashing, so the app keeps working - it just won't persist the session.

let CookieManager = null;
try {
  // eslint-disable-next-line global-require
  CookieManager = require('@react-native-cookies/cookies').default;
} catch (e) {
  CookieManager = null;
}

let SecureStore = null;
try {
  // eslint-disable-next-line global-require
  SecureStore = require('expo-secure-store');
} catch (e) {
  SecureStore = null;
}

export const sessionPersistenceAvailable = !!(CookieManager && SecureStore);

// SecureStore keys allow [A-Za-z0-9._-]; keep the platform key clean.
function keyFor(platformKey) {
  return `fayr_session_${String(platformKey).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

// Persist the current cookies for this platform's origin.
export async function persistSession(platformKey, url) {
  if (!sessionPersistenceAvailable || !url) return false;
  try {
    const cookies = await CookieManager.get(url, true); // useWebKit on iOS
    const names = cookies ? Object.keys(cookies) : [];
    if (!names.length) return false;
    await SecureStore.setItemAsync(keyFor(platformKey), JSON.stringify(cookies));
    return true;
  } catch (e) {
    return false;
  }
}

// Restore previously-saved cookies into the WebView cookie store before load.
export async function restoreSession(platformKey, url) {
  if (!sessionPersistenceAvailable || !url) return false;
  try {
    const saved = await SecureStore.getItemAsync(keyFor(platformKey));
    if (!saved) return false;
    const cookies = JSON.parse(saved);
    let restored = 0;
    for (const name of Object.keys(cookies)) {
      const c = cookies[name] || {};
      if (!c.name || c.value == null) continue;
      // Drop clearly-expired cookies so we don't resurrect a dead session.
      if (c.expires) {
        const t = Date.parse(c.expires);
        if (!isNaN(t) && t <= Date.now()) continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await CookieManager.set(
          url,
          {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            version: c.version,
            expires: c.expires,
            secure: c.secure,
            httpOnly: c.httpOnly,
          },
          true // useWebKit
        );
        restored += 1;
      } catch (e) {
        /* skip this cookie */
      }
    }
    return restored > 0;
  } catch (e) {
    return false;
  }
}

// Explicit logout: forget the stored session and clear live cookies for this
// platform's origin. Returns the number of cookies cleared (best-effort).
//
// clearByName needs a specific cookie NAME - the previous `clearByName(url,
// undefined, ...)` cleared nothing. Enumerate the platform's cookies first, then
// clear each by name so we wipe THIS marketplace without logging out the others.
export async function clearSession(platformKey, url) {
  if (!sessionPersistenceAvailable) return 0;
  try {
    await SecureStore.deleteItemAsync(keyFor(platformKey));
  } catch (e) {
    /* ignore */
  }
  if (!url) {
    try { await CookieManager.clearAll(true); } catch (e) { /* ignore */ }
    return 0;
  }
  let cleared = 0;
  try {
    const cookies = await CookieManager.get(url, true); // useWebKit
    for (const name of Object.keys(cookies || {})) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await CookieManager.clearByName(url, name, true);
        cleared += 1;
      } catch (e) {
        /* skip this cookie */
      }
    }
  } catch (e) {
    /* ignore */
  }
  return cleared;
}
