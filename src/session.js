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

// Pure decision behind restoreSession, extracted so every path can be
// unit-tested without the native cookie module. FILL-MISSING ONLY: return the
// snapshot cookies the live store LACKS (or has empty). It never overwrites a
// cookie already live and never skips wholesale. Platform-agnostic - no auth
// cookie names, no value comparison - and it satisfies all three guarantees:
//   - return / relaunch with a cleared or partial store -> the missing session
//     cookies get filled -> stays logged in (persistence, EVERY marketplace);
//   - a genuinely DIFFERENT account already live -> its cookies are present, so
//     they are never overwritten -> that account is preserved (switch works);
//   - same account already live -> nothing to fill (no-op).
// The earlier value-comparison "different account" skip is exactly what logged
// Myntra out on return: a rotated / anonymous auth-cookie value read as "a
// different account is live" and blocked the legitimate restore.
//   snapshot / live: { name: { name, value, domain, path, expires, ... } }
export function restorePlan(snapshot, live, now) {
  const snap = snapshot || {};
  const liveMap = live || {};
  const at = now == null ? Date.now() : now;
  const toSet = [];
  for (const name of Object.keys(snap)) {
    const c = snap[name] || {};
    if (!c.name || c.value == null) continue;
    // Never overwrite a cookie already live with a value. This is what preserves
    // a live login - the same account, a freshly-rotated token, OR a different
    // account the user just switched to.
    if (liveMap[name] && liveMap[name].value) continue;
    // Don't resurrect a clearly-expired cookie.
    if (c.expires) {
      const t = Date.parse(c.expires);
      if (!isNaN(t) && t <= at) continue;
    }
    toSet.push(name);
  }
  return { toSet };
}

// Restore previously-saved cookies into the WebView cookie store before load.
//
// Login persistence across navigation AND across app launches is a core product
// guarantee: a user links a marketplace once and must NEVER be asked to log in
// again. Leaving a screen unmounts the WebView (clearing/partly clearing its
// cookie store) and persistSession saves a snapshot; returning remounts and THIS
// fills back whatever the store is missing. See restorePlan for why fill-missing
// gives persistence AND account-switch safety without any per-platform tuning.
export async function restoreSession(platformKey, url) {
  if (!sessionPersistenceAvailable || !url) return false;
  try {
    const saved = await SecureStore.getItemAsync(keyFor(platformKey));
    if (!saved) return false;
    const cookies = JSON.parse(saved);

    let live = {};
    try { live = (await CookieManager.get(url, true)) || {}; } catch (e) { live = {}; }
    const { toSet } = restorePlan(cookies, live);

    let restored = 0;
    for (const name of toSet) {
      const c = cookies[name] || {};
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

// Clear a platform's cookies from ONE of iOS's two cookie stores.
//
// Two things bite here, both proven by reading the simulator's cookie jar:
//  1. Auth cookies live on the DOTTED PARENT domain (`.flipkart.com`,
//     `.myntra.com`) while the WebView host is `www.<site>`. clearByName keys
//     deletion on the URL host and misses them. Fix: overwrite each cookie with
//     an already-EXPIRED one on the cookie's OWN domain/path.
//  2. There are TWO stores - WKHTTPCookieStore (useWebKit:true) and the classic
//     NSHTTPCookieStorage (useWebKit:false, the on-disk .binarycookies). With
//     `sharedCookiesEnabled` the WebView re-syncs NSHTTPCookieStorage -> WebView
//     on every load, so clearing only WebKit gets instantly undone. Must clear
//     BOTH stores. This function does one; clearSession does both.
async function clearCookieStore(url, useWebKit) {
  const PAST = new Date(0).toISOString(); // 1970 -> immediately expired
  let found = 0;
  const domains = new Set();
  try {
    const cookies = await CookieManager.get(url, useWebKit);
    const names = Object.keys(cookies || {});
    found = names.length;
    for (const name of names) {
      const c = cookies[name] || {};
      if (c.domain) domains.add(c.domain);
      // Try clearByName against BOTH the page url and a url built from the
      // cookie's own registrable domain (dot stripped) - e.g. clearByName on
      // https://flipkart.com can match a `.flipkart.com` cookie that the www
      // host never did. The expired-set is best-effort (WebKit ignores an
      // already-expired setCookie, so it can't be relied on alone).
      const bare = c.domain ? `https://${String(c.domain).replace(/^\./, '')}/` : url;
      for (const u of (bare === url ? [url] : [url, bare])) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await CookieManager.set(u, {
            name, value: '', domain: c.domain, path: c.path || '/',
            expires: PAST, secure: c.secure, httpOnly: c.httpOnly,
          }, useWebKit);
        } catch (e) { /* ignore */ }
        try {
          // eslint-disable-next-line no-await-in-loop
          await CookieManager.clearByName(u, name, useWebKit);
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    /* ignore */
  }
  let remaining = found;
  try {
    const after = await CookieManager.get(url, useWebKit);
    remaining = Object.keys(after || {}).length;
  } catch (e) {
    /* ignore */
  }
  return { found, remaining, domains: Array.from(domains) };
}

// Explicit logout: forget the stored session and clear live cookies for this
// platform in BOTH iOS cookie stores. Returns { found, cleared, remaining,
// domains, webkit, shared } so the caller can SHOW whether it worked.
export async function clearSession(platformKey, url) {
  if (!sessionPersistenceAvailable) return { found: 0, cleared: 0, remaining: 0, domains: [] };
  try {
    await SecureStore.deleteItemAsync(keyFor(platformKey));
  } catch (e) {
    /* ignore */
  }
  if (!url) {
    try { await CookieManager.clearAll(true); } catch (e) { /* ignore */ }
    try { await CookieManager.clearAll(false); } catch (e) { /* ignore */ }
    return { found: 0, cleared: 0, remaining: 0, domains: [] };
  }
  const webkit = await clearCookieStore(url, true);
  const shared = await clearCookieStore(url, false); // NSHTTPCookieStorage (.binarycookies)
  const found = webkit.found + shared.found;
  let remaining = webkit.remaining + shared.remaining;
  const domains = Array.from(new Set([...webkit.domains, ...shared.domains]));

  // GUARANTEE: if the targeted per-cookie pass couldn't remove everything (the
  // lib's per-cookie delete is unreliable for dotted-domain cookies), fall back
  // to clearAll on BOTH stores. This DOES log out every marketplace, not just
  // this one - the only reliable primitive - so it's a fallback, not the default.
  let fellBack = false;
  if (remaining > 0) {
    fellBack = true;
    try { await CookieManager.clearAll(true); } catch (e) { /* ignore */ }
    try { await CookieManager.clearAll(false); } catch (e) { /* ignore */ }
    let wkLeft = 0; let nsLeft = 0;
    try { wkLeft = Object.keys((await CookieManager.get(url, true)) || {}).length; } catch (e) { /* ignore */ }
    try { nsLeft = Object.keys((await CookieManager.get(url, false)) || {}).length; } catch (e) { /* ignore */ }
    webkit.remaining = wkLeft;
    shared.remaining = nsLeft;
    remaining = wkLeft + nsLeft;
  }

  return { found, cleared: Math.max(0, found - remaining), remaining, domains, webkit, shared, fellBack };
}
