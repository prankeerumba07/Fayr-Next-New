// THE WORDS AND THE NUMBERS FOR THE SHEET, AND FOR THE CARD AFTERWARDS.
//
// Kept apart from the drawing so a plain node check can read every one of them
// without a phone.
//
// ── WHICH SHEET THIS COPIES ─────────────────────────────────────────────────
//
// TruecallerSheet, fayr-design.browser.jsx:631 to :649. Nothing here is invented:
// every number below was read off those lines and the line is written beside it.
// The design has three sheets — TruecallerSheet (:631), ClaimedSheet and
// InsufficientSheet — and this is the one that matches the job, because it is the
// design's own sheet for "hand off to somebody else's sign in and come back".
//
// ── ONE THING THE DESIGN DOES THAT A PHONE CANNOT ───────────────────────────
//
// The design blurs what is behind the sheet (backdropFilter, :634). That needs a
// native piece this app does not carry, so the dark layer is a little more solid
// instead, which is the closest honest thing without adding one. It is the same
// choice already made and written down for the reminder card on the home page.
//
// ── AND ONE PLACE THE DESIGN HAS NOTHING TO COPY ────────────────────────────
//
// The design's sheet is for Truecaller, a company Fayr has an arrangement with,
// so its own line reads "Truecaller shares your verified name & number with
// fayr." There is no such arrangement with any shop, so that line would be
// untrue here. The lines below say what really happens instead. The sentence
// about the terms is the design's own, word for word, from its sign in page
// at :626.

/** The design's own sheet shape. Every number is from TruecallerSheet. */
export const SHEET = {
  // :634 — the dark layer over the page behind.
  backdrop: 'rgba(20,20,20,0.45)',
  // :636 — the sheet itself.
  topRadius: 26,
  padTop: 24,
  padSide: 24,
  padBottom: 26,
  // :637 — the little bar at the top of the sheet.
  grabberWidth: 44,
  grabberHeight: 4,
  grabberColor: '#e2e2d6',
  grabberRadius: 4,
  grabberGapBelow: 18,
  // :638 — the small line above the shop's mark.
  titleSize: 15,
  // :639 — the round tile the design puts the face in.
  markSize: 70,
  markGapAbove: 16,
  markGapBelow: 10,
  // :640 and :641 — the name, and the line under it.
  nameSize: 20,
  underSize: 13,
  underGapAbove: 2,
  // OURS, AND THE ONE NUMBER ON THIS SHEET THAT IS. The design has ONE short line
  // under the name — a phone number — and this sheet has two sentences there,
  // because there are two things somebody signing in to a shop has to be told:
  // what it is for, and what Fayr can never see. Two sentences 2 points apart
  // read as one paragraph, so there is a proper gap between them. The design's
  // own 2 is still used for the first of the two, which is the line that follows
  // the name exactly as the design's does.
  betweenLines: 8,
  // :642 — the button.
  buttonGapAbove: 18,
  // :646 — the small print at the very bottom.
  noteSize: 10.5,
  noteColor: '#a3a49a',
  noteGapAbove: 4,
  // :636 — how long it takes to rise, in milliseconds, and how far from.
  riseMs: 350,
  riseFrom: 14,
};

/**
 * WHAT THE SHEET SAYS, for one shop.
 *
 * PLAIN WORDS AND ALL OF THEM TRUE. Fayr never sees the password, because the
 * person types it on the shop's own page. What Fayr reads afterwards is that
 * person's own order and their own review, on this phone, and nothing else.
 */
export function sheetWords(shopName) {
  const shop = String(shopName || 'the shop');
  return {
    title: 'Sign in on their own page',
    shopName: shop,
    // The one line about what the sign in is for.
    used: `Fayr needs to see your own ${shop} order and your own ${shop} review, `
      + 'and this is how it is allowed to. Nothing else is read, and nothing is '
      + 'ever ordered for you.',
    // What Fayr can and cannot see, in one sentence.
    never: `You sign in on ${shop}'s own page. Your password goes to ${shop} and `
      + 'Fayr never sees a single thing you type.',
    // The design's own sentence, :626.
    agree: 'By continuing you agree to our Terms & Privacy Policy.',
    button: `CONTINUE WITH ${shop.toUpperCase()}`,
    away: 'Not now',
  };
}

/**
 * WHAT THE CARD SAYS ONCE THE ACCOUNT IS CONNECTED.
 *
 * TWO SHAPES AND NO THIRD. Either the name on the shop account was read off the
 * shop's own page and the card carries it, or it was not and the card says the
 * account is connected and shows no name at all.
 *
 * IT NEVER INVENTS A NAME, and it never leaves an empty space where a name goes.
 * A wrong name under the word verified would tell somebody Fayr had checked
 * something it had not.
 */
export function verifiedCardWords(shopName, accountName) {
  const shop = String(shopName || 'the shop');
  const name = typeof accountName === 'string' && accountName.trim() !== ''
    ? accountName.trim()
    : null;
  return {
    title: `VERIFIED ${shop.toUpperCase()} ACCOUNT`,
    name,
    // Only ever drawn when there is a name. Never an empty row.
    showsName: name != null,
    manage: 'MANAGE',
    under: name != null
      ? `Signed in on ${shop}`
      : `Signed in on ${shop}. Fayr could not read the name on this account, so it `
        + 'is not shown.',
  };
}
