import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
  ScrollView, Platform, Linking, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { extractItems } from './extract';
import { restoreSession, persistSession, logoutPlatform } from './session';
import { DEBUG_CAPTURE } from './config';
import { readEvidence } from './taskflow';
import { dispatch } from './taskStore';
// Design tokens only. This screen's LOGIC and every WebView prop are unchanged —
// the restyle (2026-08-10) is confined to the chrome around the page: the hint
// bar, the fetch button, the results header/cards/errors. See the notes on the
// WebView itself for the props that must not be touched.
import { COLOR, FONT, RADIUS, SPACE, SHADOW } from './ui/theme';
import { MarketplaceTag } from './ui/primitives';
// THE GATE OVER THE SHOP'S PAGE, added because the shop's own home page, its
// captcha and the web view library's own untranslated "Error loading page" were
// all reaching a person who had tapped "connect my account". Every decision about
// what is on screen is in src/connect/gate.js, which is pure and checked under
// node, including the failures a phone cannot be made to do on demand.
import {
  ASK_THE_SHOP_AGAIN, FAILED, OPENING_UP, SHOP_HAS_THIS_LONG_MS, SIGNED_IN_SHOWS_FOR_MS,
  THEY_SAY_THEY_ARE_IN, isForTheGate, isTheShopsOwnSignInPage, pathOf,
  shopMayBeSeen, shopViewKey, shopViewMayExist, shouldActOnFailure, whatDecidedIt,
  whatIsOnScreen, whatTheShopSaid, whatWeSay,
} from './connect/gate';
// TEMPORARY, AND IT COMES OUT WHEN THE OWNER SAYS TEST 3 PASSES. Development only:
// every one of these is a no-op in a build a person gets. See connect/gateLog.js.
import { describeFailure, logGate, whyInWords } from './connect/gateLog';
import { watchSignInScript } from './connect/watchSignIn';
import { rememberAccountName } from './connect/accountName';
import { reportShopSignIn } from './backend/shopApi';

/**
 * HOW WE KNEW, in the words that go on the row our side keeps.
 *
 * TWO WAYS AND THEY ARE NOT THE SAME FACT. One is the shop's own page showing us,
 * which is the strong one. The other is somebody's word, given because the shop's
 * page said nothing either way, which is true of Flipkart's and Blinkit's own home
 * pages and was measured on 6 September 2026. The row carries which, so a count
 * built on it can never quietly turn one into the other.
 *
 * They are not shown to anybody, so they do not live in gateWords.js with the
 * sentences a person reads.
 */
const SAW_IT = 'the shop greeted them by name, or showed its own sign out';
const THEY_SAID_SO = 'the person said so after the shop stopped showing a sign in';

// Platforms whose fetch payload feeds the task flow. Amazon reads a review's
// order (HTML scrape); Flipkart/Myntra are order-first (their JSON order API),
// so a purchase advances the task before any review exists. Zepto/Blinkit/
// Instamart are also order-first: they parse the order list the discovery hook
// captured, and readEvidence matches the campaign product by name+amount on-
// device (see taskflow.js). Meesho stays in discovery mode (no reliable schema).
const READER_PLATFORMS = {
  amazon: true, flipkart: true, myntra: true,
  zepto: true, blinkit: true, instamart: true,
};

// Marketplaces whose OWN in-page logout is broken or missing in the WebView, so
// Fayr shows its own "Log out" button. The rest (Amazon/Flipkart/Myntra/Meesho/
// Blinkit) have a working logout in their account menu, so we don't add one there.
const LOGOUT_PLATFORMS = { zepto: true, instamart: true };

function fmt(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Given a target product (what the review task is for), decide whether a
// fetched item is that product. In the real app this string comes from the
// task; here it's typed in. Quick-commerce has no order-confirmation email to
// key off, so we match on the product name: substring first, then a
// majority-of-tokens overlap so minor wording differences still match.
function productMatches(item, target) {
  const t = (target || '').trim().toLowerCase();
  if (!t) return true;
  const hay = `${item.product || ''} ${item.title || ''}`.toLowerCase();
  if (hay.includes(t)) return true;
  const toks = t.split(/\s+/).filter((w) => w.length > 2);
  if (!toks.length) return false;
  const hits = toks.filter((w) => hay.includes(w)).length;
  return hits / toks.length >= 0.6;
}

function Stars({ rating }) {
  if (rating == null) return null;
  const full = Math.round(rating);
  return (
    <Text style={styles.stars}>
      {'★'.repeat(Math.max(0, Math.min(5, full)))}
      {'☆'.repeat(Math.max(0, 5 - full))} <Text style={styles.ratingNum}>{rating}</Text>
    </Text>
  );
}

// Exactly the fields requested: Product Name, Rating, Review Title, Review Text,
// Review Date, Order ID, Product URL, Marketplace Name. Delivery/return timeline
// and approval/publish-status data are still computed (see extract.js) and
// visible via "Show raw JSON" - just not on this card, to keep it to what was
// asked for.
function ReviewCard({ item, color, platform }) {
  const reviewDate = fmt(item.reviewDate) || item.date || null;
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <MarketplaceTag marketplace={platform.key} />
      {(item.product || item.title) ? (
        <Text style={styles.product} numberOfLines={2}>{item.product || item.title}</Text>
      ) : null}
      {item.rating != null ? (
        <Stars rating={item.rating} />
      ) : item.approved === true ? (
        // Rated, but this marketplace's web doesn't expose the star count.
        <Text style={styles.ratedBadge}>✓ Rated{' '}<Text style={styles.ratedBadgeSub}>(star not shown on web)</Text></Text>
      ) : /not_rated|rating_not_found/i.test(item.reviewStatus || '') ? (
        <Text style={styles.notRatedBadge}>Not rated yet</Text>
      ) : null}
      {item.product && item.title ? <Text style={styles.reviewTitle}>{item.title}</Text> : null}
      {item.text ? <Text style={styles.reviewText}>{item.text}</Text> : null}
      {item.mediaCount ? (
        <Text style={styles.mediaNote}>📷 {item.mediaCount} photo/video in review (public on product page)</Text>
      ) : item.approved === true && item.text ? (
        <Text style={styles.mediaNoteMuted}>No photos/videos — review may not show publicly</Text>
      ) : null}
      <View style={styles.metaRow}>
        {reviewDate ? <Text style={styles.metaText}>Reviewed: {reviewDate}</Text> : null}
        {item.orderId ? <Text style={styles.metaText}>Order ID: {item.orderId}</Text> : null}
      </View>
      {item.productUrl ? (
        <TouchableOpacity onPress={() => Linking.openURL(item.productUrl)}>
          <Text style={styles.productUrl} numberOfLines={1}>{item.productUrl}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Meesho has no confirmed API schema yet (see platforms.js) - card-parsing
// generic embedded state produces false positives (public catalog ratings,
// unrelated app state), so default to the raw view instead of pretending the
// cards are reliable. (Zepto/Blinkit/Instamart now have real parsers.)
const DISCOVERY_PLATFORMS = ['meesho'];

// `campaign` carries the task's product: { asin }. Without it a fetch cannot
// know which product it is allowed to surface, so it fails closed rather than
// returning every order on the account (see platforms.js). Nothing passes a
// campaign yet - that arrives with the campaign model.
export default function ConnectScreen({ platform, campaign, navigation, route }) {
  const webRef = useRef(null);
  const [mode, setMode] = useState('web'); // 'web' | 'results'
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [target, setTarget] = useState(''); // the product the review task is for
  // DEV-ONLY: bypass the campaign filter for the next fetch. Starts OFF, so the
  // filtered production path is always the default. Inert unless DEV_TOOLS.
  const [devShowAll, setDevShowAll] = useState(false);
  // ── THE GATE, and it only ever runs on a visit made to sign in ────────────
  //
  // `toSignIn` is the one word the screen that sends somebody here says (see
  // src/signin.js). A visit made to READ somebody's own orders is not gated at
  // all: that path works today and covering its page would break it.
  const toSignIn = !!(route && route.params && route.params.toSignIn);
  // Four things and no fifth: opening, shop, failed, signedIn. See gate.js.
  const [signInIsUp, setSignInIsUp] = useState(false);
  // THE SIGN IN WAS THERE AND IS NOT ANY MORE, and the shop is not saying whether
  // it worked. Our own screen goes back over the shop and asks. See gate.js.
  const [signInIsGone, setSignInIsGone] = useState(false);
  const [theyAreIn, setTheyAreIn] = useState(false);
  // HOW WE KNEW, in the words that go on the row our side writes. Two ways in, and
  // they are not the same fact: the shop showed us, or the person told us.
  const [howWeKnew, setHowWeKnew] = useState(SAW_IT);
  const [itWillNotOpen, setItWillNotOpen] = useState(false);
  // HOW MANY TIMES THE SHOP HAS BEEN ASKED. It is the web view's key, so counting
  // it up throws the old view away and builds a new one. See shopViewKey.
  const [attempt, setAttempt] = useState(0);
  // THE ATTEMPT ON SCREEN RIGHT NOW, AS A REF, and the failure handlers read this
  // one and never the state.
  //
  // WHY NOT A DEPENDENCY LIST. That is what failed on 5 September: a handler built
  // by useCallback holds whatever its dependencies were when it was built, and the
  // web view underneath is holding the handler from the render that built IT. The
  // count has to be readable as it is NOW, from a handler that may be older than
  // it, and a ref is the only thing that is.
  //
  // SET IN TWO PLACES ON PURPOSE. The effect is what keeps it honest - it can
  // never drift from the state, whatever else changes it. tryAgain also sets it
  // by hand, before it sets any state at all, because an effect does not run
  // until after the screen has been drawn and a dying view can speak inside that
  // gap. Belt and braces, and the braces are the ones that close the gap.
  const attemptNow = useRef(0);
  useEffect(() => { attemptNow.current = attempt; }, [attempt]);
  // HAS THE SIGN IN BEEN ON SCREEN AT ANY POINT IN THIS ATTEMPT? Ours to remember,
  // because the script inside the shop's page cannot: a shop that reloads the whole
  // page on signing in hands it a new life with no memory of the page before. A
  // ref and not state, because nothing on screen depends on it and it must be
  // right the instant a message arrives rather than after the next draw.
  const signInWasUp = useRef(false);
  // AND THE FAILURE ITSELF, kept as a ref as well as state. The state is what the
  // screen is drawn from; this is what the save handler reads, because the two run
  // in one batch for the same failed load and a state set in one is not yet
  // visible in the other. See onLoadEnd.
  const itWillNotOpenNow = useRef(false);
  // WHEN THE SHOP WAS ASKED TO OPEN. Held in state and not a ref, because the
  // clock below has to be able to make the screen draw again.
  const [askedAt, setAskedAt] = useState(() => Date.now());
  const [nowIs, setNowIs] = useState(() => Date.now());

  // THE ONE CLOCK THAT MAKES THE WAIT REAL. Without it a shop that never answers
  // leaves the loading screen up for ever, because nothing would ever ask again
  // whether the fifteen seconds had passed.
  useEffect(() => {
    if (!toSignIn) return undefined;
    if (signInIsUp || signInIsGone || theyAreIn || itWillNotOpen) return undefined;
    const t = setTimeout(() => setNowIs(Date.now()), SHOP_HAS_THIS_LONG_MS + 50);
    return () => clearTimeout(t);
    // `attempt` IS IN HERE AND IT HAS TO BE. Two taps of Try again inside the same
    // millisecond leave askedAt unchanged, React sees no new value and skips the
    // render, and the second attempt would then get no wait of its own at all.
    // The count always changes.
  }, [toSignIn, askedAt, attempt, signInIsUp, signInIsGone, theyAreIn, itWillNotOpen]);

  const gate = toSignIn
    ? whatIsOnScreen({
      signInIsUp, signInIsGone, theyAreIn, itWillNotOpen, startedAt: askedAt, now: nowIs,
    })
    : null;

  // EVERY CHANGE OF THE GATE, AND WHICH ONE OF THE FIVE INPUTS DID IT.
  //
  // IN AN EFFECT AND NOT IN THE DRAWING. A render can run more than once for the
  // same state, and a line written during one would say a change had happened
  // when nothing had. This runs after the screen is really drawn, and only when
  // the answer is different from the last one it saw.
  //
  // THE REASON IS THE POINT. "failed" arrives by two roads - the shop saying so,
  // and our own fifteen seconds running out - and they put the identical sentence
  // on screen. whatDecidedIt names which, from the same ordered questions
  // whatIsOnScreen itself is built on, so the two can never disagree.
  const gateWas = useRef(null);
  useEffect(() => {
    if (!toSignIn) return;
    if (gate === gateWas.current) return;
    const why = whatDecidedIt({
      signInIsUp, signInIsGone, theyAreIn, itWillNotOpen, startedAt: askedAt, now: nowIs,
    });
    logGate(attempt, 'GATE',
      `${gateWas.current == null ? '(first)' : gateWas.current} -> ${gate}  because ${why}`
      + `  [signInIsUp=${signInIsUp} signInIsGone=${signInIsGone} theyAreIn=${theyAreIn}`
      + ` itWillNotOpen=${itWillNotOpen} waited=${nowIs - askedAt}ms of ${SHOP_HAS_THIS_LONG_MS}]`);
    gateWas.current = gate;
  }, [gate, attempt, toSignIn, signInIsUp, signInIsGone, theyAreIn, itWillNotOpen, askedAt, nowIs]);

  /**
   * ASK THE SHOP AGAIN, FROM NOTHING.
   *
   * IT USED TO CALL RELOAD AND THAT DID NOTHING AT ALL. The owner found it on a
   * real phone on 5 September 2026: airplane mode on, tap connect, get the
   * failure, airplane mode off, tap Try again, and the failure screen just sat
   * there however many times he tapped it. A web view whose load FAILED is holding
   * no page, so there is nothing committed for reload to fetch again; it returns
   * having done nothing and the failure it is still holding is reported straight
   * back.
   *
   * SO THE VIEW IS THROWN AWAY AND A NEW ONE IS BUILT. Counting `attempt` up
   * changes the web view's key, and a changed key is a new view: a new request to
   * the shop, a new page, a new watcher, and a new fifteen seconds counted from
   * this moment. Three taps in a row are three new views.
   */
  const tryAgain = useCallback(() => {
    // THE FIRST STATEMENT IN HERE, BEFORE ANY STATE IS SET, and the owner asked for
    // it in exactly that place. If this line is missing from the window then the
    // tap never arrived, and no amount of reasoning about what happens afterwards
    // is worth anything. It is the one line that tells candidate C apart from the
    // other two.
    const next = attemptNow.current + 1;
    logGate(attemptNow.current, 'TRY AGAIN TAPPED', `asking the shop again, next attempt=${next}`);
    // BY HAND AND NOW, not in the effect: see attemptNow above.
    attemptNow.current = next;
    setSignInIsUp(false);
    setSignInIsGone(false);
    setTheyAreIn(false);
    setItWillNotOpen(false);
    itWillNotOpenNow.current = false;
    const at = Date.now();
    setAskedAt(at);
    setNowIs(at);
    // THE COUNT ITSELF STILL COMES FROM REACT'S OWN VALUE and not from the ref, so
    // the state is never derived from a copy of itself. The ref above is a mirror
    // for the handlers to read; this is the thing it mirrors. They cannot disagree,
    // because both add one to the same number.
    setAttempt((n) => n + 1);
    // A NEW VIEW IS A NEW ATTEMPT, so what the last one saw is forgotten too.
    signInWasUp.current = false;
  }, []);

  /**
   * THEY SAID SO THEMSELVES, because Fayr could not see it.
   *
   * The one control that exists for the shops whose own pages say nothing either
   * way. It is somebody's word and it is written down as somebody's word: the row
   * our side keeps carries the reason, and this reason is not the same fact as the
   * shop having shown us its own sign out.
   */
  const theySayTheyAreIn = useCallback(() => {
    logGate(attemptNow.current, 'THEY SAID THEY ARE IN', 'the person answered our own question');
    setHowWeKnew(THEY_SAID_SO);
    setTheyAreIn(true);
  }, []);

  // Restore any saved login cookies BEFORE the WebView creates its store, so a
  // returning user is already signed in. Persist again when leaving.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    let alive = true;
    restoreSession(platform.key, platform.startUrl).finally(() => {
      if (alive) setSessionReady(true);
    });
    return () => {
      alive = false;
      persistSession(platform.key, platform.startUrl);
    };
  }, [platform]);

  // onLoadEnd alone is not enough: an SPA login (Flipkart) authenticates
  // without a full page load, so the only snapshot ever written was the
  // PRE-login one. Also save on navigation changes, which SPA routing does
  // emit. Debounced because a single navigation can fire this several times
  // and each call writes to the Keychain.
  const lastSaveRef = useRef(0);
  const saveSession = useCallback(() => {
    const now = Date.now();
    if (now - lastSaveRef.current < 1500) return;
    lastSaveRef.current = now;
    persistSession(platform.key, platform.startUrl);
  }, [platform]);

  // The URL the WebView is actually on. Marketplaces redirect (Zepto's
  // zepto.com -> zeptonow.com, Swiggy's subdomains), and the AUTH cookies live on
  // the redirected domain - which a start-URL-only clear never sees. Logout uses
  // this so it clears the real domain.
  const currentUrlRef = useRef(platform.startUrl);
  const onNav = useCallback((navState) => {
    if (navState && navState.url) currentUrlRef.current = navState.url;
    // ── THE COVER GOES STRAIGHT BACK ON WHEN THE SHOP LEAVES ITS SIGN IN ────
    //
    // THE OWNER SAW THIS ON A REAL PHONE: he signed in to Amazon and Amazon's home
    // page was on screen for a split second before Fayr came back. The cover came
    // off correctly when the sign in appeared, and then only the watcher's next
    // look could put it back. This is faster than any look, because the screen is
    // told about a navigation the moment it happens.
    //
    // AND THE MULTI STEP SIGN IN CANNOT MAKE IT FLASH. Amazon asks for the number
    // on one page and the code or the password on the next, and BOTH are its own
    // sign in pages, so the cover must not come back on between them. It does not,
    // because isTheShopsOwnSignInPage matches Amazon's whole authentication portal
    // and not only its first page: every step of an Amazon sign in is under /ap/,
    // which was opened and read in a real browser on 6 September 2026 rather than
    // assumed. The one question lives in gate.js and the watcher and the tap script
    // read the same pattern, so the three cannot disagree about it.
    if (toSignIn && signInIsUp && navState && typeof navState.url === 'string') {
      const path = pathOf(navState.url);
      if (path != null && !isTheShopsOwnSignInPage(path)) {
        setSignInIsUp(false);
        // AND THE WAIT STARTS AGAIN FROM HERE. Signing in takes a person longer
        // than fifteen seconds, so by now the first fifteen are long gone. Without
        // this the very next page they land on would be given no time at all and
        // "the shop did not open" would land on a shop that had just opened.
        //
        // ONLY ON THE ONE MOMENT THE COVER GOES BACK ON, and never on an ordinary
        // navigation, because a shop that keeps moving would otherwise push the
        // deadline out for ever and never time out at all.
        const at = Date.now();
        setAskedAt(at);
        setNowIs(at);
      }
    }
    saveSession();
  }, [saveSession, toSignIn, signInIsUp]);
  const onLoadEnd = useCallback((e) => {
    const u = e && e.nativeEvent && e.nativeEvent.url;
    logGate(attemptNow.current, 'LOAD ENDED', `url=${u || '?'}`);
    if (u) currentUrlRef.current = u;
    // A FAILED LOAD MUST NOT SAVE A SIGNED OUT SNAPSHOT OVER A GOOD ONE.
    //
    // The web view library calls this on an ERROR as well as on a real load, so a
    // shop that would not open was writing an empty snapshot on top of the saved
    // sign in every single time. Somebody whose network dropped once came back to
    // a shop they were no longer signed in to, and nothing said why.
    //
    // Only skipped once we KNOW it failed, so the ordinary path is untouched.
    //
    // A REF AND NOT THE STATE, and the state was a race. The library calls the
    // failure handler and this one for the SAME failed load, and a state set in
    // the first is not visible to the second: they run in one batch, so this read
    // the value from before the failure, decided nothing had gone wrong, and wrote
    // the empty snapshot anyway. The ref is set the instant the failure arrives.
    if (itWillNotOpenNow.current) return;
    saveSession();
  }, [saveSession]);

  /**
   * THE SHOP SAID IT COULD NOT OPEN.
   *
   * The web view library calls this for a network failure and, separately, for a
   * page the shop answered with an error. Before today NEITHER was handled, so
   * the person was left looking at the library's own untranslated panel: "Error
   * loading page / Domain: NSURLErrorDomain / Error Code: -1009", with Fayr's
   * own hint bar above it still telling them to log in.
   *
   * IT ONLY EVER MEANS ANYTHING ON A SIGN IN VISIT. A reading visit is not gated,
   * and its own error handling is unchanged.
   */
  const shopWillNotOpen = useCallback((fromAttempt, which, event) => {
    const native = (event && event.nativeEvent) || null;
    const said = describeFailure(which, native);
    // WHETHER TO ACT IS NOT DECIDED HERE. It is decided by shouldActOnFailure in
    // connect/gate.js, which is pure, takes the stamp the view was built with, and
    // hands back its own reason - so every combination of these six facts can be
    // checked under node, including the dying view's last word, which no phone can
    // be made to produce on demand.
    const { act, why } = shouldActOnFailure({
      toSignIn,
      fromAttempt,
      attemptNow: attemptNow.current,
      theyAreIn,
      signInIsUp,
      signInIsGone,
    });
    if (!act) {
      logGate(attemptNow.current, 'SHOP WILL NOT OPEN — IGNORED',
        `because ${whyInWords(why)} (${why}), event stamped attempt=${fromAttempt}, ${said}`);
      return;
    }
    logGate(attemptNow.current, 'SHOP WILL NOT OPEN — ACTED ON', said);
    itWillNotOpenNow.current = true;
    setItWillNotOpen(true);
  }, [toSignIn, theyAreIn, signInIsUp, signInIsGone]);

  // When a target product is set, show only its review(s) - this is the
  // "fetch only the correct product" behaviour the background flow needs.
  const visibleItems = useMemo(
    () => items.filter((it) => productMatches(it, target)),
    [items, target]
  );

  // Cap the raw dump: React Native can fail to paint (blank/black) a single
  // <Text> holding megabytes. Show the first slice and point at "Download JSON"
  // for the rest.
  const rawText = useMemo(() => {
    if (raw == null) return '';
    const s = JSON.stringify(raw, null, 2) || '';
    const LIMIT = 200000;
    return s.length > LIMIT
      ? `${s.slice(0, LIMIT)}\n\n…(truncated ${s.length - LIMIT} more chars — use “Download JSON” for the full file)`
      : s;
  }, [raw]);

  const onMessage = useCallback((event) => {
    let msg;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch (e) {
      setBusy(false);
      setError('Could not parse response from page.');
      setMode('results');
      return;
    }

    // ── THE GATE'S OWN MESSAGES, BEFORE ANYTHING ELSE LOOKS AT THEM ─────────
    //
    // THIS EARLY EXIT IS THE ONE src/connect/accountName.js HAS BEEN ASKING FOR
    // IN WRITING since the day the connected card was built. Without it a message
    // carrying a sign in signal falls into the reader's own handler below, which
    // treats anything without `ok` as a failed read, and the person is shown the
    // words "Fetch failed" on a screen where nothing has failed.
    //
    // AND setBusy IS NOT TOUCHED HERE. It belongs to the reader's Fetch button,
    // and a gate message is not an answer to a fetch. Clearing it would let a
    // shop's page unstick that button by saying something we did not ask for.
    if (isForTheGate(msg)) {
      // RAW, AND BEFORE ANYTHING IS DECIDED ABOUT IT. What the page really sent,
      // not our reading of it: if the reading is the thing that is wrong, a line
      // showing only the reading cannot tell anybody that.
      logGate(attemptNow.current, 'PAGE SAID', event.nativeEvent.data);
      const said = whatTheShopSaid(msg, signInWasUp.current);
      if (said == null) {
        logGate(attemptNow.current, 'PAGE SAID — NO SIGNAL IN IT',
          `weSawASignIn=${signInWasUp.current}`);
        return;
      }
      logGate(attemptNow.current, 'PAGE SAID — READ AS',
        `signInIsUp=${said.signInIsUp} theyAreIn=${said.theyAreIn} signInIsGone=${said.signInIsGone}`);
      // FROM WHAT THE PAGE REALLY SAID, never a flat true. Being in and having a
      // sign in on screen are different things, and the cover must stay on for a
      // page that is neither.
      if (said.signInIsUp) { signInWasUp.current = true; setSignInIsUp(true); setSignInIsGone(false); }
      // THE SIGN IN HAS GONE AND THE SHOP WILL NOT SAY WHETHER IT WORKED. Our own
      // cover goes back over the page and the person is asked, in one sentence.
      // Nothing is claimed and nothing is written down from this on its own.
      if (said.signInIsGone) { setSignInIsUp(false); setSignInIsGone(true); }
      if (said.theyAreIn) {
        setHowWeKnew(SAW_IT);
        setTheyAreIn(true);
        // The name the shop itself printed, when it printed one. Never invented,
        // and the card says the account is connected with no name when there is
        // none. See src/connect/accountName.js.
        if (said.accountName) rememberAccountName(platform.key, said.accountName);
      }
      return;
    }

    setBusy(false);
    // DEV: a session-clear probe reporting what localStorage held (e.g. Myntra
    // urt/uidx) before it was wiped. Not a fetch result - report and stop.
    if (msg && msg.__fayrClear) {
      Alert.alert(
        `localStorage @ ${msg.origin || '?'}`,
        msg.error
          ? `error: ${msg.error}`
          : `${msg.localCount || 0} key(s)${msg.localKeys && msg.localKeys.length ? `:\n${msg.localKeys.join(', ')}` : ''}`
      );
      return;
    }
    if (!msg.ok) {
      setError(msg.error || 'Fetch failed.');
      setRaw(null);
      setItems([]);
      setMode('results');
      return;
    }
    setError(null);
    // A successful fetch proves the WebView was authenticated, making this the
    // most reliable moment to capture the logged-in cookies. Bypass the
    // debounce - this snapshot matters more than any navigation one.
    persistSession(platform.key, platform.startUrl);

    // Feed the task flow. readEvidence (per platform) decides what the payload
    // actually proves - including that it proves nothing (signin redirect,
    // unreadable order, not-purchased-yet) - and transition() decides whether
    // that advances the task. Neither is this screen's business, which is why
    // nothing is interpreted here. Amazon is review-anchored (HTML scrape);
    // Flipkart/Myntra are order-first (their JSON order API), so a purchase
    // advances the task before any review exists.
    if (campaign && READER_PLATFORMS[platform.key]) {
      try {
        const evidence = readEvidence(platform.key, msg.raw, {
          asin: campaign.asin || null,
          pid: campaign.pid || null,
          styleId: campaign.styleId || null,
          product: campaign.productName || null,
          amount: campaign.amount != null ? campaign.amount : null,
          reviewId: campaign.reviewId || null,
        });
        dispatch(campaign.id, {
          type: 'EVIDENCE',
          // Keyed by what the evidence IS, so re-tapping Fetch on an unchanged
          // order is a no-op rather than another history entry.
          key: `evidence:${evidence.order ? evidence.order.id : evidence.blocker || 'none'}`,
          evidence,
          at: Date.now(),
        });
        // Return to the task once the evidence has landed. The task screen is
        // where the outcome lives - state, gaps, refund - so dropping the user
        // on a raw results list makes a successful fetch look like a dead end.
        // Navigate AFTER dispatch so the screen renders the new state, not the
        // old one.
        if (navigation && typeof navigation.navigate === 'function') {
          navigation.navigate('Task', { campaignId: campaign.id });
        }
      } catch (e) {
        /* the raw view below still works; the task simply doesn't advance */
      }
    }
    setRaw(msg.raw);
    try {
      setItems(extractItems(msg.raw));
    } catch (e) {
      setItems([]);
    }
    // Never auto-open the dark raw viewer: a multi-MB Meesho payload in a single
    // <Text> node paints as a blank near-black screen. Default to the (light)
    // cards view; the user can still toggle "Show raw JSON" on demand.
    setShowRaw(false);
    setMode('results');
  }, [platform, campaign, navigation]);

  const fetchReviews = useCallback(() => {
    setBusy(true);
    setError(null);
    // The campaign's ASIN and the debug flag are injected in the SAME script as
    // the fetch, not as a separate call, so the fetch can never run against a
    // stale or unset target. Both fail closed: with no campaign ASIN and no
    // debug opt-in the script returns error:"no_campaign_target" rather than
    // surfacing every order the account has (see platforms.js).
    // The unfiltered path is opened ONLY by: the committed DEBUG_CAPTURE flag,
    // or the dev toggle - and the dev toggle is itself gated on DEV_TOOLS, which
    // is a literal false in production. So in a shipped build this expression can
    // only ever be `DEBUG_CAPTURE === true` (default false); the campaign filter
    // stays the default and the production path is untouched by any of this.
    // eslint-disable-next-line no-undef
    const unfiltered = DEBUG_CAPTURE === true || (__DEV__ && devShowAll);
    // A Fayr campaign has no marketplace product id (the user searches and buys
    // the product themselves), so Flipkart/Myntra match on NAME + AMOUNT - both
    // are on the campaign page. The id pins (asin/pid/styleId) are injected too
    // but are normally null; they're used only when a prior fetch already
    // discovered the marketplace id, to pin the match exactly. All target-filter
    // fail-closed: with neither a name nor an id, no order is surfaced.
    const preamble =
      `window.__fayrTargetName = ${JSON.stringify((campaign && campaign.productName) || null)};` +
      `window.__fayrTargetAmount = ${JSON.stringify((campaign && campaign.amount != null ? campaign.amount : null))};` +
      `window.__fayrTargetAsin = ${JSON.stringify((campaign && campaign.asin) || null)};` +
      `window.__fayrTargetPid = ${JSON.stringify((campaign && campaign.pid) || null)};` +
      `window.__fayrTargetStyleId = ${JSON.stringify((campaign && campaign.styleId) || null)};` +
      `window.__fayrDebugCapture = ${JSON.stringify(unfiltered === true)};`;
    webRef.current?.injectJavaScript(`${preamble}\n${platform.fetchScript}`);
  }, [platform, campaign, devShowAll]);

  const backToLogin = useCallback(() => {
    setMode('web');
    setShowRaw(false);
  }, []);

  // DEV-ONLY: wipe this marketplace's session so a different account can log in
  // without hunting for the site's logout link. Clears: (1) localStorage /
  // sessionStorage / IndexedDB for the current origin - reporting the keys back
  // first, since some platforms (Myntra urt/uidx) keep auth there too; (2) the
  // WebKit cookies, expiring each on its OWN domain so dotted-parent auth cookies
  // (.flipkart.com / .myntra.com) are actually removed, not just the www host;
  // (3) the persisted Keychain snapshot. Then reloads the logged-out page.
  // Log out of THIS marketplace. Only shown where the marketplace's own logout
  // doesn't work in the WebView (Zepto, Instamart - see LOGOUT_PLATFORMS). Wipes
  // the live page's localStorage (Zepto's Zustand blob, Instamart's
  // swiggy_auth_headers) and expires this platform's cookies on BOTH its start
  // domain and the domain it actually redirected to (currentUrlRef) - which is
  // what the old start-URL-only clear missed. Other marketplaces are untouched.
  const logoutThisPlatform = useCallback(async () => {
    // Block auto-save so nothing re-persists the session we're about to clear.
    lastSaveRef.current = Date.now() + 8000;
    // STEP 1 — cookies. clearAll BOTH stores (awaited) so the dotted-domain auth
    // cookie (.swiggy.com) is actually gone before the page reloads. The earlier
    // targeted clear left it in NSHTTPCookieStorage, which then re-synced into the
    // WebView on reload - which is why "logged out" kept coming back logged in.
    let res = { ok: false };
    try {
      const urls = Array.from(new Set([platform.startUrl, currentUrlRef.current].filter(Boolean)));
      res = await logoutPlatform(platform.key, urls);
    } catch (e) { /* ignore */ }
    // STEP 2 — the page's OWN storage + reload, in ONE script so the wipe
    // provably completes before the reload re-reads it. Swiggy keeps its bearer
    // token in localStorage (auth_headers / user_info / swiggy_user_info) and
    // Zepto keeps a Zustand blob there; a cookie-only clear leaves the page able
    // to re-authenticate. localStorage/sessionStorage are cleared synchronously,
    // THEN we navigate to the start URL - by which point the cookies (step 1) are
    // already gone, so the fresh load has nothing to restore the session from.
    const wipeAndReload = `(function(){
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
      try {
        if (window.indexedDB && indexedDB.databases) {
          indexedDB.databases().then(function(dbs){ (dbs || []).forEach(function(d){ try { indexedDB.deleteDatabase(d.name); } catch (e) {} }); });
        }
      } catch (e) {}
      try { location.replace(${JSON.stringify(platform.startUrl)}); } catch (e) { try { location.reload(); } catch (e2) {} }
      true;
    })();`;
    try { webRef.current?.injectJavaScript(wipeAndReload); } catch (e) { /* ignore */ }
    setMode('web');
    setItems([]); setRaw(null); setError(null);
    Alert.alert(
      res.ok ? `Logged out of ${platform.name}` : 'Could not log out',
      res.ok
        ? 'Signed out on this device — the page reloaded logged out. Log in with a different mobile number.'
        : 'The session could not be fully cleared. Close and reopen the app, then try again.',
    );
  }, [platform]);

  const confirmLogout = useCallback(() => {
    Alert.alert(
      `Log out of ${platform.name}?`,
      'This signs you out on this device so you can log in with a different mobile number.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: () => { logoutThisPlatform(); } },
      ],
    );
  }, [platform, logoutThisPlatform]);

  const downloadRawJson = useCallback(async () => {
    if (!raw) return;
    try {
      const file = new File(Paths.cache, `fayr-${platform.key}-${Date.now()}.json`);
      file.create({ overwrite: true });
      file.write(JSON.stringify(raw, null, 2));
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: `${platform.name} raw JSON`,
        });
      } else {
        Alert.alert('Saved', `File written to ${file.uri}`);
      }
    } catch (e) {
      Alert.alert('Could not export JSON', String((e && e.message) || e));
    }
  }, [raw, platform]);

  // ── WRITTEN DOWN, ONCE, AT THE MOMENT IT HAPPENS ──────────────────────────
  //
  // One row on our side: which person, which shop, when. It is one of the two
  // steps in the whole journey that nothing recorded, so until now Fayr could not
  // tell somebody who never went to the shop from somebody who went and gave up.
  //
  // OUR SIDE REFUSES A SECOND ROW, so this can be safe to call twice and is. The
  // database holds one row per person per shop for ever and keeps the FIRST
  // moment, because the question the row answers is "did they get this far", and
  // a moment that keeps sliding forward cannot answer it.
  //
  // AND IT NEVER BLOCKS THE PERSON. A report that fails is a number missing from
  // a report we read, not a person stuck on a shop's page. So nothing waits on it
  // and nothing is shown about it.
  const toldOurSide = useRef(false);
  useEffect(() => {
    if (!toSignIn || !theyAreIn) return;
    if (toldOurSide.current) return;
    toldOurSide.current = true;
    reportShopSignIn(platform.key, howWeKnew);
  }, [toSignIn, theyAreIn, howWeKnew, platform]);

  // ── AND THEN THE SHOP'S PAGE CLOSES ITSELF ────────────────────────────────
  //
  // Back to the offer they claimed, not to the shop's home page and not to the
  // order list. `signedIn` on the offer screen is what moves the journey on, so
  // the button there says "Buy the product" when they land.
  useEffect(() => {
    if (!toSignIn || !theyAreIn) return undefined;
    const t = setTimeout(() => {
      if (!navigation || typeof navigation.navigate !== 'function') return;
      const campaignId = (route && route.params && route.params.campaignId) || null;
      // The screen that sent them here is the one that knows what to do with a
      // signed in shop, so it is the one they go back to.
      navigation.navigate('linkaccount', { campaignId, marketplace: platform.key, justSignedIn: true });
    }, SIGNED_IN_SHOWS_FOR_MS);
    return () => clearTimeout(t);
  }, [toSignIn, theyAreIn, navigation, route, platform]);

  const ourOwnWords = gate != null && !shopMayBeSeen(gate) ? whatWeSay(gate) : null;
  // EVERY CONTROL THE GATE CAN ASK FOR, AND THE ONE THING EACH DOES. Written as a
  // list rather than as a question in the middle of the drawing, so a control the
  // gate adds later cannot quietly land on the wrong one of these.
  const whatEachControlDoes = {
    [ASK_THE_SHOP_AGAIN]: tryAgain,
    [THEY_SAY_THEY_ARE_IN]: theySayTheyAreIn,
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* The WebView stays MOUNTED even while results show, so returning from
          results doesn't reload the page and drop the logged-in session. It's
          only hidden via display:none. */}
      <View style={[styles.flexOne, mode === 'web' ? null : styles.hidden]}>
          {/* THE HINT BAR IS NOT DRAWN ON A SIGN IN VISIT. It tells somebody to
              "tap Fetch my reviews", which is the reader's instruction and is
              nothing to do with signing in. On a sign in visit the only words on
              screen are the gate's own. */}
          {!toSignIn ? (
            <View style={[styles.hintBar, { backgroundColor: platform.color }]}>
              <Text style={styles.hintText}>{platform.hint}</Text>
            </View>
          ) : null}
          {!sessionReady ? (
            <View style={styles.webLoading}>
              <ActivityIndicator size="large" color={platform.color} />
            </View>
          ) : shopViewMayExist(toSignIn, gate) ? (
          <WebView
            // THE KEY, AND IT IS WHAT MAKES TRY AGAIN WORK AT ALL. A changed key
            // throws this view away and builds a new one, which is the only thing
            // that really asks the shop again: a view whose load failed holds no
            // page, so reload has nothing to fetch and does nothing. It never
            // changes on a reading visit, because the only thing that moves the
            // count is the Try again control, which only the gate ever draws.
            key={shopViewKey(attempt)}
            ref={webRef}
            source={{ uri: platform.startUrl }}
            onMessage={onMessage}
            injectedJavaScriptBeforeContentLoaded={platform.beforeLoadScript}
            // THE WATCHER, and only on a visit made to sign in. It is added AFTER
            // the shop's own script, which is untouched: src/platforms.js keeps
            // all twelve of its injected scripts byte for byte. It asks whether
            // the shop's own sign in is on screen and whether the shop is
            // greeting somebody by name, and it types nothing. See
            // src/connect/watchSignIn.js.
            injectedJavaScript={toSignIn ? watchSignInScript() : undefined}
            // BOTH OF THESE WERE MISSING, and that is why the library's own
            // "Error loading page" panel was what a person saw. The app's two
            // other web view screens have had them all along (LiveCheckScreen,
            // LookingForItScreen); the one somebody actually signs in through is
            // the one that skipped them.
            // THE STAMP, AND IT IS TAKEN FROM THE SAME RENDER THAT BUILT THIS VIEW.
            // `attempt` here is a plain value closed over by these two functions at
            // the moment the view was made, so a view being torn down still hands
            // over the count IT was built with - and shouldActOnFailure compares
            // that against the count on screen now and refuses anything older. A
            // dying view's last word about a network that no longer exists can no
            // longer put the failure back over a shop that is loading perfectly
            // well. See shouldActOnFailure in connect/gate.js.
            onError={(e) => shopWillNotOpen(attempt, 'onError', e)}
            onHttpError={(e) => shopWillNotOpen(attempt, 'onHttpError', e)}
            // LOG ONLY, and it decides nothing. Without it there is no way to tell
            // "the new view never asked the shop anything" from "it asked and the
            // shop never answered", which is the difference between two of the
            // three things this could be.
            onLoadStart={(e) => logGate(attempt, 'LOAD STARTED',
              `url=${(e && e.nativeEvent && e.nativeEvent.url) || '?'}`)}
            originWhitelist={['*']}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            // Persist cache/cookies across launches (iOS WKWebView shared store).
            cacheEnabled
            // Save cookies to the Keychain after each load AND on every
            // navigation change, so an SPA login that never triggers a full
            // page load is still captured (no-op unless the native cookie
            // module is present).
            onLoadEnd={onLoadEnd}
            onNavigationStateChange={onNav}
            javaScriptEnabled
            // Per-platform override first (only Amazon sets one - it needs a
            // desktop UA or amazon.in serves a mobile orders page whose DOM the
            // parser can't read). Everything else keeps the previous behaviour:
            // an Android UA on Android, and WKWebView's default on iOS.
            userAgent={
              platform.userAgent ||
              (Platform.OS === 'android'
                ? 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
                : undefined)
            }
            // Opaque white so the WebView never shows through as a black/blank
            // flash while a heavy SPA (Zepto/Blinkit/Swiggy) is still loading.
            style={{ flex: 1, backgroundColor: '#fff' }}
            // Explicit scroll enable — Fabric (new arch) doesn't always apply the
            // iOS default, and being explicit is harmless if it was already on.
            scrollEnabled
            nestedScrollEnabled
            // containerStyle REPLACES the library default { flex: 1, overflow:
            // 'hidden' }. Both matter: flex:1 sizes the container; overflow:
            // 'hidden' is what makes the page scroll WITHIN it instead of
            // overflowing past its bounds — without it, no platform scrolled.
            containerStyle={{ flex: 1, overflow: 'hidden', backgroundColor: '#fff' }}
            renderLoading={() => (
              <View style={styles.webLoading}>
                <ActivityIndicator size="large" color={platform.color} />
              </View>
            )}
            startInLoadingState
          />
          ) : null}
          {/* FETCH IS NOT ON A SIGN IN VISIT EITHER. The person is here to sign
              in; a button offering to read their reviews is one more thing
              between them and that. */}
          {!toSignIn ? (
            <TouchableOpacity
              style={[styles.fetchBtn, { backgroundColor: platform.color }]}
              onPress={fetchReviews}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.fetchBtnText}>Fetch my reviews</Text>
              )}
            </TouchableOpacity>
          ) : null}
          {/* DEV ONLY. DEV_TOOLS is a literal false in a production build, so
              this whole control is dead-code-eliminated and cannot be reached.
              It only bypasses the campaign filter for the NEXT fetch; the filter
              is still the default (devShowAll starts false). */}
          {/* eslint-disable-next-line no-undef */}
          {/* Real feature (not dev-only): a marketplace-independent logout so a
              user can switch accounts even when the marketplace's own logout is
              broken/absent in the WebView (Instamart, Zepto). */}
          {LOGOUT_PLATFORMS[platform.key] ? (
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={confirmLogout}
              activeOpacity={0.7}
            >
              <Text style={styles.logoutBtnText}>Log out of {platform.name}</Text>
            </TouchableOpacity>
          ) : null}
          {__DEV__ ? (
            <View style={styles.devRow}>
              <TouchableOpacity
                style={[styles.devToggle, devShowAll && styles.devToggleOn]}
                onPress={() => setDevShowAll((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={[styles.devToggleText, devShowAll && styles.devToggleTextOn]}>
                  {devShowAll ? '● ' : '○ '}Show all my reviews (dev){devShowAll ? ' — filter OFF' : ''}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
      </View>
      {/* ── OUR OWN SCREEN, OVER THE SHOP'S ──────────────────────────────────
          Drawn last and absolutely filling the screen, so nothing the shop
          serves can be underneath it and still be seen. It is the shop's home
          page, its captcha, its "install our app" and the web view library's own
          "Error loading page" that this covers, and every one of those reached a
          person before today.

          ONE SENTENCE, and at most one control. Every word comes from
          src/connect/gateWords.js, which our side's own plain language check
          reads from disk. This screen writes none of its own. */}
      {ourOwnWords ? (
        <View style={styles.gate} accessibilityViewIsModal>
          {gate === OPENING_UP ? (
            <ActivityIndicator size="large" color={platform.color} style={styles.gateSpinner} />
          ) : null}
          <Text style={styles.gateText}>{ourOwnWords.sentence}</Text>
          {/* THE CONTROLS, AND WHICH ONE DOES WHAT IS THE GATE'S ANSWER AND NOT
              THIS SCREEN'S. A control is drawn only because whatWeSay put it
              there, and what it does comes from that same answer, so a control
              can never be drawn with nothing behind it or wired to the wrong
              thing. Most of these screens have none; the failure has one; the one
              that asks has two, because the two things that might have happened
              both need a way forward. */}
          {ourOwnWords.controls.map((control, at) => (
            <TouchableOpacity
              key={control.does}
              style={at === 0 ? styles.gateBtn : styles.gateBtnQuiet}
              onPress={whatEachControlDoes[control.does]}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={at === 0 ? styles.gateBtnText : styles.gateBtnQuietText}>
                {control.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {mode === 'results' ? (
        <View style={styles.resultsWrap}>
          <View style={styles.resultsHeader}>
            <TouchableOpacity onPress={backToLogin} style={styles.linkBtn}>
              <Text style={[styles.link, { color: platform.color }]}>‹ Back to {platform.name}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={() => setShowRaw((s) => !s)} style={styles.linkBtn}>
                <Text style={[styles.link, { color: platform.color }]}>
                  {showRaw ? 'Show cards' : 'Show raw JSON'}
                </Text>
              </TouchableOpacity>
              {raw ? (
                <TouchableOpacity onPress={downloadRawJson} style={[styles.linkBtn, { marginLeft: 14 }]}>
                  <Text style={[styles.link, { color: platform.color }]}>Download JSON</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Fetch failed</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorHint}>
                Make sure you are logged in on the previous screen, then try again.
              </Text>
            </View>
          ) : showRaw ? (
            <ScrollView style={styles.rawBox}>
              <Text style={styles.rawText} selectable>
                {rawText}
              </Text>
            </ScrollView>
          ) : (
            <FlatList
              data={visibleItems}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <ReviewCard item={item} color={platform.color} platform={platform} />
              )}
              contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
              ListHeaderComponent={
                <View>
                  <TextInput
                    style={styles.targetInput}
                    value={target}
                    onChangeText={setTarget}
                    placeholder="Target product (leave blank to show all)"
                    placeholderTextColor="#999"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={styles.count}>
                    {target.trim()
                      ? `${visibleItems.length} match${visibleItems.length === 1 ? '' : 'es'} for “${target.trim()}” (of ${items.length} fetched)`
                      : `${items.length} item${items.length === 1 ? '' : 's'} fetched`}
                  </Text>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>
                    {target.trim() ? 'No matching product' : 'Nothing parsed'}
                  </Text>
                  <Text style={styles.errorText}>
                    {target.trim()
                      ? `None of the ${items.length} fetched item(s) matched “${target.trim()}”. Clear the box to see them all.`
                      : 'The response came back but no review/order-shaped data was found. Tap “Show raw JSON” to inspect what was returned.'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOR.homeBg },
  flexOne: { flex: 1 },
  hidden: { display: 'none' },
  // DELIBERATELY still an OPAQUE fill: this overlays the WebView, which stays
  // MOUNTED underneath so returning from results doesn't reload the page and drop
  // the marketplace session. Any transparency would show the page through it.
  // The colour may change; absoluteFill and opacity must not.
  resultsWrap: { ...StyleSheet.absoluteFill, backgroundColor: COLOR.homeBg },
  // Stays WHITE, not cream, and not for consistency's sake: this sits where the
  // page will paint, and a non-white ground shows as a coloured flash before a
  // heavy SPA (Zepto/Blinkit/Swiggy) puts anything up. Matches the WebView's own
  // backgroundColor for exactly that reason.
  webLoading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  // The hint bar keeps `platform.color` as its ground (applied inline). That is a
  // deliberate exception to the fayr palette: the user is standing inside a
  // marketplace's own site, and the brand colour is what tells them which one.
  // Flattening all seven to gold would cost real orientation for no gain.
  // OUR OWN SCREEN OVER THE SHOP'S. Absolutely filling, and opaque, because a
  // gap anywhere in it is the shop's page showing through.
  gateBtnQuiet: {
    marginTop: 10, paddingHorizontal: 22, paddingVertical: 11,
    borderRadius: RADIUS.round, borderWidth: 1, borderColor: '#D9D2C2',
  },
  gateBtnQuietText: {
    fontFamily: FONT.displaySemi, fontSize: 13, color: COLOR.sub,
  },
  gate: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: COLOR.cream,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  gateSpinner: { marginBottom: SPACE.lg },
  gateText: {
    fontFamily: FONT.bodyMed, fontSize: 15.5, lineHeight: 23,
    color: COLOR.ink, textAlign: 'center',
  },
  gateBtn: {
    marginTop: SPACE.xl, paddingVertical: 14, paddingHorizontal: 34,
    borderRadius: RADIUS.round, backgroundColor: COLOR.ink,
  },
  gateBtnText: { fontFamily: FONT.bodySemi, fontSize: 14.5, color: '#fff' },

  hintBar: {
    paddingHorizontal: SPACE.lg, paddingVertical: 11,
    borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg,
  },
  hintText: {
    color: '#fff', fontFamily: FONT.bodySemi, fontSize: 12.5,
    textAlign: 'center', lineHeight: 17,
  },
  fetchBtn: {
    margin: SPACE.lg, borderRadius: RADIUS.md, paddingVertical: 15,
    alignItems: 'center', ...SHADOW.chip,
  },
  fetchBtnText: { color: '#fff', fontFamily: FONT.displaySemi, fontSize: 15.5, letterSpacing: 0.2 },
  logoutBtn: {
    marginHorizontal: SPACE.lg, marginBottom: SPACE.sm, paddingVertical: 12,
    alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: '#F0BDB2', backgroundColor: '#FFF1EE',
  },
  logoutBtnText: { fontFamily: FONT.displaySemi, fontSize: 13, color: '#9E2B18' },

  // dev-only controls (dead-code-eliminated in a production build)
  devRow: { marginTop: SPACE.xs },
  devToggle: { marginTop: SPACE.xs, paddingVertical: SPACE.sm, alignItems: 'center' },
  devToggleOn: { backgroundColor: '#FFF1EE', borderRadius: RADIUS.sm },
  devToggleText: { fontFamily: FONT.bodySemi, fontSize: 12, color: '#9a9b8c' },
  devToggleTextOn: { color: '#9E2B18' },
  devClear: { marginTop: 2, paddingVertical: SPACE.sm, alignItems: 'center' },
  devClearText: {
    fontFamily: FONT.bodySemi, fontSize: 12, color: '#9E2B18',
    textDecorationLine: 'underline',
  },

  // results chrome
  resultsHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md,
    borderBottomWidth: 1, borderBottomColor: COLOR.line, backgroundColor: COLOR.surface,
  },
  linkBtn: { paddingVertical: SPACE.xs },
  link: { fontFamily: FONT.displaySemi, fontSize: 14 },
  count: { fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub, marginBottom: SPACE.sm, marginLeft: 2 },
  targetInput: {
    borderWidth: 1, borderColor: COLOR.line, borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md, paddingVertical: 11, fontFamily: FONT.body,
    fontSize: 14, color: COLOR.ink, backgroundColor: COLOR.surface, marginBottom: SPACE.sm,
  },

  // one fetched item
  card: {
    backgroundColor: COLOR.surface, borderRadius: RADIUS.lg, borderLeftWidth: 4,
    padding: SPACE.md, marginBottom: 10, borderWidth: 1, borderColor: COLOR.line,
    ...SHADOW.chip,
  },
  product: { fontFamily: FONT.displaySemi, fontSize: 14.5, color: COLOR.ink, marginTop: SPACE.xs, lineHeight: 19 },
  stars: { fontFamily: FONT.bodyBold, fontSize: 15, color: COLOR.amber, marginTop: SPACE.xs },
  ratingNum: { fontFamily: FONT.body, fontSize: 12, color: COLOR.sub },
  ratedBadge: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.refundInk, marginTop: SPACE.xs },
  ratedBadgeSub: { fontFamily: FONT.body, fontSize: 11, color: '#9a9b8c' },
  notRatedBadge: { fontFamily: FONT.bodySemi, fontSize: 13, color: '#b0772a', marginTop: SPACE.xs },
  reviewTitle: { fontFamily: FONT.bodySemi, fontSize: 13.5, color: COLOR.ink2, marginTop: SPACE.sm },
  reviewText: { fontFamily: FONT.body, fontSize: 13, color: COLOR.sub, marginTop: SPACE.xs, lineHeight: 18 },
  mediaNote: { fontFamily: FONT.bodySemi, fontSize: 12, color: COLOR.refundInk, marginTop: SPACE.sm },
  mediaNoteMuted: { fontFamily: FONT.body, fontSize: 12, color: '#9a9b8c', marginTop: SPACE.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE.sm, flexWrap: 'wrap' },
  metaText: { fontFamily: FONT.body, fontSize: 12, color: COLOR.sub, marginRight: SPACE.lg },
  productUrl: {
    fontFamily: FONT.body, fontSize: 12, color: COLOR.purple,
    marginTop: SPACE.sm, textDecorationLine: 'underline',
  },

  // Same treatment as TaskScreen's action-error card, so a failure looks the
  // same wherever the user meets one.
  errorBox: {
    margin: SPACE.lg, padding: SPACE.lg, borderRadius: RADIUS.md,
    backgroundColor: '#FFF1EE', borderWidth: 1, borderColor: '#F0BDB2',
  },
  errorTitle: { fontFamily: FONT.displaySemi, fontSize: 14.5, color: '#9E2B18', marginBottom: SPACE.xs },
  errorText: { fontFamily: FONT.body, fontSize: 13, color: '#7a1f1a', lineHeight: 18 },
  errorHint: { fontFamily: FONT.body, fontSize: 12, color: '#b08a82', marginTop: SPACE.sm },

  // NOT restyled on purpose: this is the raw-payload inspector we have leaned on
  // all week to diagnose misses. Dark + monospace is what makes a wall of JSON
  // legible; fayr-ifying it would trade a working tool for consistency.
  rawBox: { flex: 1, backgroundColor: '#0d1117', padding: SPACE.md },
  rawText: { color: '#c9d1d9', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
