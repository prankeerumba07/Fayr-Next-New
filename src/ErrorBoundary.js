// The catch-all. Nothing in this app had one until now.
//
// A render error anywhere in a React tree with no boundary above it unmounts the
// WHOLE tree. In a dev build that is the red screen; in a release build it is a
// blank one, with no control on it, and the only way out is to force-quit. That
// is a demo ending mid-sentence, and it is the one failure the person holding the
// phone cannot talk their way past.
//
// TWO DELIBERATE ODDITIES, both so this file can actually be tested:
//
//   1. NO react-native import. The cream full-screen fallback lives in
//      ErrorFallback.js and arrives through the `renderFallback` prop. Keeping
//      this half free of RN is what lets src/errorBoundary.test.mjs mount it in a
//      real React reconciler under node and throw a real error inside it. Every
//      other screen test in this repo is a source-level guard because an RN screen
//      cannot be imported; a boundary that is only *believed* to catch is worth
//      nothing, so this one is proved instead.
//   2. React.createElement instead of JSX, for the same reason — node reads this
//      file with no transform.
//
// Both are enforced by that test, so the split cannot quietly collapse back.

import React from 'react';

/** Where an error goes when the caller does not say. The console IS the report:
 *  there is no telemetry in this app and this is not the week to add any. */
function logToConsole(error, info) {
  // Printed as one call so the message and the component stack cannot be
  // separated by other logging in between.
  console.error(
    '[ErrorBoundary] a render error was caught and the fallback was shown:',
    error,
    info && info.componentStack ? info.componentStack : '',
  );
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    // `generation` is bumped on every reset and used as the children's key, so a
    // reset REBUILDS the app rather than re-showing whatever state was mid-crash.
    this.state = { error: null, generation: 0 };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const report = this.props.onError || logToConsole;
    report(error, info);
  }

  /**
   * The fallback's single control.
   *
   * Clearing `error` re-renders the children — and because React already
   * unmounted them when the fallback took over, they mount FRESH. The key bump
   * makes that guarantee explicit rather than relying on it.
   *
   * Note what this deliberately does NOT do: call goHome() from src/ui/nav.js.
   * That helper needs a navigation object, and at the moment the fallback is on
   * screen the navigator is unmounted — there is nothing to navigate. Worse, this
   * boundary sits ABOVE the auth gate, so on a crash during sign-in there is no
   * "home" to go to yet. Rebuilding from the top lands the user wherever the app
   * legitimately starts: Home if they are signed in, the sign-in journey if they
   * are not. goHome() keeps its one job.
   */
  reset() {
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  }

  render() {
    if (this.state.error) {
      return this.props.renderFallback({ error: this.state.error, reset: this.reset });
    }
    // Keyed so `reset` is a rebuild. If the same bug throws again on the way back
    // up, componentDidCatch fires again and the fallback returns — a button that
    // keeps returning you here is survivable; a blank screen is not.
    return React.createElement(
      React.Fragment,
      { key: this.state.generation },
      this.props.children,
    );
  }
}
