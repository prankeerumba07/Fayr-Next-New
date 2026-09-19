// THE MOMENT AFTER SOMEBODY SAYS THEY BOUGHT IT.
//
// THE DESIGN ALREADY HAD THIS SCREEN, so it is not invented. BuildFeed, at
// fayr-design.browser.jsx:1108, is the design's own waiting screen: a ring 110
// across with a pale 4 point circle, a green arc turning inside it, an emoji in
// the middle at 40 point, one bold line 24 below, and a small quiet line 8 below
// that. It leaves by itself and there is nothing to tap. Every one of those
// numbers is copied. The only thing changed is the words, and the words are the
// owner's own rule:
//
//   THIS SCREEN MUST NEVER TELL SOMEBODY THEIR SHOP ACCOUNT IS BEING LOOKED AT.
//   Not in the heading, not in the small line, not in a label anywhere.
//
// So the lines say nothing at all about what is happening. They are in
// src/ui/funnyWait.js, on their own, with a test that walks every one of them and
// fails on any of the words the owner listed — and the same test reads THIS FILE
// and holds its own words to the same list.
//
// WHAT IS ACTUALLY HAPPENING, for whoever reads this file later. The shop's own
// list of recent orders is fetched from inside the web view the person is already
// signed in to, and the text of each order found is handed to the server, which
// reads it and decides whether any of it is the product this offer is for. See
// src/orderhistory.js for the looking and backend/src/tasks/order-candidates.ts
// for the judging.
//
// IT ALWAYS LEAVES, and it leaves quickly. If the list cannot be opened, if there
// is nothing on it, or if nothing on it is the right product, the answer is the
// same: hand back to the journey, which asks the person to show us the order.
// Nothing is ever explained about why, because there is nothing here a person
// could act on and the rule above forbids naming it.
//
// WHY IT HANDS BACK TO THE JOURNEY rather than naming the next screen. The
// journey works its own step out from the record, and it already knows this
// person said they bought it — so it lands on "show us the order" by itself. A
// screen naming the next screen is a second opinion about where somebody is, and
// that is the defect this project keeps finding.
//
// AND IT CANNOT BE SAT ON. A hard limit sends everybody onward whatever happens,
// so a shop that never answers cannot leave anybody stuck on a turning ring.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, StyleSheet, Text, View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import * as campaignStore from '../backend/campaignStore';
import { getAuthoritative, getTaskId, refreshFromBackend } from '../taskStore';
import { PLATFORMS } from '../platforms';
import {
  countOrderCardSlots, harvestRendered, howThisShopNamesAnOrder, isNotAnOrderPage,
  orderDetailPageFor, ordersWorthOpening, pagesToOpen, readsOrderPages,
  searchesItsOrders, waitBeforeFetch,
} from './detailLook.js';
// WHICH READ THIS IS — the one order Fayr watched, or the list — decided next
// door and only asked here. See whichRead.js for the run it comes from.
import { NOWHERE, THE_LIST, howToLook, theWatchedOrderKey } from './whichRead.js';
import {
  LEAST_A_DRAW_CAN_TAKE_MS, anAnswerTag, answerWithStatus, drawFacts, isOurAnswer,
  openOneOrderWith, openTheListWith, openTheSearchWith, readDetailStep, readListStep,
  theOrderPagesAreDrawn,
} from './drawnList.js';
// THE PRESS LIMIT AND THE THREE STOPS, from the pure file that owns them, so
// the number on the log line and the number the page was built with cannot
// drift apart. See src/shop/loadMore.js.
import { PRESSES_AT_MOST, whyItStopped } from '../shop/loadMore.js';
import { restoreSession } from '../session';
import { logLook } from './lookLog.js';
import { logPageShape } from './pageShape.js';
import { logRowShape } from './rowShape.js';
import { sendFoundOrders } from '../backend/orderCandidatesApi';
import { useMotion } from '../ui/celebration';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { Screen } from '../ui/primitives';
import { WAIT_LINES, WAIT_LINE_MS, waitLineAt } from '../ui/funnyWait.js';
import {
  NOTHING_IS_WRONG_WITH_YOUR_ORDER, SHOP_WANTS_A_SIGN_IN, SHOP_WILL_NOT_LET_US_LOOK,
  TAKING_LONGER, THEN_WE_CAN_LOOK, TRY_IN_A_FEW_MINUTES, TRY_AGAIN, takeMeThere,
} from '../ui/journeyWords.js';
import { Pill } from '../ui/brand';

/** The shortest this is on screen. Below this it reads as a flicker, not a wait. */
export const LEAST_TIME_MS = 1600;

/**
 * The longest, whatever the shop does. Nobody is left on a turning ring.
 *
 * FORTY-FIVE, RAISED FROM TWENTY, FOR THE REASON WRITTEN AT MOST_DETAIL_PAGES.
 * Twenty seconds bought five order pages at three seconds each — a fetch and its
 * politeness gap — and the campaign's own order was the sixth. The ceiling was
 * stopping honest looks, not impolite ones.
 *
 * SLOW_AFTER_MS is deliberately NOT raised with it. Ten seconds is still where
 * this stops being quick, and a person waiting longer than that should be told
 * so rather than have the line moved to keep the screen looking healthy.
 */
export const MOST_TIME_MS = 45000;

/**
 * PAST THIS IT IS SLOW, and a person is told so.
 *
 * The read is normally five to ten seconds. Ten is the top of normal, so this is
 * where "it is working" stops being the honest thing to imply and "it is slow"
 * starts. The line it shows says nothing about what is happening — the rule on
 * this screen is that it never tells anybody their shop account is being looked
 * at — so it says only that it is taking longer.
 */
export const SLOW_AFTER_MS = 10000;

export default function LookingForItScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const platformKey = campaign ? campaign.marketplace : null;
  const platform = platformKey ? PLATFORMS[platformKey] : null;
  /**
   * ONE ORDER, NAMED BY WHOEVER OPENED THIS, OR NULL TO SEARCH AS BEFORE.
   *
   * The purchase step has to search: nobody has said which order it is about.
   * The delivery step does not — the order was chosen pages ago and its number
   * is on the record — and searching there is what put the campaign's own order
   * outside a look that only reached four cards of a list still drawing.
   *
   * IT IS A NUMBER TO OPEN AND NEVER AN ANSWER. It says which page to fetch and
   * nothing else. The page still goes to the server as text, the server still
   * reads it with the same one reader, and the server still decides whether
   * anything matched. Nothing on this side is trusted about money.
   */
  const onlyThisOrder = typeof params.onlyThisOrder === 'string'
    && params.onlyThisOrder !== '' ? params.onlyThisOrder : null;

  const motion = useMotion();
  const [line, setLine] = useState(WAIT_LINES[0]);
  const [slow, setSlow] = useState(false);
  // WHY THE SHOP WOULD NOT LET US LOOK, when there is a name for it. Null while
  // the ring is turning and null on an ordinary empty answer.
  const [refused, setRefused] = useState(null);
  // THE SHOP WANTS A SIGN IN. Its own answer, because there is something to DO
  // about it and it is not sending a photograph.
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [job, setJob] = useState(null);
  // ── THE SHOP SESSION, PUT BACK BEFORE ANYTHING IS ASKED OF THE SHOP ───────
  //
  // ── AND A CORRECTION, BECAUSE THIS WAS WRITTEN DOWN WRONG ────────────────
  //
  // This said, on 15 September 2026, that five days of "it came back with
  // nothing" were all one thing: a view that had never been handed the login,
  // reading a stranger's page. THAT WAS NOT TRUE, and the owner's own log says
  // so if the three runs are laid side by side. The run at 17:44, BEFORE any of
  // this existed, came back with the same three hundred and seventy four
  // kilobytes and a report identical to the run at 18:01 with it in. A look
  // asking as a stranger is redirected — measured since, asking exactly the way
  // the page's own fetch asks: 302 to the sign in wall, eighty four kilobytes,
  // and wantsSignIn would have read true. It never did. The read was already
  // signed in, out of the web view's own cookie store.
  //
  // IT STAYS, AND THE REASON IS NOW THE HONEST ONE. Being signed in because a
  // store happened to be warm is not the same as being signed in on purpose,
  // and the day that store is cold — a fresh install, a phone that cleared it —
  // this is the difference between a read and a sign in wall. It is also what
  // src/ConnectScreen.js has done since the day it was written.
  //
  // THE SAME PATTERN AND NOT A SECOND ONE: restore, hold the view back until it
  // has finished, and let the shop be asked only after that.
  //
  // ── AND IT DOES NOT SAVE ONE ON THE WAY OUT. A DECISION, NOT AN OVERSIGHT ─
  //
  // ConnectScreen persists on unmount because that is where somebody SIGNS IN:
  // it is the screen that creates a session, so it is the screen that must save
  // one. This screen only reads. It creates nothing, so it has nothing to save
  // that the connect screen did not already save.
  //
  // AND SAVING FROM HERE COULD DESTROY A GOOD LOGIN. This screen can land on a
  // refusal, a puzzle or a sign in wall — all three are measured, and the wall is
  // the ORDINARY case here, because the shop asks for a fresh password for this
  // one page. ConnectScreen already guards the same hazard by refusing to write a
  // snapshot after a failed load, in its own words,
  // "A FAILED LOAD MUST NOT SAVE A SIGNED OUT SNAPSHOT OVER A GOOD ONE". This
  // screen has no equivalent signal at the moment it is torn down — the look may
  // have ended on a refusal, a puzzle, or a stranger's home page — so a save here
  // would sometimes write exactly that over a working login and sign the person
  // out of their shop. Reading is not worth that risk, and the cookies a read
  // refreshes are kept by the web view's own store in the meantime.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!platform) { setSessionReady(true); return undefined; }
    restoreSession(platform.key, platform.startUrl).finally(() => {
      if (alive) setSessionReady(true);
    });
    return () => { alive = false; };
  }, [platform]);
  const answered = useRef(false);
  const waiting = useRef(null);
  // THE WEB VIEW ITSELF, so the second and later fetches can be injected into
  // the page that is already open instead of loading a fresh one each time.
  const web = useRef(null);
  // THE NAME ON THIS LOOK'S OWN ANSWERS. The view now sits on the shop's page
  // rather than on its front door, so an answer has to say it is ours.
  const answerTag = useRef('');
  // HOW MANY ANSWERS CAME BACK THAT WE DID NOT ASK FOR. A count, on the line,
  // because a page talking to us is worth knowing about and is never worth
  // quoting.
  const strangers = useRef(0);
  // WHAT THE SHOP ANSWERED FOR THE PAGE ITSELF. A page that has been navigated
  // to cannot see its own status code, so the view reports it and this holds it
  // until the answer arrives. See answerWithStatus in drawnList.js.
  const httpStatus = useRef(200);
  const spin = useRef(new Animated.Value(0)).current;

  // ── the words change, so the screen does not read as stuck ────────────────
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setLine(waitLineAt(Date.now() - startedAt));
    }, WAIT_LINE_MS);
    return () => clearInterval(id);
  }, []);

  // ── AND PAST TEN SECONDS IT SAYS IT IS SLOW ───────────────────────────────
  //
  // One line, added under the turning ones, saying nothing about what is
  // happening. Ten seconds is the top of normal for this read, so before that
  // "it is working" is honest and after it, saying nothing is not.
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  // ── the ring turns, unless the phone asked for less movement ──────────────
  useEffect(() => {
    if (!motion) { spin.setValue(0); return undefined; }
    const turn = Animated.loop(
      Animated.timing(spin, {
        toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true,
      }),
    );
    turn.start();
    return () => turn.stop();
  }, [motion, spin]);

  /** Leave, once, whatever happened. */
  const moveOn = useCallback((where) => {
    if (answered.current) return;
    answered.current = true;
    // REPLACES ITSELF, so nobody can come back to a wait that is already over.
    navigation.replace(where, { campaignId });
  }, [navigation, campaignId]);

  const onMessage = useCallback((event) => {
    let payload = null;
    try { payload = JSON.parse(event.nativeEvent.data); } catch (e) { payload = null; }
    // ── IS THIS OURS, OR DID THE PAGE WRITE IT? ASKED BEFORE ANYTHING ELSE ──
    //
    // Before the waiter is cleared and before a single field is read out of it.
    // The view sits on the shop's own page now, with whatever the shop put in
    // it, and every frame on that page posts into this one handler with nothing
    // to say who sent it. An answer nobody asked for is counted and dropped, and
    // the look carries on waiting for the real one.
    if (!isOurAnswer(payload, answerTag.current)) {
      strangers.current += 1;
      return;
    }
    const resolve = waiting.current;
    waiting.current = null;
    // AND THE VIEW IS NOT TORN DOWN HERE. It used to be — setJob(null) on the
    // first answer, with the view rendered on `job` — so the very first message
    // unmounted the only web view there was, and every order page after it
    // resolved null against a ref that had already gone. Not one order's own
    // page has ever reached the server. The comment below the render about one
    // mount for the whole look is true from here on.
    if (resolve) resolve(answerWithStatus(payload, httpStatus.current));
  }, []);

  /**
   * THE PAGE ITSELF WOULD NOT OPEN. Answered here rather than by pretending to
   * be the page: a made up answer now has to carry this look's own name, and
   * the honest thing for the view to say is nothing at all. `null` reads as "we
   * could not look", which is exactly what it was before.
   */
  const givenUpOn = useCallback(() => {
    const resolve = waiting.current;
    waiting.current = null;
    if (resolve) resolve(null);
  }, []);

  useEffect(() => {
    // ── NOTHING STARTS UNTIL THE SESSION IS BACK ────────────────────────────
    //
    // Before the timers and before the first fetch, because a look that began
    // first would ask the shop as a stranger — which is the whole bug. It also
    // keeps the twenty second ceiling honest: the budget is for the shop, not
    // for reading a snapshot off the phone.
    if (!sessionReady) return undefined;
    let alive = true;
    const startedAt = Date.now();

    // The hard limit. It runs whatever else is going on.
    const giveUp = setTimeout(() => { if (alive) moveOn('Journey'); }, MOST_TIME_MS);
    // NOTE ON THE ORDER OF THESE TWO. The hard limit is cleared when this effect
    // is torn down, and showing the refusal does NOT tear it down — so it is
    // checked inside moveOn instead: `answered` is not set by the refusal, so a
    // refusal shown at nineteen seconds would still be replaced by the journey a
    // second later. That is why the refusal clears it directly.
    const stopTheClock = () => clearTimeout(giveUp);

    /**
     * WHAT IS LEFT OF THE LOOK, RIGHT NOW.
     *
     * ── WHY THE BUDGET IS READ AND NOT SHARED OUT IN ADVANCE ─────────────
     *
     * Twenty seconds used to divide cleanly: one list, then six FETCHES with a
     * real gap between them, and the gaps were the big number. A page that has
     * to be DRAWN has neither cost — going there IS the gap, and somebody
     * reading their own order one page at a time is not pushing against a shop —
     * but its worst case is a whole deadline instead of one round trip, and two
     * of those do not fit in what any fixed share would leave.
     *
     * So nothing is shared out. Each page is handed what is really left when it
     * starts: smaller than a share on a slow run, larger on a fast one, and a
     * page that drew in two seconds gives the whole of the rest back to the next
     * one. The ceiling itself does not move.
     */
    const whatIsLeft = () => MOST_TIME_MS - (Date.now() - startedAt);

    /** Wait until the screen has been up long enough to have been seen. */
    const settle = () => new Promise((done) => {
      const left = LEAST_TIME_MS - (Date.now() - startedAt);
      if (left <= 0) done();
      else setTimeout(done, left);
    });

    (async () => {
      const taskId = campaignId ? getTaskId(campaignId) : null;
      // ── THE NAME ON AN ANSWER, MADE FRESH FOR EVERY PAGE THIS LOOK OPENS ─
      //
      // It used to be one name for the whole look, and that was right while
      // there was one document: the fetches inside it were strictly one after
      // another, so there was never a second thing that could answer.
      //
      // A SHOP WHOSE ORDER PAGES ARE NAVIGATED TO BREAKS THAT. Page k is still
      // in the view while page k+1 is being asked for, and one name would let a
      // late answer from the first resolve the wait for the second — one order's
      // words handed over as another order's. anAnswerTag takes the number of
      // the page for exactly this, and is pure so it can be asked twice without
      // a clock.
      let pageNumber = 0;
      const aFreshName = () => {
        pageNumber += 1;
        answerTag.current = anAnswerTag(pageNumber, Math.random());
        return answerTag.current;
      };
      // WHERE TO POINT THE VIEW AND WHAT TO RUN IN IT. Some shops draw their own
      // list and have to be waited for; the rest are fetched exactly as before.
      // WHICH is which lives next door, because this screen may not know a shop's
      // name — see SHOPS_WHOSE_LIST_THE_PAGE_DRAWS.
      const theList = platform
        ? openTheListWith(platformKey, platform.startUrl, startedAt, aFreshName())
        : null;

      // ── WHICH READ THIS IS, ASKED BEFORE ANYTHING IS OPENED ─────────────
      //
      // MOVED UP HERE ON 20 SEPTEMBER 2026, and the move is the whole of it.
      // The NOWHERE answer — a claim that knows WHICH order was placed, on a
      // shop whose order pages nobody has measured — was decided further down,
      // below the guard underneath this one. Blinkit and Instamart have no
      // order LIST page either, so that guard always fired first and the answer
      // written for exactly those two shops could never be reached.
      //
      // It cost nothing while neither shop could produce a watched key at all.
      // Phase 8B-b's measurement mode exists so that both of them can, so the
      // ordering had to be right before the measurement rather than after it.
      const watchedKey = theWatchedOrderKey(campaignId ? getAuthoritative(campaignId) : null);
      const how = howToLook({
        watchedOrderKey: watchedKey, shape: howThisShopNamesAnOrder(platformKey),
      });

      // A KEY WITH NO PAGE BEHIND IT READS NOTHING AND HANDS BACK. Never the
      // list: "we know which order" is not a reason to go and read strangers.
      if (how.path === NOWHERE) {
        logLook('watched', 'opened=0 why=nowhere');
        await settle();
        if (alive) moveOn('Journey');
        return;
      }

      // NOTHING TO LOOK AT is not an error and is never explained. Some shops
      // keep their list of orders somewhere a page of text cannot reach, and the
      // person is simply asked instead.
      if (!taskId || !theList || !platform) {
        await settle();
        if (alive) moveOn('Journey');
        return;
      }

      /**
       * ── ONE PAGE LOAD, MANY FETCHES ─────────────────────────────────────
       *
       * The first fetch mounts the web view, which loads the shop's own page and
       * runs the script on load. Every fetch after that is injected into the
       * page that is ALREADY open.
       *
       * WHY, AND IT IS NOT TIDINESS. Remounting per fetch means a full page load
       * of the shop's home page each time. Six of those, plus six fetches, plus
       * the gaps between them, is comfortably past the twenty second ceiling this
       * screen enforces — so the look would be cut off before it finished on
       * every run that needed more than a page or two. It is also six page loads
       * asked of a shop that rate-limits us, for nothing.
       */
      /**
       * ── AND WHAT HAPPENS INSIDE THAT ONE MOUNT DEPENDS ON THE STEP ──────
       *
       * A FETCHED STEP IS INJECTED into the page already open, exactly as it
       * always was. Its address never changes — and setting an address the view
       * is already on does nothing at all, so a fetched step handed over as an
       * address would install a script that never runs and a wait that never
       * ends.
       *
       * A DRAWN STEP IS AN ADDRESS, because it is the shop's own code that has
       * to run and there is no way to run it but to go there. The view is NOT
       * rebuilt for it: the key is fixed, so this is a navigation inside the one
       * view and the cookies, the process and the warm session all stay. The
       * script comes with it and the view runs it when that page has loaded.
       *
       * THE FIRST STEP OF A LOOK FALLS THROUGH TO THE ADDRESS whichever kind it
       * is, because there is no view yet to inject into. That is what mounts it.
       */
      const openWith = (next) => new Promise((resolve) => {
        // A STEP WITH NOWHERE TO GO IS RUN WHERE WE ALREADY ARE, which is every
        // page a shop sends whole: one page load for the whole look, and the
        // fetch happens inside it. If that view has gone there is nothing to run
        // it in, and saying so is the only honest answer — see the note above.
        if (next.uri == null) {
          if (!web.current) { resolve(null); return; }
          waiting.current = resolve;
          web.current.injectJavaScript(next.script);
          return;
        }
        // AND A STEP WITH AN ADDRESS IS GONE TO. The first step of any look
        // mounts the view this way; a page that has to be drawn navigates the
        // view that is already up, keeping its cookies and its warm session.
        waiting.current = resolve;
        setJob(next);
      });
      const pause = (ms) => new Promise((done) => { setTimeout(done, ms); });

      /** Hand the text of everything opened so far to the server, and ask. */
      const askTheServer = async (pages) => {
        const sent = await sendFoundOrders(taskId, pages);

        // ── DID THE REQUEST EVEN LEAVE THE PHONE ─────────────────────────
        //
        // THE LINE THE WHOLE POSTMORTEM TURNED ON. `ok:false` and "the server
        // looked and matched nothing" both end as an empty list one line below,
        // and on 11 September that made a backend which was not running
        // indistinguishable from a real empty answer. status=0 means it never
        // left the phone; a 200 with matched=0 means the server read the pages
        // and none of them was the product.
        //
        // PAGE COUNT, NEVER PAGE TEXT. What was sent is an order's own page and
        // it carries the buyer's name and address.
        logLook('post', `pages=${Array.isArray(pages) ? pages.length : 0} `
          + `ok=${sent.ok} status=${sent.status} `
          + `matched=${sent.ok ? sent.orders.filter((o) => o && o.matches === true).length : 0} `
          + `why=${sent.why == null ? 'null' : `"${sent.why}"`}`);

        if (!sent.ok) return [];
        return sent.orders.filter((o) => o && o.matches === true && !o.chosenAt);
      };

      /** Leave with whatever the server ended up holding. */
      const leaveWith = async (matched) => {
        await refreshFromBackend();
        await settle();
        if (!alive) return;
        moveOn(matched.length > 0 ? 'IsThisYourOrder' : 'Journey');
      };

      // ── THE ORDER FAYR WATCHED: ONE PAGE, AND NEVER THE LIST — PHASE 8A ──
      //
      // MEASURED ON THE OWNER'S OWN PURCHASE, 18 SEPTEMBER 2026. The web view
      // saw the order one second after payment, and this look then opened the
      // LIST and judged six strangers. The delivery look that followed was
      // handed the order NUMBER the page prints, which is not what a Zepto
      // page is addressed by, so it opened nothing at all: "numbers linked=8
      // opening=0 named=true".
      //
      // With the watched key on the record there is exactly one page to read.
      // It is built the way the review step already builds it, and it is
      // opened, read and posted through the same three things every order page
      // below goes through — openOneOrderWith, readDetailStep, askTheServer —
      // so there is one reader and one road to the server, not two.
      //
      // A PAGE THAT CANNOT BE READ YET IS NOT A FAILURE. A live tracking page in
      // the first minutes after an order has not settled into the receipt the
      // reader knows. The look hands back to the journey, which shows the wait
      // and looks again on the cadence — and NEVER falls back to the list,
      // because that fallback is what read six strangers.
      //
      // AND NO "IS THIS YOUR ORDER?" ON THE WAY BACK. The owner's decision: the
      // phone watched THIS order be placed from THIS claim, and the server's
      // match on the watched page is the confirm. So the journey is handed back
      // to whatever the server decided, and the record says the rest.
      // DECIDED ABOVE, before the list was built. NOWHERE has already handed
      // back by the time this runs, so the only thing left to tell apart here is
      // the one page from the list.
      if (how.path !== THE_LIST) {
        const next = openOneOrderWith(
          platformKey, how.url, Date.now(), aFreshName(), watchedKey, whatIsLeft(),
        );
        const one = await openWith(next);
        if (!alive) return;
        const detail = readDetailStep(next, one);
        // COUNTS, THE STATUS AND WHERE IT LANDED — with the key already taken
        // out of the landing by readDetailStep. Never the page, never the key.
        logLook('watched', `status=${one && one.status} `
          + `bytes=${(one && typeof one.html === 'string' ? one.html.length : 0)} `
          + `landed=${detail.landed == null ? 'null' : detail.landed} `
          + `looked=${detail.looked} whyNot=${detail.whyNot} `
          + `wantsSignIn=${detail.wantsSignIn}`);
        // THE SAME TWO REFUSALS EVERY OTHER PAGE HAS, in the same words.
        if (detail.wantsSignIn === true) {
          await settle();
          if (!alive) return;
          stopTheClock();
          setNeedsSignIn(true);
          return;
        }
        if (detail.whyNot != null) {
          await settle();
          if (!alive) return;
          stopTheClock();
          setRefused(detail.whyNot);
          return;
        }
        // NOT READABLE YET IS NOT A FAILURE. Hand back; the journey looks again.
        if (!detail.looked) {
          await leaveWith([]);
          return;
        }
        await askTheServer([detail.text]);
        if (!alive) return;
        await leaveWith([]);
        return;
      }

      // ── THE SHOP'S OWN SEARCH OF THIS PERSON'S ORDERS, ASKED FIRST ──────
      //
      // ── WHY IT IS FIRST AND NOT A LAST RESORT ─────────────────────────
      //
      // MEASURED ON THE OWNER'S OWN ACCOUNT, 16 SEPTEMBER 2026. The list this
      // look reads answers with TEN rows. One of his orders — placed in February
      // — is on the SECOND page of it, and no ceiling on how many of the ten we
      // open can ever reach an order whose number is not on the page we are
      // reading. The shop's own search answers with that order's card, whatever
      // page or year it sits on, in one request.
      //
      // So the cheap, exact question is asked before the broad, expensive one.
      // When it answers, the list is not opened at all — one request instead of
      // a page load and up to ten fetches — and when it answers with nothing,
      // everything below happens exactly as it did before this existed.
      //
      // IT IS AN ADDRESS AND NOTHING ELSE. The words go in the address. No form
      // is filled in, no key is pressed and no control on the shop's page is
      // touched — see WHERE_EACH_SHOP_SEARCHES_ITS_ORDERS for the whole of it.
      //
      // ── AND IT IS SKIPPED WHEN THE ORDER IS ALREADY NAMED ─────────────
      //
      // Whoever opened this with a number in hand has nothing to search for, and
      // asking the shop a question we know the answer to is one more request
      // against a shop that rate-limits us, for nothing.
      //
      // THE SHOP IS ASKED, NEVER NAMED, exactly as everywhere else on this
      // screen: which shops have a search of their own lives in detailLook.js.
      let fromTheSearch = [];
      const theSearch = onlyThisOrder == null && searchesItsOrders(platformKey)
        ? openTheSearchWith(
          platformKey, campaign && campaign.productName,
          platform.startUrl, Date.now(), aFreshName(),
        )
        : null;
      if (theSearch != null) {
        const searchAnswer = await openWith(theSearch);
        if (!alive) return;
        const searchOutcome = readListStep(theSearch, searchAnswer);
        const searchDrew = drawFacts(searchAnswer);
        const searchHtml = searchAnswer && typeof searchAnswer.html === 'string'
          ? searchAnswer.html
          : '';

        // COUNTS AND STATUS WORDS ONLY, as next door. `landed=` is the PATH, and
        // the path is the whole reason this line is safe to print: the words we
        // searched for are in the query, and landedPath drops the query.
        logLook('search', `status=${searchAnswer && searchAnswer.status} `
          + `bytes=${searchHtml.length} `
          + `landed=${searchOutcome.landed == null ? 'null' : searchOutcome.landed} `
          + `looked=${searchOutcome.looked} whyNot=${searchOutcome.whyNot} `
          + `wantsSignIn=${searchOutcome.wantsSignIn} `
          + `drawn=${theSearch.drawn} drew=${searchDrew.drew} `
          + `settled=${searchDrew.settled} waited=${searchDrew.waited} `
          + `looks=${searchDrew.looks} `
          + `rows=${searchDrew.linked}/${searchDrew.marked} `
          + `nodes=${searchDrew.nodesFirst}/${searchDrew.nodesNow} `
          + `strangers=${strangers.current}`);

        // ── A REFUSAL HERE STOPS THE WHOLE LOOK, AS IT DOES ANYWHERE ─────
        //
        // The same two answers the list and each order page already use, and for
        // the same reason: a sign in wall or a puzzle on this page means the shop
        // is done with us for now, and going on to ask it for a list and then ten
        // order pages is pushing against exactly the limit it just named.
        if (searchOutcome.wantsSignIn === true) {
          await settle();
          if (!alive) return;
          stopTheClock();
          setNeedsSignIn(true);
          return;
        }
        if (searchOutcome.whyNot != null) {
          await settle();
          if (!alive) return;
          stopTheClock();
          setRefused(searchOutcome.whyNot);
          return;
        }

        // THE SAME HARVEST, and that is the point rather than a saving. The
        // search answers with the cards the list answers with, so a second way
        // of recognising one is a second idea of what an order card is.
        const searchHarvest = harvestRendered(searchHtml, platformKey);
        const searchWorth = ordersWorthOpening(
          searchHtml, searchHarvest.numbers, platformKey,
        );
        fromTheSearch = pagesToOpen(searchWorth.numbers, platformKey);

        // THE NUMBERS THEMSELVES ARE NOT LOGGED, for the reason written beside
        // the list's own count: an order number is a strong identifier tied to
        // the account, it is already kept server side, and a count is what the
        // question needs. Neither are the words we searched for.
        logLook('searched', `slots=${countOrderCardSlots(searchHtml, platformKey)} `
          + `marked=${searchHarvest.marked} linked=${searchHarvest.linked} `
          + `shaped=${searchHarvest.shaped} skipped=${searchWorth.skipped} `
          + `opening=${fromTheSearch.length} how=${searchHarvest.how}`);
      }

      // ── AND THE LIST, ONLY WHEN THE SEARCH DID NOT ANSWER ───────────────
      //
      // The fallback is the whole of what this screen did before, unchanged and
      // in the same order. A shop with no search of its own never enters the
      // block above, so for everybody but one this is still the first thing that
      // happens.
      let outcome = null;
      let listHtml = '';
      if (fromTheSearch.length === 0) {
        const answer = await openWith(theList);
        if (!alive) return;

        outcome = readListStep(theList, answer);
        // WHAT THE PAGE SAID ABOUT ITS OWN DRAWING, every field made safe first: a
        // page can put anything at all in these and they end up on a line.
        const drawn = drawFacts(answer);

        // ── WHAT THE SHOP'S LIST ACTUALLY ANSWERED ───────────────────────────
        //
        // COUNTS AND STATUS WORDS ONLY. `bytes` is the page's LENGTH and never the
        // page: an order list carries the buyer's name and address, and a length
        // answers the only question asked of it — was there a page at all, and was
        // it a real one or a stub. See the note at the top of lookLog.js.
        // AND WHICH PAGE IT LANDED ON, which is the field that was missing. Five
        // days of "it fetched nothing" all said 200, a real size, and no refusal,
        // and not one of them said the page was Amazon's home shell. The PATH only:
        // a shop's address carries tokens in its query and this goes into a log.
        // AND WHETHER THE SHOP EVER DREW THE THING WE CAME FOR. `drew=true` means
        // the orders appeared and were still there a look later. `drew=false` with
        // a `waited` at the deadline means they never appeared at all. Those are
        // different problems and without this they are one silence — which is the
        // whole lesson of the five days before this.
        // `rows=` is the two counts the wait watched, `nodes=` is how much the page
        // grew while we watched, and `strangers=` is how many answers came back
        // that nobody asked for. Counts only, every one of them.
        logLook('list', `status=${answer && answer.status} `
          + `bytes=${(answer && typeof answer.html === 'string' ? answer.html.length : 0)} `
          + `landed=${outcome.landed == null ? 'null' : outcome.landed} `
          + `looked=${outcome.looked} whyNot=${outcome.whyNot} `
          + `wantsSignIn=${outcome.wantsSignIn} `
          + `drawn=${theList.drawn} drew=${drawn.drew} settled=${drawn.settled} `
          + `waited=${drawn.waited} looks=${drawn.looks} `
          + `rows=${drawn.linked}/${drawn.marked} `
          + `nodes=${drawn.nodesFirst}/${drawn.nodesNow} `
          + `strangers=${strangers.current}`);

        // ── EVERY PRESS OF "LOAD MORE", AND WHAT EACH ONE WAS WORTH ──────────
        //
        // ITS OWN LINE, AND ONLY WHEN SOMETHING WAS PRESSED. A shop with no
        // measured button presses nothing, answers presses=0, and writes no line
        // at all — so Amazon's log is unchanged, character for character.
        //
        // THE PER-PRESS COUNTS ARE THE POINT, not the total. A button that is
        // there and does nothing and a list that really has run out both end on
        // one number; they are told apart by whether the count moved between
        // presses. rowsBeforeEachPress is the count BEFORE each press in order,
        // and rows= is where it ended up.
        //
        // AND WHY IT STOPPED, from src/shop/loadMore.js rather than worked out
        // here, so there is one idea of the three endings and not two.
        if (drawn.presses > 0) {
          logLook('presses', `n=${drawn.presses} of ${PRESSES_AT_MOST} `
            + `rowsBeforeEach=${drawn.rowsBeforeEachPress.join(',')} `
            + `rows=${drawn.rowsAtTheEnd} `
            + `buttonStillThere=${drawn.theButtonWasStillThere} `
            + `why="${whyItStopped({
              pressesSoFar: drawn.presses,
              buttonIsThere: drawn.theButtonWasStillThere,
              orderFound: false,
            })}"`);
        }

        // ── THE SHOP REFUSED, AND THAT IS NOT "WE COULD NOT FIND YOUR ORDER" ──
        //
        // Three faces of one meaning, all measured from the owner's own log on 9
        // September 2026: a page reading only "Click the button below to continue
        // shopping", a 503, and the robot puzzle. Every one of them used to fall
        // into the silent hand-back below, which lands on "show us the order" —
        // so somebody whose purchase was perfectly fine was asked for a
        // photograph because a shop had asked us to slow down.
        //
        // IT STOPS HERE INSTEAD. Nothing is handed back, the screenshot flow is
        // not entered, and the honest answer is on screen with one way to retry.
        // The right action is to wait a few minutes, and no photograph helps.
        // ── THE SHOP WANTS A SIGN IN, AND THAT IS ASKED FIRST ─────────────────
        //
        // Before the refusal and before the hand-back, because it is the one
        // outcome with something the person can DO. Measured: Amazon's orders page
        // redirects to a sign in demanding a FRESH password, which its review and
        // profile pages never do — so this is the normal case, not an edge one.
        //
        // It used to fall into the silent hand-back, which lands on "show us the
        // order". Somebody who simply needed to sign in again was asked for a
        // photograph instead of being sent to sign in.
        if (outcome.wantsSignIn === true) {
          await settle();
          if (!alive) return;
          stopTheClock();
          setNeedsSignIn(true);
          return;
        }

        if (outcome.whyNot != null) {
          await settle();
          if (!alive) return;
          stopTheClock();
          setRefused(outcome.whyNot);
          return;
        }
        listHtml = answer && typeof answer.html === 'string' ? answer.html : '';
      }



      // ── AMAZON: THE LIST IS WORTH ITS ORDER NUMBERS AND NOTHING ELSE ────
      //
      // Amazon fills its list in with its own code after the page arrives, and a
      // fetch runs none of it, so the cards come back as empty frames. Measured
      // twice fourteen minutes apart in one session: eight matched products, then
      // none. What survives is each card's own attribute carrying the order
      // number, because an attribute is in the markup as sent.
      //
      // So the numbers are harvested and each order's OWN page is opened — the
      // server-rendered one the review-first read has always used and proven.
      // The TEXT goes to the server, which reads it with the same one reader the
      // screenshots go through and says whether it matched. The phone decides
      // nothing about money.
      //
      // IT STOPS AT THE FIRST MATCH, so the ordinary case is one order page.
      // Every other shop keeps exactly what it did before: their list pages
      // really do carry their orders as text.
      // ASKED, NEVER NAMED. This screen may not write a shop's name anywhere,
      // including in a comparison, and there is a check that reads this file and
      // holds every piece of text in it to that rule. src/order/detailLook.js
      // knows which shops are read this way; this only asks.
      if (readsOrderPages(platformKey)) {
        const html = listHtml;
        // THREE RUNGS, STRONGEST FIRST, and `how` says which one answered. See
        // harvestRendered: the card attribute, then the order's own link, then
        // the number's own shape. No new marker is guessed anywhere in it.
        // THE SHOP IS ASKED FOR, NEVER NAMED. Every one of these is handed the
        // key it was given and looks the shapes up next door. There is no
        // default shop anywhere in that file, so a page from a shop it does not
        // know finds nothing rather than being read with somebody else's shapes.
        const harvest = harvestRendered(html, platformKey);
        // ── AND THE ONES THE SHOP ITSELF LINKS SOMEWHERE THAT IS NOT AN ORDER ──
        //
        // Measured on a real run: two of the six pages it opened were not
        // purchases at all, they carried the same card and the same order-shaped
        // number as a real order, and they cost two of six slots — which put the
        // campaign's own order sixth and left the look finishing at the edge of
        // its ceiling. A number is dropped only when the shop's own link for it
        // points somewhere that has been SEEN not to be an order, so the worst
        // this can do is nothing at all.
        const worth = ordersWorthOpening(html, harvest.numbers, platformKey);
        // ── A NAMED ORDER BEATS ANYTHING HARVESTED OFF THE LIST ────────────
        //
        // Not "as well as": INSTEAD OF. Whoever opened this already knows which
        // order the question is about, so every other number on the list is a
        // page fetched for nothing and a slot spent against the ceiling.
        //
        // STILL THROUGH pagesToOpen, which is the point of routing it here
        // rather than fetching it directly: a number that is not this shop's
        // shape is refused exactly as a harvested one would be, so a bad value
        // arriving in a route param opens nothing at all.
        // ── AND THE SEARCH'S OWN ANSWER BEATS BOTH OF THEM ────────────────
        //
        // Not "as well as": INSTEAD OF, for the same reason a named order does.
        // When the search found the order there is no list — it was never opened
        // — so `html` is empty, the harvest above found nothing in it, and this
        // is the only thing there is to open.
        const numbers = fromTheSearch.length > 0
          ? fromTheSearch
          : (onlyThisOrder != null
            ? pagesToOpen([onlyThisOrder], platformKey)
            : pagesToOpen(worth.numbers, platformKey));

        // ── THE ONE LINE THAT TELLS THE TWO EMPTY ANSWERS APART ────────────
        //
        // slots=0 means the page was not an orders page at all. slots>0 with
        // shaped=0 means the cards were there and every id in them was refused,
        // so the SHAPE has moved and the fix is one regular expression. Opposite
        // problems, opposite fixes, and without this count they are one silence.
        //
        // THE NUMBERS THEMSELVES ARE NOT LOGGED. An order number is a strong
        // identifier tied to the account, it is already kept server side, and a
        // count is what the question needs.
        logLook('numbers', `slots=${countOrderCardSlots(html, platformKey)} `
          + `marked=${harvest.marked} linked=${harvest.linked} `
          + `shaped=${harvest.shaped} skipped=${worth.skipped} `
          + `opening=${numbers.length} `
          // WHETHER ONE WAS NAMED, AND NEVER WHICH ONE. An order number is a
          // strong identifier tied to the account and is already kept server
          // side; that it was named is what tells the two reads apart in a log.
          + `named=${onlyThisOrder != null} searched=${fromTheSearch.length} `
          + `how=${harvest.how}`);

        // ── AND WHEN THERE ARE NO SLOTS AT ALL, SAY WHAT THE PAGE IS MADE OF ──
        //
        // slots=0 on a whole healthy page means the attribute we look for is not
        // there any more, which is what his log said on 15 September 2026: three
        // hundred and seventy four kilobytes, signed in, no refusal, and not one
        // order card slot. That is Amazon having moved the markup, and the only
        // honest next step is to look at what it sends today rather than guess a
        // second pattern the way the first one was guessed.
        //
        // ONLY WHEN THERE IS NOTHING TO FIND. A page that is working prints no
        // shape report at all, so this cannot become noise on the ordinary path.
        // It is counts, attribute names and digit-masked shapes — never a word off
        // the page. See src/order/pageShape.js for what it may and may not say.
        if (countOrderCardSlots(html, platformKey) === 0) logPageShape(html);
        // ── AND WHAT AN ORDER ROW IS ACTUALLY MARKED WITH ───────────────────
        //
        // The report above says what the whole page is made of, which answered
        // the question when the page had no orders on it at all. This one asks
        // the narrower question the next selector is written from: find every
        // place an order number appears and say what is WRAPPED AROUND IT — the
        // tag, its classes, its id, its data attributes, and the same for the
        // few elements above it. Identical surroundings collapse into one line
        // with a count. Never a word off the page, never a real order number.
        if (countOrderCardSlots(html, platformKey) === 0) logRowShape(html);

        // ── WHETHER THIS SHOP'S ORDER PAGES HAVE TO BE DRAWN, ASKED ONCE ───
        //
        // NOT THE SAME QUESTION AS WHETHER ITS LIST IS, and the difference is
        // load bearing: one shop draws its list and sends its order pages whole,
        // which is the whole reason those are fetched one at a time and the
        // reason the gap between them exists. Keying any of the three lines
        // below on the LIST would take that gap away from it.
        const ordersAreDrawn = theOrderPagesAreDrawn(platformKey);

        const pages = [];
        for (let i = 0; i < numbers.length; i += 1) {
          // A PAGE THAT IS GONE TO IS ITS OWN GAP. There is no fetch to be
          // polite about: the view loads one page, and the person is reading
          // their own orders at the speed a person reads them.
          const gap = ordersAreDrawn ? 0 : waitBeforeFetch(i);
          if (gap > 0) await pause(gap);
          if (!alive) return;
          const url = orderDetailPageFor(platformKey, numbers[i]);
          // Cannot be null — pagesToOpen already refused anything that is not an
          // order number — and it is still asked, because the day that stops
          // being true the answer must be "do not fetch it" and not a guess.
          if (url == null) continue;
          // ── AND WE DO NOT START A PAGE WE HAVE ALREADY LOST ──────────────
          //
          // Below this there is not enough of the look left for any page to be
          // called drawn, however fast the shop is. Opening one anyway buys a
          // deadline, a shell handed to the server, and one more request asked
          // of a shop for nothing.
          if (ordersAreDrawn && whatIsLeft() < LEAST_A_DRAW_CAN_TAKE_MS) break;

          const next = openOneOrderWith(
            platformKey, url, Date.now(), aFreshName(), numbers[i],
            ordersAreDrawn ? whatIsLeft() : undefined,
          );
          const one = await openWith(next);
          if (!alive) return;
          // READ THE WAY THIS STEP WAS OPENED, never the way the shop usually
          // is. The step knows; asking twice is how two answers disagree.
          const detail = readDetailStep(next, one);

          // ── AND WHICH PAGE THE ORDER READ ACTUALLY LANDED ON ─────────────
          //
          // The order's own page is BELIEVED to be sent whole by the shop's own
          // server, which is the belief the whole one-page-at-a-time design
          // rests on, and nothing has ever measured it. It could not have: every
          // one of these answers resolved null against a view that had already
          // been torn down, so not one of them ever reached the shop.
          //
          // It matters more than it did. The address this asks for is retired —
          // the shop answers it with a redirect to a page in the same rebuilt
          // area the LIST moved into. `landed=` says where it ended up; `bytes=`
          // and `looked=` together say whether what arrived was a whole page or
          // another empty frame. Before the refusal branches below, because
          // those are the answers that stop the look and never reach the server
          // line.
          logLook('detail', `n=${i + 1} status=${one && one.status} `
            + `bytes=${(one && typeof one.html === 'string' ? one.html.length : 0)} `
            + `landed=${detail.landed == null ? 'null' : detail.landed} `
            + `looked=${detail.looked} whyNot=${detail.whyNot} `
            + `wantsSignIn=${detail.wantsSignIn}`);

          // ── ANY REFUSAL STOPS THE WHOLE LOOK, NOT JUST THIS PAGE ────────
          //
          // A dead end, a 503 or a puzzle on one order page means the shop is
          // done with us for now. Carrying on down the list would be pushing
          // against exactly the limit it just named, and it is the behaviour
          // that gets an account blocked. Reported through the same two answers
          // the list already uses, so there is one vocabulary for it.
          if (detail.wantsSignIn === true) {
            await settle();
            if (!alive) return;
            stopTheClock();
            setNeedsSignIn(true);
            return;
          }
          if (detail.whyNot != null) {
            await settle();
            if (!alive) return;
            stopTheClock();
            setRefused(detail.whyNot);
            return;
          }

          // An order page with nothing readable on it is not a refusal. On to
          // the next one.
          if (!detail.looked) continue;

          // ── AND NEITHER IS A PAGE THAT TURNED OUT NOT TO BE AN ORDER ─────
          //
          // The line above says where it landed. When the shop answered an order
          // address with a page of its own that is not an order — a payment, a
          // transfer — its words are not this person's purchase and must not go
          // into the thing that decides whether a purchase matches. Skipping it
          // here costs the request that was already spent and saves everything
          // after it: the text is not sent, and it cannot match on an amount.
          //
          // THIS IS THE SECOND HALF OF THE SAME GUARD. The first half drops
          // these before they are opened at all, when the shop's own link says
          // so. This one catches the ones whose link said nothing.
          if (isNotAnOrderPage(platformKey, detail.landed)) continue;

          pages.push(detail.text);
          const matched = await askTheServer(pages);
          if (!alive) return;
          if (matched.length > 0) { await leaveWith(matched); return; }
        }
        // Nothing matched, or there were no order numbers to open at all. The
        // silent hand-back, exactly as before: the journey asks the person.
        await leaveWith([]);
        return;
      }

      if (outcome == null || !outcome.looked) {
        await settle();
        if (alive) moveOn('Journey');
        return;
      }

      // THE TEXT, AND ONLY THE TEXT. The server reads it and decides.
      await leaveWith(await askTheServer(outcome.blocks));
    })();

    return () => {
      alive = false;
      clearTimeout(giveUp);
      waiting.current = null;
    };
  }, [campaignId, platformKey, platform, moveOn, sessionReady]);

  const turn = spin.interpolate({
    inputRange: [0, 1], outputRange: ['0deg', '360deg'],
  });

  // ── WHEN THE SHOP WANTS A SIGN IN, SEND THEM BACK AND SAY SO PLAINLY ─────
  //
  // The owner asked for this in those words. One tap, to the shop's own sign in
  // through the connect screen — with toSignIn, which is the whole difference
  // between a sign in visit and a reading visit (see src/signin.js).
  //
  // THE SENTENCE DOES NOT NAME THE SHOP AND THE BUTTON DOES, through takeMeThere,
  // so the shop's name lives in one place rather than two.
  if (needsSignIn) {
    return (
      <Screen bg={COLOR.cream}>
        <View style={styles.middle}>
          <Text style={styles.refusedHead}>{SHOP_WANTS_A_SIGN_IN}</Text>
          <Text style={styles.refusedLine}>{THEN_WE_CAN_LOOK}</Text>
          <View style={styles.refusedFoot}>
            <Pill
              onPress={() => navigation.replace(platformKey, {
                campaignId, toSignIn: true,
              })}
              color={COLOR.ink}
            >
              {(platform ? takeMeThere(platform.name) : TRY_AGAIN).toUpperCase()}
            </Pill>
          </View>
        </View>
      </Screen>
    );
  }

  // ── WHEN THE SHOP WOULD NOT LET US LOOK ──────────────────────────────────
  //
  // A separate face for this screen, and no ring: there is nothing turning any
  // more. Every word comes from src/ui/journeyWords.js, where Fayr's own plain
  // language rule reads it off disk, and not one of them names the shop.
  //
  // TRY AGAIN, AND NOT A SCREENSHOT. The right action is to wait a few minutes,
  // and a photograph cannot make a shop answer. Retrying is done by rebuilding
  // this screen from nothing — the same `replace` the rest of it uses — because
  // the read runs once inside an effect keyed on the campaign.
  if (refused != null) {
    return (
      <Screen bg={COLOR.cream}>
        <View style={styles.middle}>
          <Text style={styles.refusedHead}>{SHOP_WILL_NOT_LET_US_LOOK}</Text>
          <Text style={styles.refusedLine}>{NOTHING_IS_WRONG_WITH_YOUR_ORDER}</Text>
          <Text style={styles.refusedLine}>{TRY_IN_A_FEW_MINUTES}</Text>
          <View style={styles.refusedFoot}>
            <Pill
              onPress={() => navigation.replace('LookingForIt', { campaignId })}
              color={COLOR.ink}
            >
              {TRY_AGAIN.toUpperCase()}
            </Pill>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.middle}>
        <View style={styles.ring}>
          <View style={styles.ringTrack} />
          <Animated.View
            style={[styles.ringArc, { transform: [{ rotate: turn }] }]}
          />
          <View style={styles.ringMiddle}><Text style={styles.sparkle}>✨</Text></View>
        </View>
        <Text style={styles.line}>{line}</Text>
        <Text style={styles.small}>This screen moves on by itself.</Text>
        {/* SLOW, SAID LIGHTLY AND WITH NO REASON GIVEN. Past ten seconds, which
            is the top of normal for this read. The words say only that it is
            slow: this screen must never tell anybody their shop account is
            being looked at, and that rule holds here as everywhere else on it. */}
        {slow ? <Text style={styles.slow}>{TAKING_LONGER}</Text> : null}
      </View>

      {/* The look itself. Off screen on purpose: there is nothing on it for
          anybody to read, and the person is watching the ring. */}
      {job && sessionReady ? (
        <WebView
          /* ONE MOUNT FOR THE WHOLE LOOK. The key is deliberately NOT the
             address: keying on it would reload a page before every fetch, which
             is six page loads asked of a shop that rate-limits us and comfortably
             past this screen's own twenty second ceiling. Later fetches are
             injected into the page already open.
             AND IT IS TRUE NOW. It was written before it was: the first answer
             used to clear `job`, which unmounted this, which made every fetch
             after it resolve null. See onMessage. */
          key="the-look"
          ref={web}
          /* WHERE THE LOOK GOES. For a shop that draws its own list this is the
             list itself, so the shop's code runs and there is something to read;
             for the rest it is the front door and the list is fetched from
             inside it, exactly as before. The step decides, next door, because
             this screen may not know a shop's name. */
          source={{ uri: job.uri }}
          userAgent={platform.userAgent}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScript={job.script}
          onMessage={onMessage}
          /* A PAGE CANNOT SEE ITS OWN STATUS CODE, so the view says. Reset when a
             navigation starts, overwritten when the shop answers with an error,
             and put back into the answer on our own side. */
          onLoadStart={() => { httpStatus.current = 200; }}
          onHttpError={(e) => {
            const said = e && e.nativeEvent ? Number(e.nativeEvent.statusCode) : 0;
            httpStatus.current = Number.isFinite(said) ? said : 0;
          }}
          onError={givenUpOn}
          /* NOTHING HERE IS FOR ANYBODY TO READ OR REACH. It is one point across,
             fully see through and off the side of the screen, and it now holds
             somebody's own orders — so it is taken out of the reading order as
             well, rather than relying on being invisible. */
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.away}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  middle: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30,
  },

  // The slow line, quieter than the turning one above it: it is a reassurance,
  // not the thing being said.
  slow: {
    fontFamily: FONT.bodyMed, fontSize: 12.5, lineHeight: 18,
    color: COLOR.ink2, textAlign: 'center', marginTop: 14, opacity: 0.85,
  },

  // ── THE SHOP WOULD NOT LET US LOOK ───────────────────────────────────────
  // No ring here. Nothing is turning any more, and a ring over a finished
  // message is a screen that looks like it is still working.
  refusedHead: {
    fontFamily: FONT.displaySemi, fontSize: 19, lineHeight: 26, color: COLOR.ink,
    textAlign: 'center', marginBottom: 14,
  },
  refusedLine: {
    fontFamily: FONT.bodyMed, fontSize: 14, lineHeight: 21, color: COLOR.ink2,
    textAlign: 'center', marginBottom: 8,
  },
  refusedFoot: { marginTop: 22, alignSelf: 'stretch' },

  // The design's ring: 110 across, a 4 point pale circle, one green arc turning.
  ring: { width: 110, height: 110, alignItems: 'center', justifyContent: 'center' },
  ringTrack: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55,
    borderWidth: 4, borderColor: '#E7E8D6',
  },
  ringArc: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55,
    borderWidth: 4, borderTopColor: COLOR.green, borderRightColor: 'transparent',
    borderBottomColor: 'transparent', borderLeftColor: 'transparent',
  },
  ringMiddle: { alignItems: 'center', justifyContent: 'center' },
  sparkle: { fontSize: 40 },

  line: {
    fontFamily: FONT.bodyBold, fontSize: 15, color: COLOR.ink, marginTop: 24,
    textAlign: 'center', maxWidth: 280,
  },
  small: {
    fontFamily: FONT.body, fontSize: 12, color: '#a9aa9c', marginTop: SPACE.sm,
    textAlign: 'center',
  },

  // Off the screen rather than hidden: a WebView with no size does not always run
  // its script on either phone, and this one has to run.
  away: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
