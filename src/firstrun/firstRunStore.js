// "Has this install seen the onboarding slides?"
//
// Deliberately NOT part of the session: signing out must not replay three
// introductory slides at someone who has used the app for months. It is also not
// on the server — it is a property of this install, and asking the backend would
// make the first paint wait on the network.
//
// SecureStore rather than a plain file only because it is already a dependency
// (authSession uses it) and needs no extra native module.
import * as SecureStore from 'expo-secure-store';

const KEY = 'fayr_onboarding_seen_v1';

export async function hasSeenOnboarding() {
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch (e) {
    // A read failure must not block the app; showing the slides again is the
    // harmless direction to fail in.
    return false;
  }
}

export async function markOnboardingSeen() {
  try {
    await SecureStore.setItemAsync(KEY, '1');
  } catch (e) {
    /* not worth surfacing — worst case the slides show once more */
  }
}

/** Dev/testing helper: replay the first-run journey from the start. */
export async function resetOnboarding() {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch (e) {
    /* nothing to undo */
  }
}
