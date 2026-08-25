// Where the Fayr backend lives, as seen FROM the device.
//
// This used to be a written-down address (EXPO_PUBLIC_FAYR_API_BASE, else
// localhost) with a comment telling the developer to paste their LAN IP in. That
// is what broke first: on a laptop that moves between a dongle and a phone
// hotspot, the address is stale the moment the network changes.
//
// The replacement read NativeModules.SourceCode.scriptURL — which broke SECOND,
// and only on a real phone: Expo Go runs bridgeless (New Architecture), where
// SourceCode is a legacy bridge module and therefore absent, so scriptURL was
// always null and the app fell back to localhost with
// "Could not work out this machine's address from Metro".
//
// It now uses expo-constants, which is the supported route and ships inside Expo
// Go, so no native rebuild is needed. See apiBase.js for the full order of
// precedence and the tunnel caveat.

import Constants from 'expo-constants';
import { NativeModules } from 'react-native';
import { DEFAULT_API_PORT, apiBaseFrom } from './apiBase';

/**
 * Metro's host as Expo reports it, e.g. '192.168.1.20:8081'. Present in Expo Go
 * and in a dev build; absent in a production bundle.
 */
function expoHostUri() {
  try {
    return (Constants.expoConfig && Constants.expoConfig.hostUri) || null;
  } catch (e) {
    return null;
  }
}

/** Documented fallback, e.g. 'exp://192.168.1.20:8081'. */
function expoExperienceUrl() {
  try {
    return Constants.experienceUrl || null;
  } catch (e) {
    return null;
  }
}

/**
 * The legacy route, kept ONLY as a last resort. Works in a dev build (this project
 * sets newArchEnabled:false there) and is always null in Expo Go.
 */
function metroScriptUrl() {
  try {
    return (
      (NativeModules && NativeModules.SourceCode && NativeModules.SourceCode.scriptURL) || null
    );
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
    // address always wins. A .env.local with a LAN address keeps working.
    envBase:
      typeof process !== 'undefined' && process.env
        ? process.env.EXPO_PUBLIC_FAYR_API_BASE
        : null,
    hostUri: expoHostUri(),
    experienceUrl: expoExperienceUrl(),
    scriptURL: metroScriptUrl(),
    apiPort: Number(
      (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_FAYR_API_PORT)
        || DEFAULT_API_PORT,
    ),
  });
}

const resolved = resolveApiBaseDetailed();

export const API_BASE = resolved.base;

// Say which of the routes was taken, once, at startup. The first version said
// nothing at all, so a wrong address was indistinguishable from a dead backend.
if (resolved.warning) {
  console.warn(`[Fayr] backend address: ${API_BASE} — ${resolved.warning}`);
} else {
  console.log(
    `[Fayr] backend address: ${API_BASE}`
    + (resolved.source === 'metro' ? ' (found automatically from Metro)' : ' (set by you)'),
  );
}
