// The Fayr-account session — access + refresh tokens + the signed-in user —
// persisted on-device in the OS keychain via expo-secure-store.
//
// This is DISTINCT from src/session.js (the marketplace WebView cookies): this
// file holds the user's Fayr identity with the backend; that one holds their
// Amazon/Flipkart/… logins. Tokens are small (JWTs, well under SecureStore's
// 2048-byte per-item limit), so unlike the marketplace cookie snapshot they fit
// SecureStore cleanly.
//
// The app subscribes to `subscribe()` so the auth gate flips automatically the
// moment a session appears (login) or is cleared (logout / dead refresh token).

import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'fayr_access_token';
const REFRESH_KEY = 'fayr_refresh_token';
const USER_KEY = 'fayr_user';

let current = null; // { accessToken, refreshToken, user } | null
let hydrated = false;
let listeners = [];

function emit() {
  for (const fn of listeners) {
    // A bad listener must never break the auth backbone.
    try {
      fn(current);
    } catch (e) {
      /* ignore */
    }
  }
}

// subscribe((session|null) => …) — fires on hydrate, login, logout. Returns an
// unsubscribe fn.
export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

// Load the persisted session ONCE at startup. Defensive: any read/parse failure
// is treated as "no session" (the user just logs in again) rather than a crash.
export async function hydrate() {
  if (hydrated) return current;
  try {
    const [accessToken, refreshToken, userJson] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (accessToken && refreshToken) {
      let user = null;
      try {
        user = userJson ? JSON.parse(userJson) : null;
      } catch (e) {
        user = null;
      }
      current = { accessToken, refreshToken, user };
    } else {
      current = null;
    }
  } catch (e) {
    current = null;
  }
  hydrated = true;
  emit();
  return current;
}

export function getSession() {
  return current;
}
export function getAccessToken() {
  return current ? current.accessToken : null;
}
export function getRefreshToken() {
  return current ? current.refreshToken : null;
}
export function isAuthed() {
  return !!(current && current.accessToken);
}
export function currentUser() {
  return current ? current.user : null;
}

// Establish a session after a successful OTP verify (or clear it with null).
export async function setSession(next) {
  current =
    next && next.accessToken && next.refreshToken
      ? {
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          user: next.user || null,
        }
      : null;
  try {
    if (current) {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, current.accessToken),
        SecureStore.setItemAsync(REFRESH_KEY, current.refreshToken),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(current.user || null)),
      ]);
    } else {
      await clearStorage();
    }
  } catch (e) {
    /* persistence best-effort; the in-memory session is still valid this run */
  }
  emit();
  return current;
}

// Update ONLY the tokens (after a silent refresh), keeping the same user.
// Deliberately does NOT emit(): a token rotation is invisible to the gate (the
// user stays signed in), so re-rendering the whole app on every refresh would
// be a needless flicker.
export async function updateTokens(accessToken, refreshToken) {
  if (!current) return null;
  current = { ...current, accessToken, refreshToken };
  try {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
    ]);
  } catch (e) {
    /* best-effort */
  }
  return current;
}

// Log out: forget the session in memory and in the keychain, and notify the
// gate (which routes back to sign-in).
export async function clearSession() {
  current = null;
  await clearStorage();
  emit();
}

async function clearStorage() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(USER_KEY).catch(() => {}),
  ]);
}
