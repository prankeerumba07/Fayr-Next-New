// On-device session persistence: save the WebView's cookies for a platform
// after login and restore them before the next load, so the user logs in once
// and stays signed in across navigation and app launches until they log out.
// No server is involved - the session never leaves the device.
//
// STORAGE: a JSON file in the app sandbox (Paths.document), NOT SecureStore.
// SecureStore has a 2048-byte per-item limit and a real marketplace snapshot is
// 3-9KB (Myntra: ~45 cookies incl. large Akamai tokens), so every save silently
// failed - verified 2026-07-18 by reading the simulator keychain: ZERO fayr
// items despite persist firing on every load/unmount. The whole persist/restore
// backbone was dead; Flipkart/Amazon merely coasted on WebKit's own cookie
// persistence, and Myntra (whose login needs a short-lived user_session cookie
// that WebKit drops) logged out on every return.
// Security: this is the SAME protection level as WebKit's own cookie store -
// these identical tokens already sit in plaintext in the same sandbox
// (Library/Cookies/*.binarycookies). Revisit (chunked keychain, encryption at
// rest) before production; for the device-only tool, parity is honest.
//
// Requires a custom dev client (npx expo prebuild + a dev build): the native
// cookie module isn't in Expo Go, and the httpOnly auth cookie can't be read
// from injected JS. Modules are loaded DEFENSIVELY: if one is missing, every
// function no-ops instead of crashing - the app just won't persist the session.

let CookieManager = null;
try {
  // eslint-disable-next-line global-require
  CookieManager = require('@react-native-cookies/cookies').default;
} catch (e) {
  CookieManager = null;
}

let FS = null;
try {
  // eslint-disable-next-line global-require
  FS = require('expo-file-system');
} catch (e) {
  FS = null;
}

// Legacy only: old snapshots may still live in SecureStore (pre-2026-07-18).
// Read-fallback + cleanup; never written to any more.
let SecureStore = null;
try {
  // eslint-disable-next-line global-require
  SecureStore = require('expo-secure-store');
} catch (e) {
  SecureStore = null;
}

export const sessionPersistenceAvailable = !!(CookieManager && FS);

function keyFor(platformKey) {
  return `fayr_session_${String(platformKey).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function fileFor(platformKey) {
  return new FS.File(FS.Paths.document, `${keyFor(platformKey)}.json`);
}

function readSnapshot(platformKey) {
  try {
    const f = fileFor(platformKey);
    if (f.exists) return JSON.parse(f.textSync());
  } catch (e) {
    /* corrupt/unreadable -> treat as absent */
  }
  return null;
}

// Persist the current cookies for this platform's origin. Captures the FULL
// live map - including session-scoped cookies like Myntra's user_session, which
// is exactly what WebKit won't persist and therefore what makes this file the
// difference between "stays logged in" and "asks for the number again".
export async function persistSession(platformKey, url) {
  if (!sessionPersistenceAvailable || !url) return false;
  try {
    const cookies = await CookieManager.get(url, true); // useWebKit on iOS
    const names = cookies ? Object.keys(cookies) : [];
    if (!names.length) return false;
    const json = JSON.stringify(cookies);
    const f = fileFor(platformKey);
    f.create({ overwrite: true });
    f.write(json);
    // eslint-disable-next-line no-undef
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // Diagnosis breadcrumb: `log show --predicate 'process == "fayr"'`
      console.log(`[fayr-session] saved ${platformKey}: ${names.length} cookies, ${json.length}B`);
    }
    return true;
  } catch (e) {
    // eslint-disable-next-line no-undef
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log(`[fayr-session] SAVE FAILED ${platformKey}: ${String((e && e.message) || e)}`);
    }
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
    let cookies = readSnapshot(platformKey);
    // Legacy fallback: a pre-file-storage snapshot in SecureStore (if any).
    if (!cookies && SecureStore) {
      try {
        const saved = await SecureStore.getItemAsync(keyFor(platformKey));
        if (saved) cookies = JSON.parse(saved);
      } catch (e) { /* ignore */ }
    }
    if (!cookies) return false;

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
    // eslint-disable-next-line no-undef
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log(`[fayr-session] restore ${platformKey}: filled ${restored}/${toSet.length} missing cookie(s)`);
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
  // Forget the saved snapshot (file + any legacy SecureStore item), so restore
  // can't re-inject the account we're logging out of.
  try {
    const f = fileFor(platformKey);
    if (f.exists) f.delete();
  } catch (e) { /* ignore */ }
  try {
    if (SecureStore) await SecureStore.deleteItemAsync(keyFor(platformKey));
  } catch (e) { /* ignore */ }
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
