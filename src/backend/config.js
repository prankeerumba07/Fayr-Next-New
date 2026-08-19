// Where the Fayr backend lives, as seen FROM the device.
//
// This used to be a written-down address (EXPO_PUBLIC_FAYR_API_BASE, else
// localhost) with a comment telling the developer to put their LAN IP in it. That
// is exactly what broke: on a laptop that moves between a dongle and a phone
// hotspot, the address is stale the moment the network changes, and the app can
// only report "network request failed".
//
// It is now derived from the host Metro served the JS bundle from — see
// apiBase.js for the reasoning and the tunnel caveat. Normally there is nothing
// to set and nothing to keep in sync.

import { NativeModules } from 'react-native';
import { DEFAULT_API_PORT, apiBaseFrom } from './apiBase';

/**
 * The URL the phone loaded this bundle from, e.g.
 * http://192.168.1.20:8081/index.bundle?platform=ios — core React Native, present
 * in Expo Go and in a dev build, absent in a release bundle.
 */
function metroScriptUrl() {
  try {
    return (NativeModules && NativeModules.SourceCode && NativeModules.SourceCode.scriptURL) || null;
  } catch (e) {
    return null;
  }
}

export function resolveApiBase() {
  return resolveApiBaseDetailed().base;
}

/** The same answer, with where it came from — used for the one startup log. */
export function resolveApiBaseDetailed() {
  return apiBaseFrom({
    // Still honoured, and still the right answer for a tunnel: an explicitly set
    // address always wins.
    envBase:
      typeof process !== 'undefined' && process.env
        ? process.env.EXPO_PUBLIC_FAYR_API_BASE
        : null,
    scriptURL: metroScriptUrl(),
    apiPort: Number(
      (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_FAYR_API_PORT)
        || DEFAULT_API_PORT,
    ),
  });
}

const resolved = resolveApiBaseDetailed();

export const API_BASE = resolved.base;

// Say which of the three routes was taken, once, at startup. The previous version
// said nothing, so a wrong address was indistinguishable from a dead backend.
if (resolved.warning) {
  console.warn(`[Fayr] backend address: ${API_BASE} — ${resolved.warning}`);
} else {
  console.log(
    `[Fayr] backend address: ${API_BASE}`
    + (resolved.source === 'metro' ? ' (found automatically from Metro)' : ' (set by you)'),
  );
}
