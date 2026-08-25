// Where the backend is, worked out at runtime instead of written down.
//
// THE PROBLEM THIS REPLACES. The base URL used to be EXPO_PUBLIC_FAYR_API_BASE
// with a localhost default, i.e. an address someone types into a file. On a
// laptop whose address changes with the network — a dongle one hour, a phone
// hotspot the next — that address is stale as soon as the network moves, and the
// app just says "network request failed" with no hint that the address is why.
//
// THE FIX. Metro already knows the right host: the phone downloaded the JS bundle
// from it seconds ago. So the backend host is derived from it on every launch —
// nothing to type, nothing to keep in sync, and a network change fixes itself on
// the next reload.
//
// WHICH SOURCE, AND WHY IT CHANGED. The first version read
// NativeModules.SourceCode.scriptURL. That works in a dev build but is ALWAYS NULL
// IN EXPO GO, because Expo Go runs bridgeless (New Architecture) and SourceCode is
// a legacy bridge module (react-native/src/private/specs_DEPRECATED). app.json's
// newArchEnabled:false governs dev builds only, not Expo Go — which is exactly why
// this was invisible on the simulator and failed on a real phone with
// "Could not work out this machine's address from Metro".
//
// expo-constants is the supported route and ships inside Expo Go, so no native
// rebuild. Order: hostUri, then experienceUrl, then scriptURL (still correct in a
// dev build), then give up loudly.
//
// Pure, so it can be tested under node (same reason as src/ui/stages.js).

/** The port the Fayr backend listens on (backend/.env PORT). */
export const DEFAULT_API_PORT = 3000;

/** Used only when there is genuinely nothing to derive from. */
const LOCAL_FALLBACK = 'http://localhost';

/**
 * Hosts we can safely assume also serve the backend: a bare IP address, the
 * loopback name, or a .local Bonjour name. A PUBLIC hostname is excluded on
 * purpose — see the tunnel case below.
 */
function isReachableHost(hostname) {
  if (!hostname) return false;
  const h = hostname.replace(/^\[|\]$/g, ''); // IPv6 arrives bracketed
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4
  if (h.includes(':')) return true; // IPv6
  return /\.local$/i.test(h);
}

/**
 * Work out the API base URL.
 *
 * Order of precedence:
 *   1. an explicitly configured address — the escape hatch for a tunnel;
 *   2. the host Metro served the bundle from, with the API port swapped in;
 *   3. localhost, with a warning saying what to set.
 *
 * Returns `source` and `warning` as well as `base` so the app can say which of
 * the three happened. Silence here is what made the last failure hard to read.
 */
export function apiBaseFrom({
  envBase,
  hostUri,
  experienceUrl,
  scriptURL,
  apiPort = DEFAULT_API_PORT,
} = {}) {
  const trimmed = typeof envBase === 'string' ? envBase.trim() : '';
  if (trimmed) {
    return { base: trimmed.replace(/\/+$/, ''), source: 'env', warning: null };
  }

  // Every place Metro's host might be, best first. hostUri is 'host:port' with no
  // scheme; experienceUrl is 'exp://host:port'; scriptURL is a full bundle URL.
  const parsed =
    parseHostUri(hostUri)
    || parseUrlish(experienceUrl)
    || parseUrlish(scriptURL);

  if (parsed && isReachableHost(parsed.hostname)) {
    // Metro's own port (8081/19000/…) is replaced, never reused: the bundle server
    // and the API are different processes on the same machine.
    return {
      base: `${parsed.scheme}://${parsed.hostname}:${apiPort}`,
      source: 'metro',
      warning: null,
    };
  }

  // A public hostname means Expo tunnel mode. The tunnel forwards METRO's port
  // only, so `https://<tunnel-host>:3000` would be an address that cannot work —
  // and quietly returning it would look exactly like the bug we just fixed.
  if (parsed) {
    return {
      base: `${LOCAL_FALLBACK}:${apiPort}`,
      source: 'unknown',
      warning:
        `The app is loading over a tunnel (${parsed.hostname}), which does not carry `
        + `port ${apiPort}. Set EXPO_PUBLIC_FAYR_API_BASE to a public URL for the `
        + 'backend, or run the phone and this machine on the same network.',
    };
  }

  return {
    base: `${LOCAL_FALLBACK}:${apiPort}`,
    source: 'unknown',
    warning:
      'Could not work out this machine\'s address from Metro, so the app is trying '
      + `localhost:${apiPort}. That works on a simulator only. On a real phone, set `
      + 'EXPO_PUBLIC_FAYR_API_BASE.',
  };
}

/**
 * Parse expo-constants' `hostUri`: 'host:port' or bare 'host', with no scheme.
 * Always http — Metro serves the bundle over plain HTTP in development.
 */
function parseHostUri(hostUri) {
  if (typeof hostUri !== 'string') return null;
  const raw = hostUri.trim();
  if (!raw) return null;
  // Reuse the URL parser by giving it the scheme it needs, so IPv6 brackets and
  // odd ports are handled by the platform rather than by a regex here.
  try {
    const url = new URL(`http://${raw.replace(/^[a-z]+:\/\//i, '')}`);
    if (!url.hostname) return null;
    return { hostname: url.hostname, scheme: 'http' };
  } catch {
    return null;
  }
}

/** Parse anything URL-shaped: 'exp://host:port' or a full bundle URL. */
function parseUrlish(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!url.hostname) return null;
    // exp:// is Expo's own scheme; the API is reached over http(s).
    const scheme = url.protocol === 'https:' ? 'https' : 'http';
    return { hostname: url.hostname, scheme };
  } catch {
    return null;
  }
}
