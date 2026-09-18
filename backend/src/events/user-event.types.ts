/**
 * WHAT WE WRITE DOWN ABOUT WHAT PEOPLE DO, AND WHAT WE REFUSE TO.
 *
 * One vocabulary, in one file, so a funnel step means the same thing in the app,
 * in the service that records it, and in the query that counts it. A step whose
 * name is spelled slightly differently in two places is a step that quietly
 * stops being counted, and nothing fails to tell you.
 *
 * ── THE RULE ABOUT PERSONAL DATA ──────────────────────────────────────────
 *
 * A mobile number NEVER goes in here, and neither does a name, an address, an
 * order id or an amount. This table is read by dashboards and exported into
 * spreadsheets, which is exactly the journey that turns a database column into a
 * leak. The link between an event and a person is the user id, or the app's own
 * anonymous id before there is one, and nothing else.
 *
 * ── AND THE ONE ABOUT ADDING STEPS ────────────────────────────────────────
 *
 * Adding a step means adding a value to the enum in schema.prisma AND a line
 * here. Removing one is not allowed: last quarter's numbers still have to be
 * countable next year. Retire a step by not writing it any more.
 */

/** Every step we can record. Mirrors the UserEventType enum, name for name. */
export const USER_EVENTS = [
  'APP_OPENED',
  'ONBOARDING_DONE',
  'PHONE_ENTRY_SEEN',
  'OTP_REQUESTED',
  'OTP_VERIFIED',
  'ACCOUNT_CREATED',
  'SETUP_STEP_DONE',
  'SETUP_DONE',
  'FEED_OPENED',
  'FIRST_CLAIM',
  'LOGGED_OUT',
  'SESSION_RENEWED',
  // NOT A FUNNEL STEP, and last on purpose because the list above reads in order.
  // Every step above happens once or twice in a person's life with Fayr. This one
  // happens every time a screen is drawn, and it answers a different question:
  // which screens do people actually reach, rather than how many got through
  // signing up. Same vocabulary because it is the same table and the same service.
  'SCREEN_VIEWED',
] as const;

export type UserEventName = (typeof USER_EVENTS)[number];

/**
 * The steps the APP has to tell us about, because the server never sees them.
 * Nobody calls the backend to read an onboarding screen.
 *
 * Listed separately so the one route the app posts to can refuse everything
 * else: an app that could write ACCOUNT_CREATED could inflate the signup count
 * from a laptop, and a number anybody can inflate is not a number.
 */
export const APP_REPORTABLE: readonly UserEventName[] = [
  'APP_OPENED',
  'ONBOARDING_DONE',
  'PHONE_ENTRY_SEEN',
  'FEED_OPENED',
  // Which screen somebody reached. Safe on a route with no sign-in on it for the
  // same reason the four above are: it names no money, no account and no claim,
  // so the worst a forged one can do is a dent in a chart. And it still carries
  // no free text — the DTO checks the name against APP_SCREENS below, so the only
  // strings that can ever land in the payload are ones written down in this file.
  'SCREEN_VIEWED',
];

/** Is this something the app is allowed to report about itself? */
export function appMayReport(name: unknown): name is UserEventName {
  return (
    typeof name === 'string' &&
    (APP_REPORTABLE as readonly string[]).includes(name)
  );
}

/** Is this a step we know at all? */
export function isKnownEvent(name: unknown): name is UserEventName {
  return (
    typeof name === 'string' && (USER_EVENTS as readonly string[]).includes(name)
  );
}

/**
 * EVERY SCREEN THE APP CAN SAY IT REACHED.
 *
 * Taken from App.js name for name, in the order it registers them: the four tabs
 * in TabsRoot, then the stack routes, then the one route per marketplace that the
 * navigator builds from PLATFORM_LIST in src/platforms.js.
 *
 * NOTHING HERE WAS INVENTED, and that is checked rather than promised.
 * user-event.types.spec.ts reads App.js and src/platforms.js off disk and fails
 * if this list and those files have drifted apart. That check is the point of the
 * file: a screen renamed in the app and not here becomes a chart line that
 * quietly goes flat, and nothing else in Fayr would say so.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * The first-run sign-in journey and the three-step setup. They are not registered
 * routes — App.js returns them before the navigator exists — so there is no route
 * name to borrow, and inventing one would be exactly what this list refuses to
 * do. They are already measured, and measured better, by their own steps above:
 * ONBOARDING_DONE, PHONE_ENTRY_SEEN, SETUP_STEP_DONE and SETUP_DONE say what
 * happened rather than what was drawn.
 *
 * ── A NAME, AND ONLY A NAME ───────────────────────────────────────────────
 *
 * Never a URL, never a route parameter, never an id. "Task" may be written down;
 * the task's id may not, and cannot arrive, because anything that is not exactly
 * one of these strings is refused by the DTO with a 400 before it reaches the
 * service. That is why this is an allow-list and not a length check: a length
 * check would happily store a mobile number.
 */
export const APP_SCREENS = [
  // The four tabs.
  'Home',
  'MyProducts',
  'Earnings',
  'Profile',
  // The stack.
  'Tabs',
  'Detail',
  'Claimed',
  'NotEnoughTickets',
  'JoinFailed',
  'Support',
  'Journey',
  'Chat',
  'LiveCheck',
  'LookingForIt',
  'LookingForReview',
  'IsThisYourOrder',
  'forceupdate',
  'maintenance',
  'linkaccount',
  'buyinterstitial',
  'proofprimer',
  'underreview',
  'ocrconfirm',
  'delivery',
  'reviewguide',
  'reviewproof',
  'returnwindow',
  'returncatch',
  // The shop inside Fayr as a journey step, Phase 7, 18 September 2026 — the
  // door src/screens/shop.js. App.js registers the route and this list is
  // checked against it by user-event.types.spec.ts, so a route cannot be added
  // without being written down here.
  'shop',
  'emailconnect',
  'emailcode',
  'orderverified',
  'imagesuploaded',
  'Walkthrough',
  'OneScreen',
  'Policy',
  'ProofUpload',
  'reward',
  'Wallet',
  'Task',
  // The shop, inside Fayr. One screen, not one per marketplace: only a shop
  // listed in src/shop/insideFayr.js is ever sent to it — Zepto alone today —
  // and which shop that was is not written down here, because this list holds a
  // screen name and never a parameter. Added 18 September 2026 for no reason
  // other than that App.js registers the route, and this list is checked against
  // App.js; it changes no behaviour on either side.
  'Shop',
  // Writing the review inside Fayr. Added 18 September 2026 for the same reason
  // as 'Shop' above: App.js registers the route and this list is checked against
  // App.js. A screen NAME and never what was written on it.
  'WriteReview',
  // One per marketplace: the connect screens, registered by the navigator from
  // PLATFORM_LIST. The route name IS the shop's key, so these are lower case
  // while most of the stack is not. Myntra is dormant and its entry is preserved
  // rather than removed, in line with how the rest of the project treats it.
  'flipkart',
  'amazon',
  'myntra',
  'meesho',
  'instamart',
  'blinkit',
  'zepto',
] as const;

export type AppScreenName = (typeof APP_SCREENS)[number];

/** Is this a screen the app actually has? */
export function isKnownScreen(name: unknown): name is AppScreenName {
  return (
    typeof name === 'string' && (APP_SCREENS as readonly string[]).includes(name)
  );
}

/**
 * The app's first-run identifier, as it reaches us.
 *
 * Bounded and character-checked because it arrives from a phone and lands in an
 * indexed column. A uuid is 36 characters; the ceiling is generous rather than
 * exact so a future format does not need a migration, and anything stranger than
 * uuid characters is refused rather than stored.
 */
const ANON_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

/** The anonymous id if it is one, or null. Never throws — a bad id is not an error. */
export function cleanAnonymousId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return ANON_SHAPE.test(s) ? s : null;
}

/** What a step is allowed to carry with it. Small, and never personal. */
export interface UserEventPayload {
  /** Which of the three setup questions was answered. */
  step?: number;
  /** Which marketplace a feed read was filtered to. */
  platform?: string;
  /** How many campaigns the feed had in it. */
  size?: number;
  /** Whether a verification created an account or found one. */
  created?: boolean;
  /**
   * Which screen was drawn. A NAME from APP_SCREENS and nothing else — never a
   * URL, never a route parameter, never an id. The DTO checks it against that
   * list before this object is built, so a name not on the list cannot reach the
   * table even by accident.
   */
  screen?: string;
}
