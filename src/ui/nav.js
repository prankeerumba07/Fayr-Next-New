// Where a back control goes — and the guarantee that it goes SOMEWHERE.
//
// Reported live: inside Connect Marketplaces, after logging out of Amazon, there
// was no way back to Home and the app had to be force-quit. The class of bug
// behind that is worth stating plainly, because it is invisible in a screenshot:
//
//   navigation.goBack() is a SILENT NO-OP when there is nothing underneath.
//
// A back arrow wired straight to goBack() therefore looks like a working button
// and does nothing at all — indistinguishable, to the person tapping it, from a
// frozen app. Every pushed screen now routes its back control through here, so
// the worst case is "you end up on Home", never "nothing happens".
//
// Pure enough to test under node (same reason as stages.js / tasklist.js): the
// decision is separated from the navigating.

/** The stack route that holds the bottom-tab navigator (see App.js). */
export const ROOT_ROUTE = 'Tabs';
/** The tab to land on. Always Home, never "whichever tab was last open". */
export const HOME_ROUTE = 'Home';

/**
 * 'back' when there is a screen underneath to return to, 'home' otherwise.
 *
 * Deliberately defensive about the navigation object's shape: an unexpected
 * shape must fall through to 'home' (an exit) rather than to the no-op.
 */
export function exitAction(nav) {
  const can =
    nav && typeof nav.canGoBack === 'function' ? nav.canGoBack() === true : false;
  return can ? 'back' : 'home';
}

/**
 * Jump straight to Home, however deep the stack is. Used where unwinding one
 * screen at a time would strand the user somewhere worse: backing out of a task
 * that was reached from a marketplace drops them into the marketplace's own
 * website again, which is exactly what "no way back to Home" felt like.
 *
 * Returns what it did, so a caller (and a test) can tell a real exit from a
 * silent nothing.
 */
export function goHome(navigation) {
  if (!navigation || typeof navigation.navigate !== 'function') return 'none';
  navigation.navigate(ROOT_ROUTE, { screen: HOME_ROUTE });
  return 'home';
}

/** The standard back control: step back if possible, otherwise leave for Home. */
export function goBackOrHome(navigation) {
  if (!navigation) return 'none';
  if (exitAction(navigation) === 'back' && typeof navigation.goBack === 'function') {
    navigation.goBack();
    return 'back';
  }
  return goHome(navigation);
}
