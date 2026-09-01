// EVERY SCREEN IN THE DESIGN, IN THE DESIGN'S OWN ORDER AND GROUPS.
//
// Most of the design's screens only appear when something goes wrong: the last
// seat gone, the shop refusing to load, an account restricted, a delivery late, a
// code typed wrongly five times. You cannot reach those by using the app, which
// means nobody has ever looked at most of them on a real handset. This is the list
// that makes all of them reachable by tapping.
//
// THE ORDER AND THE GROUPS ARE NOT MINE. The design file keeps its own grouped list
// of screens (FLOW_GROUPS) and its own map of every screen it can render. Both are
// read back out of fayr-design.browser.jsx by catalogue.test.mjs, which fails if a
// screen is added there and not added here. So this file cannot quietly fall
// behind the design, which is the way a list like this normally dies.
//
// The design's own grouped list forgets five of its own screens — it can render
// them but has no button for them. They are kept here under a last group that says
// so, because "every screen" means every screen.
//
// WHAT OPENS. Where Fayr has a real screen, `opens` names it and the real screen is
// what appears, filled in from the practice data through the real requests. Where
// the design has a screen and Fayr has nothing behind it, `designWords` carries the
// design's own words, shown as its own words and marked as not built. Nothing here
// invents a screen Fayr does not have.
//
// NOTHING HERE WRITES. Every entry declares the reads its screen makes, all of
// them GETs, and while the walk through is open the transport refuses everything
// that is not a GET (src/backend/showing.js). backend/test/walkthrough.e2e-spec.ts
// counts every row in every table, makes every read in this file, and counts again.

/** The design's group names, in the design's order. Not ours to reorder. */
export const LAUNCH = 'Launch & auth';
export const SETUP = 'Setup';
export const CLAIM = 'Claim flow';
export const JOURNEY = 'Journey';
export const TABS = 'Tabs';
export const EDGES = 'Edge states';
export const VERIFIER = 'Verifier (live logic)';
/** Ours, and named so nobody mistakes it for one of the design's own. */
export const FORGOTTEN = 'In the design, missing from its own list';

/** The reads each kind of screen makes, named once so entries stay readable. */
const READS = {
  none: [],
  feed: ['/campaigns', '/me/wallet', '/tasks'],
  campaign: ['/campaigns'],
  oneCampaign: ['/campaigns', '/campaigns/:id'],
  task: ['/campaigns', '/tasks', '/tasks/:id'],
  taskShots: ['/campaigns', '/tasks', '/tasks/:id', '/tasks/:id/screenshots'],
  wallet: ['/me/wallet', '/withdrawals', '/me/payout-methods'],
  me: ['/me', '/me/wallet'],
  products: ['/campaigns', '/tasks'],
};

/**
 * Every screen, keyed by the design's own key for it.
 *
 * `title` is in plain words, and it is mine. `designWords` is the design's, quoted
 * as written including its own punctuation, and appears only where nothing is
 * built. Where both a real screen and design words would be possible, the real
 * screen wins: this is a walk through the app, not a slideshow about it.
 */
export const SCREENS = {
  // ── Launch & auth ─────────────────────────────────────────────────────────
  splash: {
    group: LAUNCH,
    title: 'The logo, while the app wakes up',
    opens: { screen: 'Splash' },
    reads: READS.none,
  },
  onboard: {
    group: LAUNCH,
    title: 'The three opening animations',
    opens: { screen: 'Onboarding' },
    reads: READS.none,
  },
  authlanding: {
    group: LAUNCH,
    title: 'Shop. Review. Earn.',
    opens: { screen: 'AuthLanding' },
    reads: READS.none,
  },
  truecaller: {
    group: LAUNCH,
    title: 'Signing in with one tap through Truecaller',
    opens: { screen: 'Truecaller' },
    reads: READS.none,
    note:
      'The sheet is built. Nothing is behind it: Fayr cannot turn a Truecaller '
      + 'sign in into a session, and the screen says so rather than offering a '
      + 'button that fails. The name and number are handed in, because the '
      + "design has a real person's name and number written into this screen.",
  },
  phone: {
    group: LAUNCH,
    title: 'Typing your number',
    opens: { screen: 'PhoneEntry' },
    reads: READS.none,
  },
  otp: {
    group: LAUNCH,
    title: 'Typing the code',
    opens: { screen: 'Otp' },
    reads: READS.none,
  },

  // ── Setup ─────────────────────────────────────────────────────────────────
  setupintro: {
    group: SETUP,
    title: 'Setting up: the welcome',
    opens: { screen: 'Setup', at: 'setupintro' },
    reads: READS.none,
  },
  setup: {
    group: SETUP,
    title: 'Setting up: your age, and what you shop for',
    opens: { screen: 'Setup', at: 'setup' },
    reads: READS.none,
  },
  namelast: {
    group: SETUP,
    title: 'Setting up: your name',
    opens: { screen: 'Setup', at: 'namelast' },
    reads: READS.none,
  },
  buildfeed: {
    group: SETUP,
    title: 'Setting up: building your feed',
    opens: { screen: 'Setup', at: 'buildfeed' },
    reads: READS.none,
  },
  howfayr: {
    group: SETUP,
    title: 'Setting up: how Fayr works, before the first claim',
    opens: { screen: 'Setup', at: 'howfayr' },
    reads: READS.none,
  },

  // ── Claim flow ────────────────────────────────────────────────────────────
  home: {
    group: CLAIM,
    title: 'The home feed',
    opens: { screen: 'Home' },
    reads: READS.feed,
  },
  allcampaigns: {
    group: CLAIM,
    title: 'Every live offer on one page',
    designWords: {
      heading: 'All campaigns · 16',
      body:
        'Every live offer, featured included, grouped into the same chapters the '
        + 'home feed uses, one full-width card each.',
      buttons: [],
    },
    whyNot:
      'The home feed shows the offers grouped into chapters and nothing more. '
      + 'There is no see-everything page behind it, so a long list of offers can '
      + 'only be reached by scrolling the feed.',
    reads: READS.none,
  },
  howworks: {
    group: CLAIM,
    title: 'The how it works video',
    designWords: {
      heading: 'How it works?',
      body: 'A forty five second video, shown once, before the first claim.',
      buttons: [],
    },
    whyNot:
      'There is no video. The design leaves a space for one and marks it as a '
      + 'space. The same ground is covered in words on the setting up screens.',
    reads: READS.none,
  },
  detail: {
    group: CLAIM,
    title: 'One offer, in full',
    opens: { screen: 'Detail' },
    reads: READS.oneCampaign,
  },
  claimedsheet: {
    group: CLAIM,
    title: 'Claimed, and what to do next',
    opens: { screen: 'Claimed' },
    reads: READS.campaign,
  },
  linkaccount: {
    group: CLAIM,
    title: 'Connecting your shop account',
    opens: { screen: 'LinkAccount' },
    reads: READS.task,
  },
  redirect: {
    group: CLAIM,
    title: 'Handing you over to the shop',
    designWords: {
      heading: 'Taking you to Amazon…',
      body:
        'A short pause with the shop named, while the app hands the person over '
        + 'to the marketplace.',
      buttons: [],
    },
    whyNot:
      'The buy step opens the shop straight away. Nothing sits in between, so '
      + 'there is no screen to show.',
    reads: READS.none,
  },
  notifprime: {
    group: CLAIM,
    title: 'Asking to send reminders',
    designWords: {
      heading: 'Want a reminder?',
      body: 'Your claim is held until a set time, and a reminder would say when.',
      buttons: [],
    },
    whyNot:
      'Fayr sends no notifications at all yet, so there is nothing to ask '
      + 'permission for. Asking before there is anything to send would spend the '
      + 'one chance to ask on nothing.',
    reads: READS.none,
  },

  // ── Journey ───────────────────────────────────────────────────────────────
  buyinterstitial: {
    group: JOURNEY,
    title: 'Buy exactly this one',
    opens: { screen: 'BuyInterstitial' },
    reads: READS.task,
  },
  returncatch: {
    group: JOURNEY,
    title: 'Asking whether you bought it',
    opens: { screen: 'ReturnCatch' },
    reads: READS.campaign,
    note:
      'Built 1 September 2026, on the owner\'s instruction. The old reason for '
      + 'skipping it was half right: the journey does work out where somebody is '
      + 'from what the shop and the server say, from the moment either says '
      + 'anything. In the gap before that, somebody who had just come back from '
      + 'the shop was being shown "Before you go". Saying yes skips nothing: it '
      + 'moves them one screen on, to the one that asks for the order.',
  },
  proofprimer: {
    group: JOURNEY,
    title: 'What the order screenshot has to show',
    opens: { screen: 'ProofPrimer' },
    reads: READS.task,
  },
  emailconnect: {
    group: JOURNEY,
    title: 'Connecting your inbox instead of taking screenshots',
    opens: { screen: 'EmailConnect' },
    reads: READS.none,
    note:
      'The page the owner asked about by name, built 1 September 2026. The screen '
      + 'is real and is the design\'s. What is not built is anywhere for the '
      + 'answer to go: Fayr has no route that connects an inbox and nothing that '
      + 'reads an email, and both actions say so on the screen rather than '
      + 'pretending. This is still the strongest evidence Fayr could ever hold, '
      + 'because a shop signs its own emails and nobody can forge that.',
  },
  emailcode: {
    group: JOURNEY,
    title: 'The code sent to your inbox',
    opens: { screen: 'EmailCode' },
    reads: READS.none,
    note:
      'The second half of connecting an inbox, built the same day. Nothing has '
      + 'sent a code and the screen says so at the top, rather than letting '
      + 'somebody type six digits and wait.',
  },
  proofupload: {
    group: JOURNEY,
    title: 'Sending the order screenshot',
    opens: { screen: 'ProofUpload', at: 'PURCHASE' },
    reads: READS.taskShots,
  },
  ocrconfirm: {
    group: JOURNEY,
    title: 'Confirming the order details are yours',
    opens: { screen: 'OcrConfirm' },
    reads: READS.task,
    note:
      'Built and reachable for the first time on 1 September 2026. The task '
      + 'engine has always had a gate here — "this is my order" — and the design '
      + 'has always had this screen for it, but the app had none, so the tap that '
      + 'fired the gate sat on the delivery screen under the words "Yes, it is '
      + 'delivered". Two different facts under one button. It has its own screen '
      + 'now, and the rows are filled from the real order. The reading of a '
      + 'screenshot is not shown beside them yet.',
  },
  orderverified: {
    group: JOURNEY,
    title: 'Order confirmed, refund on its way',
    opens: { screen: 'OrderVerified' },
    reads: READS.task,
    note:
      'Built 1 September 2026 and reached from ocrconfirm the moment somebody '
      + 'confirms their order details. The amount is what the server says would '
      + 'be paid if it were released now, not a percentage of a listed price, and '
      + 'when no figure can be settled yet no figure is shown.',
  },
  taskstatus: {
    group: JOURNEY,
    title: 'Where this claim stands',
    opens: { screen: 'Task' },
    reads: READS.task,
  },
  deliveryupload: {
    group: JOURNEY,
    title: 'Sending the delivery screenshot',
    opens: { screen: 'ProofUpload', at: 'DELIVERY' },
    reads: READS.taskShots,
  },
  imagesuploaded: {
    group: JOURNEY,
    title: 'Your pictures were received, and what to do next',
    opens: { screen: 'ImagesUploaded' },
    reads: READS.campaign,
    note:
      'Built 1 September 2026. The old reason for skipping it missed what the '
      + 'screen is for: it is not there to repeat that the picture arrived, it is '
      + 'there to say what to do next, and after a delivery picture that is go and '
      + 'write the review, which nothing was telling anybody. It is given the kind '
      + 'of picture, so it says the right next thing for each of the three.',
  },
  delivery: {
    group: JOURNEY,
    title: 'Has it arrived?',
    opens: { screen: 'Delivery' },
    reads: READS.task,
  },
  honesty: {
    group: JOURNEY,
    title: 'One star or five, the money is the same',
    designWords: {
      heading: "1★ or 5★ — you're paid the same",
      body:
        'Write what you really think. Quality tips: mention how you used it, what '
        + "surprised you, and who it's for. That's it — shown once, never again.",
      buttons: [],
    },
    whyNot:
      'This is the promise the whole product rests on, and it has no screen of '
      + 'its own. The words are on the review page instead, where somebody is '
      + 'about to write, which is arguably the better place for them.',
    reads: READS.none,
  },
  reviewguide: {
    group: JOURNEY,
    title: 'Writing the review',
    opens: { screen: 'ReviewGuide' },
    reads: READS.task,
  },
  reviewproof: {
    group: JOURNEY,
    title: 'Sending the review screenshot',
    opens: { screen: 'ReviewProof' },
    reads: READS.task,
  },
  verifywait: {
    group: JOURNEY,
    title: 'Your review is being checked',
    opens: { screen: 'Task' },
    reads: READS.task,
  },
  returnwindow: {
    group: JOURNEY,
    title: 'Waiting for the return window to close',
    opens: { screen: 'ReturnWindow' },
    reads: READS.task,
  },
  reward: {
    group: JOURNEY,
    title: 'The refund is yours',
    opens: { screen: 'Reward' },
    reads: READS.campaign,
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  myproducts: {
    group: TABS,
    title: 'My products',
    opens: { screen: 'MyProducts' },
    reads: READS.products,
  },
  earnings: {
    group: TABS,
    title: 'Earnings',
    opens: { screen: 'Earnings' },
    reads: READS.wallet,
  },
  withdraw: {
    group: TABS,
    title: 'Taking money out',
    opens: { screen: 'Wallet' },
    reads: READS.wallet,
  },
  insights: {
    group: TABS,
    title: 'Your profile, with the numbers',
    opens: { screen: 'Profile' },
    reads: READS.me,
  },
  profile: {
    group: TABS,
    title: 'Your profile',
    opens: { screen: 'Profile' },
    reads: READS.me,
  },
  notifcenter: {
    group: TABS,
    title: 'Everything that has happened, as a list',
    designWords: {
      heading: 'Notifications',
      body:
        'Claim a product and every update — purchase, delivery, review, refund, '
        + 'payment — lands here as a timeline.',
      buttons: [],
    },
    whyNot:
      'Each claim keeps its own timeline on its status screen. There is no one '
      + 'place gathering them, and no notifications to gather.',
    reads: READS.none,
  },

  // ── Edge states ───────────────────────────────────────────────────────────
  forceupdate: {
    group: EDGES,
    title: 'This version is too old to use',
    opens: { screen: 'ForceUpdate' },
    reads: READS.none,
    note:
      'Built, and nothing decides to show it: Fayr has no version check, so '
      + 'nothing can work out that a version has been retired.',
  },
  maintenance: {
    group: EDGES,
    title: 'Fayr is down on purpose',
    opens: { screen: 'Maintenance' },
    reads: READS.none,
    note:
      'Built, and nothing decides to show it. The card says when Fayr is back '
      + 'only when something hands a time in; the design writes one into the '
      + 'file, and a written-in time would be wrong every time it was shown.',
  },
  otplocked: {
    group: EDGES,
    title: 'Too many wrong codes',
    opens: { screen: 'OtpLocked' },
    reads: READS.none,
  },
  blocked: {
    group: EDGES,
    title: 'This account is restricted',
    opens: { screen: 'Blocked' },
    reads: READS.none,
  },
  newdevice: {
    group: EDGES,
    title: 'Signing in on a new phone with money in the wallet',
    opens: { screen: 'NewDevice' },
    reads: READS.none,
    note:
      'Built, and nothing decides to show it: Fayr records no device against a '
      + 'session. It would also add no safety today, because every sign in '
      + 'already needs a code.',
  },
  seatlost: {
    group: EDGES,
    title: 'Somebody took the last place',
    opens: { screen: 'JoinFailed', at: 'seat-lost' },
    reads: READS.campaign,
  },
  enrollfailed: {
    group: EDGES,
    title: 'The claim did not go through',
    opens: { screen: 'JoinFailed' },
    reads: READS.campaign,
  },
  waitlisted: {
    group: EDGES,
    title: 'Waiting for a place to open',
    designWords: {
      heading: "You're on the waitlist",
      body:
        '0 tickets to queue. If a seat opens we'
        + "'ll invite you — invites are time-boxed, so claim fast when it comes.",
      buttons: [],
    },
    whyNot:
      'There is no waiting list. A full offer is simply full, and the words on '
      + 'the failed claim screen say so. This is the one place where a screen '
      + 'that IS built offers a button that goes nowhere.',
    reads: READS.none,
  },
  deliverydelayed: {
    group: EDGES,
    title: 'The parcel is late, wrong, or lost',
    designWords: {
      heading: 'Delivery issue',
      body:
        "It's delayed: share tracking proof and the deadline extends. Wrong or "
        + 'damaged: replace through the marketplace, or return and leave. Order '
        + "lost: tickets returned, seat released, couriers aren't your fault.",
      buttons: ['Back'],
    },
    whyNot:
      'Three real situations with three different answers, and no screen for any '
      + 'of them. Today somebody in this position writes to support. Of everything '
      + 'unbuilt here, this is the one a real person is most likely to need.',
    reads: READS.none,
  },
  confirm: {
    group: EDGES,
    title: 'Confirming what a claim costs',
    opens: { screen: 'Confirm' },
    reads: READS.oneCampaign,
  },
  enrollsuccess: {
    group: EDGES,
    title: 'You are in',
    opens: { screen: 'Claimed' },
    reads: READS.campaign,
  },
  tickets: {
    group: EDGES,
    title: 'Your tickets, and how they come back',
    designWords: {
      heading: 'Your tickets',
      body:
        'Held tickets return if a claim expires before purchase. Complete '
        + 'campaigns to earn more. The loop: start with 20, joining locks a few, '
        + 'completing returns them.',
      buttons: [],
    },
    whyNot:
      'The profile shows how many tickets are left as a line that does not open. '
      + 'Nowhere explains how they come back, which is the part people ask about. '
      + 'The design also says twenty to start where Fayr gives fifteen, so the '
      + 'words here would need correcting before they are shown to anybody.',
    reads: READS.none,
  },

  // ── Verifier ──────────────────────────────────────────────────────────────
  verifier: {
    group: VERIFIER,
    title: 'Reading the shop, on the phone',
    opens: { screen: 'Connect' },
    reads: READS.campaign,
  },

  // ── In the design, missing from its own list ──────────────────────────────
  campaigns: {
    group: FORGOTTEN,
    title: 'My products, under its older name',
    opens: { screen: 'MyProducts' },
    reads: READS.products,
    note: 'A second key for the same screen. Kept because the design still has it.',
  },
  deliverycheck: {
    group: FORGOTTEN,
    title: 'Reading the delivery email',
    designWords: {
      heading: 'Has your order arrived?',
      body:
        'Reading your delivery confirmation. This only takes a moment. Then: '
        + 'delivery verified, confirmed from your email.',
      buttons: [],
    },
    whyNot: 'Part of connecting an inbox, and unbuilt with the rest of it.',
    reads: READS.none,
  },
  insufficient: {
    group: FORGOTTEN,
    title: 'Not enough tickets',
    opens: { screen: 'NotEnoughTickets' },
    reads: READS.oneCampaign,
  },
  setupintrolegacy: {
    group: FORGOTTEN,
    title: 'The older setting up welcome',
    designWords: {
      heading: "Let's set up your profile",
      body:
        'Takes about 30 seconds — so we can show you campaigns worth your time.',
      buttons: ["LET'S GO"],
    },
    whyNot:
      'The design replaced this with the welcome that is built. It is here only '
      + 'because the design still carries it, and it should probably be deleted '
      + 'from the design rather than built.',
    reads: READS.none,
  },
  underreview: {
    group: FORGOTTEN,
    title: 'Waiting while something is checked',
    opens: { screen: 'UnderReview' },
    reads: READS.none,
    note:
      'Its own screen since 1 September 2026. It used to share one page with '
      + 'ocrconfirm, which is a different thing: this one is the wait, that one '
      + 'is the details.',
  },
};

/**
 * The order. The design's seven groups in the design's order, then ours.
 *
 * The keys inside each group are the design's order too, taken from its own
 * grouped list. catalogue.test.mjs checks both against the design file, so this
 * cannot drift into an order somebody merely finds tidy.
 */
export const GROUPS = [
  { name: LAUNCH, keys: ['splash', 'onboard', 'authlanding', 'truecaller', 'phone', 'otp'] },
  { name: SETUP, keys: ['setupintro', 'setup', 'namelast', 'buildfeed', 'howfayr'] },
  {
    name: CLAIM,
    keys: ['home', 'allcampaigns', 'howworks', 'detail', 'claimedsheet', 'linkaccount',
      'redirect', 'notifprime'],
  },
  {
    name: JOURNEY,
    keys: ['buyinterstitial', 'returncatch', 'proofprimer', 'emailconnect', 'emailcode',
      'proofupload', 'ocrconfirm', 'orderverified', 'taskstatus', 'deliveryupload',
      'imagesuploaded', 'delivery', 'honesty', 'reviewguide', 'reviewproof', 'verifywait',
      'returnwindow', 'reward'],
  },
  { name: TABS, keys: ['myproducts', 'earnings', 'withdraw', 'insights', 'profile', 'notifcenter'] },
  {
    name: EDGES,
    keys: ['forceupdate', 'maintenance', 'otplocked', 'blocked', 'newdevice', 'seatlost',
      'enrollfailed', 'waitlisted', 'deliverydelayed', 'confirm', 'enrollsuccess', 'tickets'],
  },
  { name: VERIFIER, keys: ['verifier'] },
  {
    name: FORGOTTEN,
    keys: ['campaigns', 'deliverycheck', 'insufficient', 'setupintrolegacy', 'underreview'],
  },
];

/** Every key, flat, in walking order. The next and back arrows step through this. */
export const WALK = GROUPS.flatMap((g) => g.keys);

/** How many screens there are. Printed on the list, so a count is never guessed. */
export const HOW_MANY = WALK.length;

/** True when Fayr has a real screen behind this design screen. */
export function isBuilt(key) {
  const s = SCREENS[key];
  return s != null && s.opens != null;
}

/** The keys with nothing behind them, in walking order. Named on the list itself. */
export const NOT_BUILT = WALK.filter((k) => !isBuilt(k));

/** Where a key sits in the walk, counting from one. Zero when it is not in it. */
export function stepOf(key) {
  return WALK.indexOf(key) + 1;
}

/** The next key, or null at the end. The end is an end, not a wrap round. */
export function nextFrom(key) {
  const at = WALK.indexOf(key);
  return at === -1 || at === WALK.length - 1 ? null : WALK[at + 1];
}

/** The previous key, or null at the start. */
export function backFrom(key) {
  const at = WALK.indexOf(key);
  return at <= 0 ? null : WALK[at - 1];
}

/**
 * Everything one page of the walk through needs, worked out in one place.
 *
 * The screen itself holds no copy of any of this, so a page can never disagree
 * with the list it came from.
 */
export function pageFor(key) {
  const screen = SCREENS[key];
  if (screen == null) return null;
  const step = stepOf(key);
  return {
    key,
    group: screen.group,
    title: screen.title,
    step,
    of: HOW_MANY,
    where: `${step} of ${HOW_MANY} · ${screen.group}`,
    built: isBuilt(key),
    opens: screen.opens ?? null,
    designWords: screen.designWords ?? null,
    whyNot: screen.whyNot ?? null,
    note: screen.note ?? null,
    back: backFrom(key),
    next: nextFrom(key),
  };
}

/** Every read the whole walk makes, once each. The counting test uses this list. */
export const EVERY_READ = [...new Set(WALK.flatMap((k) => SCREENS[k].reads))].sort();

/**
 * The line the walk through prints on itself.
 *
 * Not a footnote. Somebody handed a phone mid-demonstration will press things,
 * and the reason nothing happens has to be on the screen they are looking at.
 */
export const WHAT_THIS_IS =
  'For showing the app, not for using it. Every screen here is the real one with '
  + 'real practice information in it, and while this is open the app reads and '
  + 'never writes: no claim is spent, no money moves, no text message is sent.';
