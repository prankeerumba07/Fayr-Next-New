// WHICH SHOPS THIS PERSON IS ALREADY SIGNED IN AT, FROM OUR OWN RECORD OF IT.
//
// ── WHY THIS FILE EXISTS: FAYR GOT ITSELF TAKEN FOR A ROBOT ─────────────────
//
// Measured from the owner's own log, 9 September 2026. Amazon connect SUCCEEDED
// at 19:06. At 19:10 the app asked Amazon for its sign in page AGAIN, for a
// second campaign. Amazon then served, in order:
//
//   a page whose whole body was "Click the button below to continue shopping"
//   HTTP 503 on /gp/sign-in.html
//   https://www.amazon.in/errors_page/validateCaptcha
//
// Amazon had decided we were a machine, and it was right to: nothing had changed
// on their side in four minutes except that we asked twice.
//
// ── AND THE REASON THE APP ASKED TWICE ──────────────────────────────────────
//
// It did not know. The journey's gate is src/ui/journey.js, one line:
//
//   if (s.connected !== true) return 'connect';
//
// and `connected` was worked out in src/journey/JourneyScreen.js from three
// things, none of which was our own record: whether THIS TASK already had an
// order, whether THIS CAMPAIGN had a purchase screenshot, and a note in a file
// on the phone keyed by `${campaignId}::signin`.
//
// Keyed BY CAMPAIGN. So a second campaign at the same shop was, as far as the app
// could tell, a shop nobody had ever signed in to. And a reinstall lost the lot.
//
// Our side has held the real answer since 4 September: one row per person per
// shop, for ever, in shop_sign_ins. Nothing had ever read it back. There was no
// getter on the service, no @Get on the controller, and no reader in the app.
// This is the reader.
//
// ── IT KEEPS A WAY TO CONNECT AGAIN, DELIBERATELY ───────────────────────────
//
// A shop can sign somebody out whenever it likes, and our record says "they got
// this far at least once", which is not the same as "they are signed in now". So
// this file NEVER hides the way in — the connect screen is still reachable by
// hand, and a read that fails because the shop wants a sign in raises the
// reconnect blocker, which is a thing the journey already knows how to say. What
// this changes is only whether the app walks somebody through a sign in they do
// not need.

/**
 * ── NOTHING IS IMPORTED HERE, AND THAT IS DELIBERATE ────────────────────────
 *
 * The obvious writing of this file imports getProfile from ./meApi.js, and it
 * cannot then be loaded under node at all: meApi reaches the transport, the
 * transport reaches the config, and the config reaches the phone. So the profile
 * reader is HANDED IN, by App.js, exactly the way evidenceSync's transport and
 * the task store's outbox reader already are. Same reason as those, recorded in
 * both: a store that cannot be walked is a store nothing checks.
 */
let readProfile = null;

/** Hand in the profile reader (meApi.getProfile). Wired once, by App.js. */
export function configure(fn) {
  readProfile = fn;
}

/**
 * Lower case shop keys, the way src/platforms.js spells them. Empty is the honest
 * starting point: nothing is known until our side has been asked.
 */
let connected = [];
let asked = false;
let listeners = [];

function notify() {
  for (const fn of listeners) {
    try { fn(list()); } catch (e) { /* a bad listener must not break the store */ }
  }
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

/** A copy, so nobody can edit the store by editing what they were handed. */
export function list() {
  return connected.slice();
}

/** Has our side been asked yet? A screen may want to wait rather than guess. */
export function haveWeAsked() {
  return asked;
}

/**
 * IS THIS SHOP ALREADY CONNECTED?
 *
 * ── FALSE IS THE ANSWER WE HAVE NOT ASKED YET, AND THAT IS THE SAFE WAY ────
 *
 * A wrong `false` costs one sign in visit that was not needed. A wrong `true`
 * drops somebody into a shop they are not signed in at, where the read finds
 * nothing and they are told to come back — with no way to sign in, because the
 * step that offers it was skipped. So the unknown case goes the way that always
 * has a way forward.
 */
export function isConnected(shopKey) {
  if (typeof shopKey !== 'string' || shopKey === '') return false;
  return connected.includes(shopKey.toLowerCase());
}

/**
 * Take the list from a profile our side sent.
 *
 * A profile WITHOUT the field is not an empty list. It is an older build of the
 * server, or a response we could not read, and treating it as "nothing is
 * connected" would put the sign in step back for everybody. So the field has to
 * be a real array before it is believed.
 */
export function applyProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : null;
  if (p == null) return false;
  if (!Array.isArray(p.connectedShops)) return false;
  connected = p.connectedShops
    .filter((s) => typeof s === 'string' && s !== '')
    .map((s) => s.toLowerCase());
  asked = true;
  notify();
  return true;
}

/**
 * THEY JUST SIGNED IN, SO STOP ASKING WITHIN THIS SESSION TOO.
 *
 * Our side is told at the same moment, by reportShopSignIn, and the next profile
 * read would carry it. But the next profile read is on the next launch or the
 * next return to the foreground, and the thing that has to stop happening is the
 * app asking the shop AGAIN four minutes later. So this is written down here as
 * well, rather than waiting.
 */
export function markConnected(shopKey) {
  if (typeof shopKey !== 'string' || shopKey === '') return false;
  const key = shopKey.toLowerCase();
  if (connected.includes(key)) return false;
  connected = connected.concat([key]);
  notify();
  return true;
}

/**
 * Ask our side. Never throws; a failure leaves what we already knew.
 *
 * NO READER MEANS NO ANSWER, not an empty list. If App.js has not wired this yet
 * the honest result is that we still have not asked, which keeps the sign in step
 * where it is — the safe direction.
 */
export async function load() {
  if (typeof readProfile !== 'function') return false;
  try {
    const res = await readProfile();
    if (!res || !res.ok || !res.profile) return false;
    return applyProfile(res.profile);
  } catch (e) {
    return false;
  }
}

/** Forget everything. Signing out must not leave one person's list for the next. */
export function forget() {
  connected = [];
  asked = false;
  notify();
}

/** For the checks only: put the reader back to nothing between cases. */
export function forgetTheReader() {
  readProfile = null;
}
