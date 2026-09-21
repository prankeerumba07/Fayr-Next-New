// The live page check, on the device.
//
// TWO HALVES, both pure so both are checked under node.
//
//   READING A SHOP PAGE. What a page that came back actually says: did it open,
//   has the offer ended, has the shop run out. Only the words a shopper would see
//   on the page decide it.
//
//   DRAWING A GREYED-OUT CARD. What the offer feed does with the answer the
//   server already worked out.
//
// HOW THE PAGE IS OPENED, and why there is no second way of opening one. The
// existing scraper opens marketplace pages by running a fetch INSIDE the WebView
// the person is already signed in to, and posting the result back through
// window.ReactNativeWebView.postMessage. That is the same transport used here,
// with the same per-platform settings out of platforms.js, which this file only
// reads and never changes. Nothing about a marketplace's protections is touched:
// the request is the one a signed-in shopper's own browser makes, from their own
// session, on their own device.
//
// AND ONE ATTEMPT ONLY. If a page does not come back, the answer is "we could not
// open it" and the run moves on. No retry, no second user agent, no waiting and
// trying again — that is what pushing against a shop's limits looks like, and the
// honest answer costs nothing.

import { PLATFORMS } from './platforms.js';

/** Everything a look at a page can end in. Mirrors the backend exactly. */
export const LIVE_STATES = [
  'opened',
  'expired',
  'sold-out',
  'unavailable',
  'could-not-open',
  'no-link',
];

/** How long to wait for one page before giving up on it. */
export const PAGE_TIMEOUT_MS = 15000;

/**
 * The words a shopper sees when they cannot buy something.
 *
 * Ordered, because the first match wins and the more specific reason is the more
 * useful one. All lowercase; the page text is lowercased before matching.
 */
// prettier-ignore
export const PAGE_PHRASES = [
  ['expired',     ['offer expired', 'deal expired', 'this offer has ended', 'offer has ended', 'sale ended']],
  ['sold-out',    ['sold out', 'out of stock', 'currently out of stock', 'stock out']],
  ['unavailable', ['currently unavailable', 'no longer available', 'not available', 'item is unavailable',
                   'page not found', 'sorry, we could not find', 'looking for something',
                   'we don\'t know when or if this item will be back in stock',
                   'this product is not available', 'temporarily unavailable']],
];

/** A page shorter than this did not really load, whatever it answered. */
const TOO_SHORT_TO_BE_A_PAGE = 500;

function text(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * What one page came back as.
 *
 * `status` is what the shop's own server answered; 0 means nothing answered.
 * `html` is what came back.
 */
export function readPageOutcome(html, status) {
  const body = text(html);
  const code = Number.isFinite(status) ? Number(status) : 0;

  // Nothing answered, or the shop said no. Either way a shopper sees nothing.
  if (code === 0) {
    return { state: 'could-not-open', evidence: 'Nothing came back from the shop.' };
  }
  if (code === 404 || code === 410) {
    return { state: 'unavailable', evidence: `The shop answered ${code}.` };
  }
  if (code >= 500) {
    // The shop is having a bad moment. That is about them, not the offer, so it
    // must not grey anything out.
    return { state: 'could-not-open', evidence: `The shop answered ${code}.` };
  }
  if (code >= 400) {
    return { state: 'could-not-open', evidence: `The shop answered ${code}.` };
  }
  if (body.length < TOO_SHORT_TO_BE_A_PAGE) {
    return {
      state: 'could-not-open',
      evidence: 'The page came back almost empty, so it did not really load.',
    };
  }

  const lower = body.toLowerCase();
  for (const [state, phrases] of PAGE_PHRASES) {
    for (const phrase of phrases) {
      if (lower.includes(phrase)) {
        return { state, evidence: `The page says "${phrase}".` };
      }
    }
  }
  return { state: 'opened', evidence: null };
}

/**
 * Split the morning's list into what can be looked at and what cannot.
 *
 * An offer with no shop page saved is not a failure and not a pass. It is
 * "no-link", reported as such, because most of the catalogue is in that state and
 * a screen that quietly left them out would look like a clean run.
 */
export function splitByWhetherThereIsAPage(offers) {
  const list = Array.isArray(offers) ? offers : [];
  const toOpen = [];
  const noPage = [];
  for (const raw of list) {
    const offer = raw && typeof raw === 'object' ? raw : {};
    const url = text(offer.productUrl).trim();
    const known = !!PLATFORMS[String(offer.platform || '').toLowerCase()];
    if (url === '' || !/^https?:\/\//i.test(url) || !known) {
      noPage.push({
        campaignId: text(offer.campaignId),
        state: 'no-link',
        evidence: url === ''
          ? 'This offer has no shop page saved.'
          : !known
            ? 'Fayr does not know how to open this shop.'
            : 'The saved shop page is not a web address.',
      });
    } else {
      toOpen.push({ ...offer, productUrl: url });
    }
  }
  return { toOpen, noPage };
}

/**
 * The script that opens one page, from inside the WebView the person is already
 * signed in to.
 *
 * The same shape as every script in platforms.js: it ends by posting one JSON
 * string back through window.ReactNativeWebView.postMessage, and it posts exactly
 * once whatever happens. It reads the page and nothing else — no clicking, no
 * form, no second request.
 */
export function buildPageScript(url) {
  const safeUrl = JSON.stringify(String(url));
  return `
(function(){
  var sent = false;
  function send(o){
    if (sent) return; sent = true;
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){}
  }
  var done = setTimeout(function(){ send({ ok:false, status:0, html:'', error:'timed out' }); }, ${PAGE_TIMEOUT_MS});
  try {
    fetch(${safeUrl}, { credentials: 'include', redirect: 'follow' })
      .then(function(r){ return r.text().then(function(t){ return { status: r.status, html: t }; }); })
      .then(function(p){ clearTimeout(done); send({ ok:true, status:p.status, html:p.html }); })
      .catch(function(e){ clearTimeout(done); send({ ok:false, status:0, html:'', error:String((e&&e.message)||e) }); });
  } catch(e){ clearTimeout(done); send({ ok:false, status:0, html:'', error:String((e&&e.message)||e) }); }
})();
true;`;
}

/** The whole run, as something a screen can show and a person can read. */
export function summariseRun(results) {
  const list = Array.isArray(results) ? results : [];
  const counts = {};
  for (const state of LIVE_STATES) counts[state] = 0;
  for (const r of list) {
    const state = r && LIVE_STATES.includes(r.state) ? r.state : null;
    if (state) counts[state] += 1;
  }
  const problems = counts.expired + counts['sold-out'] + counts.unavailable;
  return {
    checked: list.length,
    counts,
    problems,
    // Said out loud, because it is the honest headline: most offers carry no page.
    couldNotLook: counts['could-not-open'] + counts['no-link'],
  };
}

// ── the greyed-out card ─────────────────────────────────────────────────────

/**
 * What the offer feed does with an offer.
 *
 * The decision itself is the SERVER'S: it is the only place that can see the
 * places left and the last look at the shop page together, and two answers to one
 * question is how a card and the claim gate come to disagree. This turns that one
 * answer into what the card does.
 *
 * An offer that cannot be used is GREYED OUT AND STILL THERE. It never disappears:
 * somebody who saw it yesterday and comes back looking for it has to find it, with
 * a reason, or they conclude the app lost it.
 */
export function cardState(campaign, theyHoldASeat) {
  const c = campaign && typeof campaign === 'object' ? campaign : {};
  const a = c.availability && typeof c.availability === 'object' ? c.availability : null;
  // ── A FULL OFFER IS NOT GREYED OUT TO SOMEBODY SITTING IN ONE OF ITS
  //    SEATS — 21 SEPTEMBER 2026 ────────────────────────────────────────────
  //
  // The owner made a one-slot offer, claimed it, went to Zepto, and his payment
  // failed. Back on his home screen the offer was greyed out and unusable, so
  // he could not walk back in and try again. His claim was still live with over
  // an hour to pay, and he found it only through My Products.
  //
  // THE SERVER IS NOT WRONG AND IS NOT CHANGED. offerAvailability greys an offer
  // whose seats are gone, and that is the right answer ABOUT THE OFFER — it is
  // the first rule in that function and its comment says why: "Places first: it
  // is the more certain of the two, and it is ours to know." What the server
  // cannot know from a campaign row is whether the person reading it is the one
  // holding the seat. That fact lives here, so the correction lives here.
  //
  // AND ONLY THE SEATS REASON IS OVERRIDDEN. `reason` is the server's own word
  // for why it greyed the card. A dead shop page — reason 'page' — stays greyed
  // for everybody, claim or no claim, because a seat does not fix a page that
  // will not open. Overriding on greyedOut alone would have thrown that away.
  const seatsOnly = a != null && a.reason === 'seats' && theyHoldASeat === true;
  const greyed = a ? a.greyedOut === true && !seatsOnly : false;
  const label = a && typeof a.label === 'string' && a.label.trim() !== '' ? a.label : null;
  return {
    greyedOut: greyed,
    // Only ever the server's words. Never a label this file invented.
    label: greyed ? label : null,
    canClaim: !greyed,
    cta: greyed ? 'Not right now' : null,
  };
}
