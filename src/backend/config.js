// Where the Fayr backend lives, as seen FROM the device.
//
// Unlike the web prototype (which reads window.location), a native build has no
// implicit origin, so the base URL is configuration:
//   - EXPO_PUBLIC_FAYR_API_BASE, if set (Expo inlines EXPO_PUBLIC_* at build).
//   - else a dev default of http://localhost:3000.
//
// GOTCHA: `localhost` resolves to the DEVICE, not your dev machine. It works on
// the iOS simulator (shared loopback) but NOT on a physical phone, and the
// Android emulator needs http://10.0.2.2:3000. On a real device set
// EXPO_PUBLIC_FAYR_API_BASE to your machine's LAN IP, e.g.
// http://192.168.1.20:3000 — the same host that runs the backend.
const DEFAULT_BASE = 'http://localhost:3000';

export function resolveApiBase() {
  const fromEnv =
    typeof process !== 'undefined' &&
    process.env &&
    process.env.EXPO_PUBLIC_FAYR_API_BASE;
  return (fromEnv && String(fromEnv).replace(/\/+$/, '')) || DEFAULT_BASE;
}

export const API_BASE = resolveApiBase();
