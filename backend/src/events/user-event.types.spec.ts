import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP_REPORTABLE,
  APP_SCREENS,
  USER_EVENTS,
  appMayReport,
  isKnownEvent,
  isKnownScreen,
} from './user-event.types';

/**
 * THE VOCABULARY, AND WHETHER IT STILL MATCHES THE APP.
 *
 * The screen list is the only thing in the backend that has to agree with a file
 * in the phone app, and nothing at run time would ever notice if it stopped. A
 * screen renamed in App.js and not here does not throw, does not warn and does
 * not fail a request — it produces a chart line that quietly goes flat, which is
 * the worst kind of defect a measurement system can have, because the number
 * still looks like a number.
 *
 * So this reads App.js and src/platforms.js OFF DISK and compares. It is
 * deliberately not a copy of the list: a copy would drift in exactly the same way
 * and prove nothing.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * Every name the navigator registers as a literal.
 *
 * Matches across newlines because several routes are written over four lines with
 * the name on its own. Covers Stack, Tabs and Tab so a future navigator does not
 * slip past this check unmeasured.
 */
function screensRegisteredInAppJs(): string[] {
  const src = readFileSync(join(REPO_ROOT, 'App.js'), 'utf8');
  const found: string[] = [];
  const pattern = /<(?:Stack|Tabs|Tab)\.Screen\b[^>]*?\bname="([^"]+)"/gs;
  let m = pattern.exec(src);
  while (m) {
    found.push(m[1]);
    m = pattern.exec(src);
  }
  return found;
}

/**
 * The marketplace routes, which App.js does NOT write as literals.
 *
 * It registers one per entry of PLATFORM_LIST with `name={p.key}`, so the names
 * only exist in src/platforms.js. Read separately rather than skipped: these are
 * seven real registered routes and leaving them out of the check would leave a
 * seventh of the app unguarded.
 */
function platformRouteKeys(): string[] {
  const src = readFileSync(join(REPO_ROOT, 'src', 'platforms.js'), 'utf8');
  const found: string[] = [];
  const pattern = /^\s*key: '([^']+)',/gm;
  let m = pattern.exec(src);
  while (m) {
    found.push(m[1]);
    m = pattern.exec(src);
  }
  return found;
}

describe('the screen allow-list still matches the app', () => {
  it('finds the routes in App.js at all', () => {
    // If App.js moves or the navigator is rewritten, every check below would pass
    // vacuously over an empty list. This is the check that refuses to let that
    // happen quietly. 39 literals were counted on 17 September 2026.
    expect(screensRegisteredInAppJs().length).toBeGreaterThanOrEqual(39);
    expect(platformRouteKeys().length).toBeGreaterThanOrEqual(7);
  });

  it('has every route App.js registers as a literal', () => {
    const missing = screensRegisteredInAppJs().filter((n) => !isKnownScreen(n));
    expect(missing).toEqual([]);
  });

  it('has every marketplace route the navigator builds from PLATFORM_LIST', () => {
    const missing = platformRouteKeys().filter((n) => !isKnownScreen(n));
    expect(missing).toEqual([]);
  });

  it('names nothing the app does not register', () => {
    // The other direction, and the one that catches a name somebody invented or
    // a screen that has since been deleted. A name here with no route behind it
    // is a value the DTO would accept and no app would ever send.
    const real = new Set([...screensRegisteredInAppJs(), ...platformRouteKeys()]);
    const invented = APP_SCREENS.filter((n) => !real.has(n));
    expect(invented).toEqual([]);
  });

  it('lists each screen once', () => {
    expect(new Set(APP_SCREENS).size).toBe(APP_SCREENS.length);
  });
});

describe('isKnownScreen', () => {
  it('accepts a real route name', () => {
    // Four taken from App.js by hand: a tab, a stack route, a design-key route
    // and a marketplace connect screen, so all four ways a route gets registered
    // are covered by something a reader can check against the file.
    expect(isKnownScreen('Home')).toBe(true);
    expect(isKnownScreen('Journey')).toBe(true);
    expect(isKnownScreen('reviewguide')).toBe(true);
    expect(isKnownScreen('amazon')).toBe(true);
  });

  it('refuses an invented one', () => {
    expect(isKnownScreen('Dashboard')).toBe(false);
    expect(isKnownScreen('SettingsScreen')).toBe(false);
    expect(isKnownScreen('')).toBe(false);
  });

  it('refuses a name that is only nearly right', () => {
    // Case matters, because the route names are case sensitive and half of them
    // are lower case while half are not.
    expect(isKnownScreen('home')).toBe(false);
    expect(isKnownScreen('AMAZON')).toBe(false);
    expect(isKnownScreen(' Home')).toBe(false);
  });

  it('refuses a mobile number, an order id and a URL', () => {
    // The rule this whole allow-list exists for. None of these is a screen, so
    // none of them can be stored, and that is true without a single rule about
    // what a mobile number looks like.
    expect(isKnownScreen('+919812345678')).toBe(false);
    expect(isKnownScreen('9812345678')).toBe(false);
    expect(isKnownScreen('408-5614193-1514764')).toBe(false);
    expect(isKnownScreen('Task/9f1c2f70-1f6b-4a4e-9f0e-2b6c7a3d5e11')).toBe(false);
    expect(isKnownScreen('https://www.amazon.in/your-orders')).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    // Same shape as isKnownEvent and cleanAnonymousId: this is fed from a request
    // body, so undefined, null and an object all arrive in practice.
    expect(isKnownScreen(undefined)).toBe(false);
    expect(isKnownScreen(null)).toBe(false);
    expect(isKnownScreen(42)).toBe(false);
    expect(isKnownScreen(['Home'])).toBe(false);
    expect(isKnownScreen({ name: 'Home' })).toBe(false);
  });
});

describe('SCREEN_VIEWED joins the vocabulary', () => {
  it('is a step we know', () => {
    expect(isKnownEvent('SCREEN_VIEWED')).toBe(true);
    expect(USER_EVENTS).toContain('SCREEN_VIEWED');
  });

  it('is one the app is allowed to report', () => {
    expect(appMayReport('SCREEN_VIEWED')).toBe(true);
    expect(APP_REPORTABLE).toContain('SCREEN_VIEWED');
  });

  it('did not open the route up to anything else', () => {
    // The guard on the unsigned route is the SHORTNESS of this list. If adding a
    // screen step quietly let ACCOUNT_CREATED or FIRST_CLAIM through, somebody
    // with a laptop could inflate the signup count.
    expect([...APP_REPORTABLE].sort()).toEqual([
      'APP_OPENED',
      'FEED_OPENED',
      'ONBOARDING_DONE',
      'PHONE_ENTRY_SEEN',
      'SCREEN_VIEWED',
    ]);
  });

  it('is last, so the funnel above it still reads in order', () => {
    expect(USER_EVENTS[USER_EVENTS.length - 1]).toBe('SCREEN_VIEWED');
  });
});
