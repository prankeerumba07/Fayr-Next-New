// THE SHOP, INSIDE FAYR.
//
// The shop's own mobile site in a web view a person can see, scroll and tap,
// with a bar across the top carrying the product they claimed, from the moment
// they tap Open until they leave. Phase 1 of the shops-inside-Fayr work.
//
// ── WHAT THIS SCREEN DOES NOT DO, SAID FIRST BECAUSE IT MATTERS MORE ────────
//
// It reads no orders. It decides nothing about money and it moves no task
// forward.
//
// THE BAR NOW TELLS THEM WHAT WE MAKE OF THE PAGE, and that is the whole of
// Phase 2. It carries the campaign's SEARCH KEYWORD — the hand-written phrase a
// person types, not the catalogue's product name — and says right, wrong or
// nothing at all, worked out from the page's own title.
//
// IT IS A HINT AND NEVER A GATE. Nothing on this screen blocks, hides or
// disables anything on a WRONG. Somebody the bar calls wrong can carry on and
// buy whatever they like, and the shop's page is rendered from exactly one
// condition — whether the saved sign in has been restored — which no verdict can
// reach. Everything that touches money is decided later, on the server, from the
// order itself.
//
// It also does not claim a purchase and does not claim a failure. Somebody who
// cancels a payment and comes back must look exactly like somebody who completed
// one, because from inside this screen those two are the same event.
//
// ── EVERY DECISION IS NEXT DOOR ─────────────────────────────────────────────
//
// src/shop/insideFayr.js is pure and is walked under node: which shops shop
// inside Fayr, where a session lands, what the view may load, and whether an
// "active" event is somebody coming back from a payment app. This file is the
// wiring. Same split as ui/shopApp.js and openShop.js.
//
// ── AND IT REBUILDS NOTHING ConnectScreen ALREADY PROVED ────────────────────
//
// ConnectScreen.js is frozen, so its web view cannot be shared — but what it
// learned can be, and every prop below that looks like a detail is there for a
// measured reason its own comments give. The session is restored BEFORE the view
// exists, because a view that has already made its cookie store cannot be
// signed in afterwards. It is saved again on load end AND on navigation,
// because a single-page sign in authenticates without a full page load and the
// only snapshot ever written was otherwise the one from before. sharedCookies,
// thirdPartyCookies, domStorage and cache are what make a sign in survive a
// relaunch. onError and onHttpError are what stop the web view library's own
// untranslated error panel reaching somebody. containerStyle replaces the
// library default and both of its parts matter, or nothing scrolls.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Linking, Platform, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import * as campaignStore from '../backend/campaignStore';
import { PLATFORMS } from '../platforms';
import { markConnected } from '../backend/connectedShops';
import { reportShopSignIn } from '../backend/shopApi';
import { LOOKED_FOR_THE_ORDER, SIGNED_IN, markVisitedShop } from '../journey/shopVisits';
import { countdownFor } from '../journey/theNotice';
import { getAuthoritative, getTaskId, subscribe } from '../taskStore';
// THE ONE FACT THIS SCREEN TELLS OUR SIDE — the key of the order it watched
// being placed — goes by the existing device-evidence route, with its outbox
// and its retry, and by nothing new. See theWatchedOrder.js for what is sent.
import { syncEvidence } from '../backend/evidenceSync';
// READ-ONLY, FROM A FROZEN FILE: how each shop names an order's own page, as
// measured. Nothing about the read is called; one shape is looked up and handed
// to theOrderPage.js, which puts the number in it. See that file's header.
import { howThisShopNamesAnOrder } from '../order/detailLook';
import { persistSession, restoreSession } from '../session';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { goBackOrHome } from '../ui/nav';
import {
  anybodyHasMeasured, comingBackFromPaying, schemeOf, shopsInsideFayr,
  userAgentFor, whereToLand, whoOpensThis,
} from './insideFayr';
import {
  cameBackDetail, handoffDetail, logShop, navigationDetail, orderDetail,
  refusedDetail, sessionDetail, signInDetail, signInRecordedDetail,
  untaughtShopDetail, verdictDetail, watchedDetail,
} from './shopLog';
import { whatToTellOurSide, whereToHandOver } from './theWatchedOrder';
import {
  HOW_WE_KNEW_INSIDE_THE_SHOP, nowRememberTheSignInWasUp, shouldRecordTheSignIn,
  watchSignInScript, whatTheShopShowed,
} from './theSignIn';
import { whatThePageIs } from './theRightProduct';
import { theOrderPage } from './theOrderPage';
import { watchTheTitleScript, whatTheTitleWatcherSaid } from './watchTheTitle';
import {
  logMeasure,
  measureTheWholePageScript,
  shouldMeasure,
  whatTheMeasurerSaid,
} from './measureLog';
import { PLACED, whatTheOrderPageSays } from './theOrderPlaced';
import { whatTheBarSays } from './theBar';

/** Not oftener than this, however many times a navigation fires. Cookies go to a file. */
const SAVE_NOT_OFTENER_THAN_MS = 1500;

/**
 * HOW LONG THE BAR SAYS "ORDER PLACED" BEFORE THE SCREEN HANDS OVER.
 *
 * Not a technical delay — nothing is waiting for anything. It is there so the
 * person sees the thing they just did acknowledged before the screen changes
 * under them. A hand-off in the same instant reads as the app losing their
 * place; a second and a half reads as the app noticing.
 */
const LET_THEM_SEE_IT_MS = 1500;

export default function ShopScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = (campaign && campaign.marketplace) || params.marketplace || null;
  const platform = key ? PLATFORMS[key] : null;

  // TWO DIFFERENT STRINGS, AND THEY DO TWO DIFFERENT JOBS.
  //
  // `productName` is the catalogue's name for the thing. It is NEVER shown here;
  // it is what the page's title is compared against, because a title is written
  // about the product and not about anybody's search.
  //
  // `searchKeyword` is the hand-written phrase a person types into the shop's
  // search box, and it is what the bar carries. It is not derived from the
  // product name and never falls back to it — see theBar.js.
  const productName = campaign
    ? campaign.productName || campaign.title || null
    : params.productName || null;
  const searchKeyword = campaign ? campaign.searchKeyword : null;

  // ── THE SECOND OF THE TWO GUARDS ON WHICH SHOPS COME HERE ─────────────────
  //
  // The FIRST is the branch at the call site — src/screens/buyinterstitial.js
  // asks shopsInsideFayr() and only a listed shop is sent this way. This is the
  // second, and it is here because a guard at one call site is a guard until
  // somebody adds a second call site.
  //
  // whereToLand() refuses an unlisted shop on its own, so an unlisted shop has
  // no address at all and this screen has nothing to show. Amazon cannot
  // accidentally appear inside a web view; it gets the dead end below, which is
  // a developer's mistake being made visible rather than a person's problem.
  // ── TWO WAYS IN: SHOPPING, OR ONE ORDER'S OWN PAGE — PHASE 7 ────────────
  //
  // `land: 'order'` with an `orderKey` is the review step's door: the review is
  // on the clipboard and this view opens on THAT order's page, where they rate,
  // paste and submit. Everything else is a shopping session and lands exactly
  // where 6A said — the product page or the shop's front door, never an order
  // list. The two are different journey steps with opposite needs, so the
  // second is its own landing kind rather than a loosening of the first.
  //
  // ── THE KEY, NOT THE NUMBER — CORRECTED 19 SEPTEMBER 2026, PHASE 8A ─────
  //
  // Phase 7 built this page from `task.order.id`, the order NUMBER the page
  // prints (JKLIKGSNS48449). A Zepto order's page is addressed by the UUID in
  // its link (01a0b4d7-…), which is a different string, so the door opened on
  // a page that does not exist. The record now carries that key — the one the
  // phone read off the confirmation address — and the caller hands it in. With
  // no key there is no order page to land on honestly, so the session is an
  // ordinary shopping one: the front door, never an invented address.
  const landingOnAnOrder = params.land === 'order'
    && typeof params.orderKey === 'string' && params.orderKey !== '';
  const orderUrl = landingOnAnOrder
    ? theOrderPage(howThisShopNamesAnOrder(key), params.orderKey)
    : null;
  const landing = useMemo(
    () => whereToLand(key, {
      orderUrl,
      productUrl: campaign ? campaign.productUrl : null,
      // READ OFF THE FROZEN platforms.js AND HANDED IN. insideFayr.js holds no
      // shop address of its own, which is how it cannot disagree with the file
      // the reader uses. See the note at the top of it.
      startUrl: platform ? platform.startUrl : null,
    }),
    [key, campaign, platform, orderUrl],
  );

  // ── THE RECORD, WATCHED, FOR THE CLOCK ON THE BAR ───────────────────────
  //
  // THE OWNER ASKED FOR "the 30 minute slot ... visible from the moment of the
  // claim, including inside the shop view." THIS BAR SHOWS THE TWO HOUR HOLD,
  // NOT THAT — said plainly rather than smoothed over. The claim now records
  // its shop visit the moment it succeeds, and the server's own rule is that
  // that tap SPENDS the thirty minutes and starts the two hour hold
  // (shopHoldEndsAt). So by the first frame of this screen the record carries a
  // hold and no claim window left to show; countdownFor reads exactly that —
  // no hold, no clock. It is the same words the bar above the navigation and the
  // buy screen used, ticking every thirty seconds because the count is written
  // in whole minutes. Whether the owner wants the thirty minutes shown as well
  // is his call, and is in the report.
  const [task, setTask] = useState(campaignId ? getAuthoritative(campaignId) : null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!campaignId) return undefined;
    const un = subscribe((id) => { if (id === campaignId) setTask(getAuthoritative(campaignId)); });
    return un;
  }, [campaignId]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const timeLeft = countdownFor(task, now);

  // Restore the saved cookies BEFORE the view creates its store, so somebody who
  // has signed in to this shop before is already signed in here. Save again on
  // the way out.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    if (!landing || !platform) return undefined;
    let alive = true;
    restoreSession(platform.key, platform.startUrl).finally(() => {
      if (alive) setSessionReady(true);
    });
    return () => {
      alive = false;
      persistSession(platform.key, platform.startUrl);
    };
  }, [landing, platform]);

  const lastSaveAt = useRef(0);
  const saveSession = useCallback(() => {
    if (!platform) return;
    const now = Date.now();
    if (now - lastSaveAt.current < SAVE_NOT_OFTENER_THAN_MS) return;
    lastSaveAt.current = now;
    persistSession(platform.key, platform.startUrl);
  }, [platform]);

  // THE FIRST LINE OF THE LOG, written once when the session really starts.
  const said = useRef(false);
  useEffect(() => {
    if (said.current || !landing) return;
    said.current = true;
    logShop('SESSION STARTED', sessionDetail({
      shop: key, campaignId, productName, keyword: searchKeyword,
      land: landing.kind, url: landing.url,
    }));
  }, [landing, key, campaignId, productName, searchKeyword]);

  // ── SIGNING IN, IN THIS SAME VIEW, WITHOUT LEAVING IT ─────────────────────
  //
  // MEASURED 18 SEPTEMBER 2026: the owner reached the CONNECT web view, landed
  // on Zepto's order list, and never reached this screen at all. Two web views,
  // and the one he got was the one he could not buy in. For these three shops
  // there is now one view: if they are not signed in, the shop's own login comes
  // up in front of them here, on the shop's own page, and they carry on.
  //
  // EVERY QUESTION ASKED OF THE PAGE IS THE CONNECT FLOW'S, IMPORTED AND NOT
  // COPIED — see theSignIn.js, which holds the three imports and no pattern of
  // its own. src/connect/ and src/ConnectScreen.js are untouched.
  //
  // AND NOTHING HERE COVERS, BLOCKS OR REDIRECTS ANYTHING. The connect screen
  // puts a cover over the shop until its gate is sure, because a person there is
  // signing in and nothing else. A person here is buying something, so this
  // watches and records and never once decides what is drawn.
  const signInWasUp = useRef(false);
  const toldOurSide = useRef(false);
  const onShopMessage = useCallback((event) => {
    let msg = null;
    try {
      msg = JSON.parse((event && event.nativeEvent && event.nativeEvent.data) || '');
    } catch (e) {
      return; // not JSON, so not ours. The shop's own postMessage traffic.
    }
    if (!platform) return;
    // ── THE TITLE WATCHER'S REPORT, FIRST, BECAUSE IT IS THE COMMON ONE ────
    //
    // Every change of title or address on a single-page shop arrives here,
    // whether or not the view ever saw a navigation. Each one is written down —
    // THAT LOG IS THE MEASUREMENT — and fed to the same two setters the
    // navigation event feeds, so the verdict and the order question are asked
    // of the page they are really on. See watchTheTitle.js.
    // ── THE WHOLE PAGE, FOR A SHOP NOBODY HAS EVER MEASURED — Phase 8B-b ──
    //
    // Blinkit and Instamart have empty order tables, and an address and a title
    // cannot teach a parser the word a page uses for a delivery or a rating.
    // This is the page's own text, written to the console and nowhere else, on
    // a development build only, for the two shops nobody has measured.
    //
    // ANSWERED BEFORE THE TITLE WATCHER because the two carry different keys and
    // a measurement report is not a navigation: it must not set the page title
    // or the last page, or one navigation would be judged twice.
    const measured = whatTheMeasurerSaid(msg);
    if (measured != null) {
      logMeasure(measured);
      return;
    }
    const reported = whatTheTitleWatcherSaid(msg);
    if (reported != null) {
      logShop('THE PAGE REPORTED', navigationDetail({ url: reported.url, title: reported.title }));
      setPageTitle(reported.title);
      setLastPage({ title: reported.title, url: reported.url });
      return;
    }
    const showed = whatTheShopShowed(msg, signInWasUp.current);
    if (showed == null) return;
    signInWasUp.current = nowRememberTheSignInWasUp(showed, signInWasUp.current);
    logShop('THE SHOP\u2019S OWN PAGE SAID', signInDetail(showed));
    if (!shouldRecordTheSignIn(showed, toldOurSide.current)) return;
    toldOurSide.current = true;
    // ── THE SAME THREE THINGS THE CONNECT SCREEN DOES, AND NOTHING WAITS ────
    //
    // The cookies are the sign in; the other two are so that nothing asks this
    // shop for its sign in page AGAIN a few minutes later for another campaign,
    // which is what got Fayr taken for a robot on 9 September 2026.
    //
    // NONE OF IT CAN BLOCK THE PERSON. A report that fails is a number missing
    // from a table we read, not somebody stuck on a shop's page.
    saveSession();
    markConnected(platform.key);
    if (campaignId) markVisitedShop(campaignId, SIGNED_IN);
    reportShopSignIn(platform.key, HOW_WE_KNEW_INSIDE_THE_SHOP);
    logShop('THEY ARE SIGNED IN', signInRecordedDetail({
      shop: key, campaignId, name: showed.accountName,
    }));
  }, [key, campaignId, platform, saveSession]);

  // ── WHAT PAGE THEY ARE ON, AND WHAT WE MAKE OF IT ─────────────────────────
  //
  // The title only, and no injected script at all. The view already reports it,
  // Phase 1 has been logging it since it landed, and nobody has read a product
  // page on any of these three shops with an inspector open — so a selector
  // written today would be a guess wearing a measurement's clothes.
  //
  // ONLY ONCE THE PAGE HAS ACTUALLY LOADED. onNavigationStateChange fires twice
  // for one navigation, and on the first of them the page is still loading and
  // the title is usually the PREVIOUS page's. Judging that one would answer
  // about the page they just left.
  //
  // A SINGLE-PAGE SHOP CHANGES ITS TITLE WITHOUT NAVIGATING, and until
  // 18 September 2026 this note said that was "not worth writing against an
  // imagined problem". It was not imagined: Zepto does it, the verdict sat on
  // one stale title for the owner's whole session, and he did not complete the
  // purchase because the bar could not tell him which product he was on. The
  // tiny script this note once declined to write is watchTheTitle.js, and its
  // every report feeds the same two setters below.
  const [pageTitle, setPageTitle] = useState(null);
  const verdict = useMemo(
    () => (pageTitle == null ? null : whatThePageIs(productName, pageTitle)),
    [productName, pageTitle],
  );

  // ONE LINE PER TITLE, not per render. The log is a list of pages, and the same
  // page repeating itself would bury the page that changed.
  const lastJudged = useRef(null);
  useEffect(() => {
    if (verdict == null || pageTitle == null) return;
    if (lastJudged.current === pageTitle) return;
    lastJudged.current = pageTitle;
    logShop('WHAT WE MAKE OF IT', verdictDetail({ title: pageTitle, ...verdict }));
  }, [verdict, pageTitle]);

  // ── AND WHETHER THE PAGE LOOKS LIKE AN ORDER WAS JUST PLACED ──────────────
  //
  // THE PHONE STILL DECIDES NOTHING ABOUT MONEY. This is a hint exactly as the
  // product verdict is, and what it does is pull a TRIGGER: the bar says so, the
  // screen hands over to the order read that already exists, and THE SERVER
  // decides whether any order matched this campaign. Nothing here reads an
  // order, and nothing in src/shop/ ever will.
  //
  // IT STICKS. `orderSeen` only ever goes from false to true, because the shop
  // navigates on after a confirmation page and the bar must not flick back to a
  // product verdict on the next title. An order that happened does not un-happen.
  const [orderSeen, setOrderSeen] = useState(false);
  // ── AND THE KEY IN ITS ADDRESS, KEPT ONCE AND TOLD ONCE — PHASE 8A ──────
  //
  // MEASURED 18 SEPTEMBER 2026: the confirmation is /order/status/<uuid>, and
  // that uuid is the phone's one handle on THAT order. The first key seen is
  // kept for the session, and every key is told to our side exactly once, by
  // the same untrusted device-evidence route every other fact travels. Our side
  // keeps the first key it hears, so a repeat that slips past costs nothing.
  // The decision of what to send, and whether, is theWatchedOrder.js.
  const [orderKey, setOrderKey] = useState(null);
  const toldKeys = useRef(new Set());
  const told = useRef(Promise.resolve(null));
  const [lastPage, setLastPage] = useState({ title: null, url: null });
  const lastOrderJudged = useRef(null);
  useEffect(() => {
    if (lastPage.title == null && lastPage.url == null) return;
    const mark = `${lastPage.url || ''}|${lastPage.title || ''}`;
    if (lastOrderJudged.current === mark) return;
    lastOrderJudged.current = mark;
    const out = whatTheOrderPageSays(key, lastPage);
    logShop('ORDER?', orderDetail({ ...out, title: lastPage.title, url: lastPage.url }));
    // ── AND LOUDLY, ON EVERY PAGE, FOR A SHOP NOBODY HAS MEASURED ──────────
    //
    // Blinkit and Instamart are inside Fayr from 18 September 2026 with empty
    // order tables. This is the only way those tables can ever be filled in:
    // the first person to buy something on either shop inside this screen walks
    // past their confirmation page, and this writes its real title and real
    // address down as they do. See untaughtShopDetail.
    if (!anybodyHasMeasured(key)) {
      logShop('NOTHING MEASURED FOR THIS SHOP', untaughtShopDetail({
        shop: key, title: lastPage.title, url: lastPage.url,
      }));
    }
    if (out.said === PLACED) setOrderSeen(true);
    if (out.orderKey != null) {
      setOrderKey((have) => (have == null ? out.orderKey : have));
      const tell = whatToTellOurSide({
        said: out.said, orderKey: out.orderKey, alreadyTold: toldKeys.current,
      });
      const taskId = campaignId ? getTaskId(campaignId) : null;
      if (tell != null && taskId) {
        toldKeys.current.add(out.orderKey);
        // THE ONE POST, AND ITS ANSWER WRITTEN DOWN. syncEvidence applies our
        // side's record on success and parks the body for the next foreground
        // on any failure — so the key is never lost, and the hand-off below
        // waits for this to settle before it moves.
        told.current = Promise.resolve(syncEvidence(taskId, tell.body))
          .then((sent) => {
            logShop('THE ORDER WAS WATCHED', watchedDetail({
              campaignId, told: sent && sent.ok ? 'yes' : 'queued',
            }));
            return sent;
          })
          .catch(() => {
            logShop('THE ORDER WAS WATCHED', watchedDetail({ campaignId, told: 'queued' }));
            return null;
          });
      }
    }
  }, [key, lastPage, campaignId]);

  const bar = whatTheBarSays({
    // THE PRODUCT NAME, ALWAYS, since 18 September 2026 — the owner stopped a
    // real purchase because the bar did not say which product the verdict was
    // about. See the top of theBar.js for the reversal and what it keeps.
    productName,
    keyword: searchKeyword,
    verdict: verdict ? verdict.verdict : null,
    orderPlaced: orderSeen,
    shopName: platform ? platform.name : null,
  });

  // ── THE HAND-OFF, AND IT HAPPENS ONCE ─────────────────────────────────────
  //
  // LookingForItScreen already does the whole job: it opens the shop's own list
  // of recent orders inside the web view the person is signed in to, opens the
  // order pages, sends their text to the server, and moves on to
  // IsThisYourOrder or back to the journey on the server's answer. It is not
  // copied and not read from here — it is navigated to. (Phase 6A did change
  // it, with the owner's approval, to press "Load More"; nothing in THIS file
  // reaches into it.)
  //
  // `replace` AND NOT `navigate`, because coming back to a shop screen whose
  // session has already been handed on is a way to run the read twice.
  //
  // AND `handedOver` IS A REF AND NOT STATE, on purpose: a shop that navigates
  // twice through a confirmation page would set state twice before a re-render,
  // and two reads for one purchase is exactly what this guard is for.
  const handedOver = useRef(false);
  useEffect(() => {
    if (!orderSeen || handedOver.current) return undefined;
    if (!campaignId) return undefined;
    const t = setTimeout(() => {
      // THE FLAG IS SET WHEN THE MOVE HAPPENS, not when the timer is armed —
      // corrected 19 September 2026. The key arrives in the same judgement as
      // the order, but as its own piece of state, so this effect may re-run
      // once before the pause is over; a flag set on arming would have made
      // that re-run return early and the hand-off never happen. `leave` still
      // reads the flag, and a tap inside the pause still hands over at once.
      if (handedOver.current) return;
      handedOver.current = true;
      // WHERE TO, DECIDED NEXT DOOR — PHASE 8A. With a key: Fayr's own task
      // page, whose step for a watched order is the read of that one page,
      // once our side has been told. Without one: the list read, exactly as
      // before, with the note written before the move so a journey that
      // comes straight back knows. See LOOKED_FOR_THE_ORDER in shopVisits.js.
      const handOff = whereToHandOver({ orderKey });
      Promise.resolve(told.current).then(() => {
        logShop('HANDING OVER', handoffDetail({ to: handOff.to, campaignId }));
        if (handOff.writesTheLookedNote) markVisitedShop(campaignId, LOOKED_FOR_THE_ORDER);
        navigation.replace(handOff.to, { campaignId });
      });
    }, LET_THEM_SEE_IT_MS);
    return () => clearTimeout(t);
  }, [orderSeen, orderKey, campaignId, navigation]);

  // ── GOING TO PAY, AND COMING BACK ─────────────────────────────────────────
  //
  // Recorded and nothing else. The moment of the hand-off is kept here because
  // it is the one input the app-wide return decision in foregroundRefresh.js
  // cannot have, and it is what keeps the notification shade and the app
  // switcher out of this: with no hand-off recorded, an "active" event is not
  // somebody coming back from a payment app.
  //
  // AND COMING BACK IS THE SAME EVENT AS STAYING — PHASE 8A. Nothing here
  // starts a read or judges a page. MEASURED 18 SEPTEMBER 2026: the page's own
  // report of /order/status/<uuid> arrived four seconds after "CAME BACK", by
  // itself, through the title watcher, and it is that report and only that
  // report which sees the order. Somebody who paid without leaving the app
  // produces the same report at the same moment. There is no second notion of
  // "came back" to keep in step with this one.
  const wentToPayAt = useRef(null);
  useEffect(() => {
    const watcher = AppState.addEventListener('change', (next) => {
      const back = comingBackFromPaying({
        nextState: next, wentToPayAt: wentToPayAt.current, now: Date.now(),
      });
      if (!back) return;
      wentToPayAt.current = null;
      logShop('CAME BACK', cameBackDetail(back));
    });
    return () => watcher.remove();
  }, []);

  /**
   * WHOSE ADDRESS IS THIS TO OPEN — AND THE PART THAT DID NOT EXIST BEFORE.
   *
   * At checkout the shop's page reaches for a payment app with an address the web
   * view cannot load: upi://, intent://, phonepe://, tez://, paytmmp:// and
   * others nobody has measured. Unhandled, the person taps Pay and lands nowhere,
   * and that is where this flow died.
   *
   * The DECISION is in insideFayr.js, as a whitelist of what we load, and it is
   * walked under node against every scheme above plus one nobody has seen. The
   * DOING is here: an address that is ours loads as normal; an address that is
   * not is never loaded by the view, is handed to the phone, and is written down
   * with its scheme.
   *
   * NOTHING HERE THROWS. A phone that cannot open a payment app leaves the person
   * exactly where they were, on the checkout page, with the log recording that it
   * refused — which is strictly better than the crash a rejected promise on this
   * path would be.
   */
  const whoLoadsIt = useCallback((request) => {
    const url = (request && request.url) || '';
    if (whoOpensThis(url) === 'us') return true;
    const scheme = schemeOf(url);
    logShop('NOT OURS TO LOAD', refusedDetail({
      url, scheme, topFrame: !!(request && request.isTopFrame),
    }));
    wentToPayAt.current = Date.now();
    logShop('WENT TO PAY', `scheme=${scheme == null ? 'none' : scheme} `
      + `campaign=${campaignId == null ? 'none' : campaignId}`);
    Linking.openURL(url).catch(() => {
      logShop('THE PHONE REFUSED IT', refusedDetail({
        url, scheme, topFrame: !!(request && request.isTopFrame),
      }));
    });
    return false;
  }, [campaignId]);

  const onNav = useCallback((navState) => {
    if (!navState) return;
    logShop('WENT TO', navigationDetail({ url: navState.url, title: navState.title }));
    if (navState.loading === false) {
      const title = typeof navState.title === 'string' ? navState.title : '';
      setPageTitle(title === '' ? null : title);
      // THE ORDER QUESTION GETS THE ADDRESS AS WELL AS THE TITLE, because a shop
      // is as likely to say it in one as the other. The product question only
      // ever gets the title — an address shape for a product page is a thing
      // nobody has measured on these shops.
      setLastPage({
        title: title === '' ? null : title,
        url: typeof navState.url === 'string' ? navState.url : null,
      });
    }
    saveSession();
  }, [saveSession]);

  const onLoadEnd = useCallback(() => { saveSession(); }, [saveSession]);

  // OUT, WITHOUT KILLING THE SESSION. Saved and left — never cleared, because a
  // person who leaves this screen has not signed out of the shop and must not be
  // made to sign in again next time.
  const leave = useCallback(() => {
    saveSession();
    // ── LEAVING IS WHERE FAYR LOOKS, BECAUSE IT WATCHED — PHASE 7 ──────────
    //
    // THE ORDER'S OWN PAGE: they came to rate and paste, so coming back runs
    // the review read. LookingForReview is the read that already exists; it
    // hands back to the journey by itself and the server decides what it saw.
    if (landingOnAnOrder && campaignId) {
      // THE SAME ONE PAGE, READ AGAIN — PHASE 8A. The order landing exists only
      // for an order Fayr watched, so the read on the way back is the read of
      // that one page: LookingForIt opens it, posts its text, and the server
      // reads the rated signal off it. Phase 7 sent this to LookingForReview,
      // which walks a shop's public review list — a thing these shops do not
      // have, so it looked at nothing and handed back.
      logShop('HANDING OVER', handoffDetail({ to: 'LookingForIt', campaignId }));
      navigation.replace('LookingForIt', { campaignId });
      return;
    }
    // A SHOPPING SESSION WITH NO ORDER ON THE RECORD YET: the read runs. The
    // owner: "a session ending with no detection still runs the read when they
    // come back to Fayr." Zepto's order-placed phrases are guessed, so this is
    // the path a real purchase takes when they never fire — and a person who
    // only browsed gets a read that finds nothing and the fallback the journey
    // offers after one. The note says a read has run, so "we have not looked
    // yet" and "we looked and found nothing" stay two different facts.
    //
    // AND A BACK TAP INSIDE THE SECOND AND A HALF AFTER "ORDER PLACED" IS NOT
    // A WAY TO LOSE THE READ — corrected 18 September 2026. The order-placed
    // effect marks handedOver before its timer fires, so a back tap in that
    // window used to skip this branch, fall to goBackOrHome, and unmount the
    // timer with it: the purchase acknowledged on the bar and nothing read.
    // Found by an adversarial review. So an order seen is handed over NOW,
    // whatever the timer was about to do.
    const claimed = task && !task.order;
    if (claimed && campaignId && (orderSeen || !handedOver.current)) {
      handedOver.current = true;
      // THE SAME DECISION THE TIMER MAKES — one place says where an order that
      // was seen goes, so a tap and the pause cannot disagree. See above.
      const handOff = whereToHandOver({ orderKey });
      logShop('HANDING OVER', handoffDetail({ to: handOff.to, campaignId }));
      if (handOff.writesTheLookedNote) markVisitedShop(campaignId, LOOKED_FOR_THE_ORDER);
      navigation.replace(handOff.to, { campaignId });
      return;
    }
    goBackOrHome(navigation);
  }, [saveSession, navigation, landingOnAnOrder, campaignId, task, orderSeen, orderKey]);

  // A shop that does not shop inside Fayr, or a campaign with nowhere honest to
  // go. Nothing is invented to fill the hole and no shop page is shown.
  if (!landing || !platform) {
    return (
      <SafeAreaView style={styles.dead} edges={['top', 'bottom']}>
        <Text style={styles.deadText}>
          This shop is not one Fayr opens inside itself yet.
        </Text>
        <TouchableOpacity onPress={leave} style={styles.deadBack} activeOpacity={0.8}>
          <Text style={styles.deadBackText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // THE DESIGN'S OWN GREEN AND RED, and the shop's own colour for the two states
  // that claim nothing. Read off ui/theme.js rather than written here, so the bar
  // cannot drift from the rest of the app's palette.
  const barColour = bar.tone === 'good'
    ? COLOR.greenDeep
    : bar.tone === 'bad'
      ? COLOR.red
      : platform.color;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* THE BAR, AND IT IS OURS. Above the shop's page, on screen for the whole
          session, carrying the search KEYWORD so nobody has to remember it —
          and with no copy control, because the owner took the design's one away
          on purpose and the person types it. The only other thing on it is the
          way out, which this bar has to carry because the screen draws no
          header.

          ITS COLOUR IS THE ONLY THING THE VERDICT CHANGES. Green for yes, red
          for no, and the shop's own colour for both states that claim nothing —
          which is what keeps "cannot tell" from looking like either answer. */}
      <View style={[styles.bar, { backgroundColor: barColour }]}>
        <TouchableOpacity
          onPress={leave}
          activeOpacity={0.8}
          style={styles.back}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.barWords}>
          {/* THE PRODUCT, FIRST AND LARGEST. Reversed from Phase 2 on the
              owner's own run of 18 September 2026 — see theBar.js. */}
          {bar.product ? (
            <Text style={styles.barProduct} numberOfLines={2}>{bar.product}</Text>
          ) : null}
          {bar.keyword ? (
            <Text style={styles.barKeyword} numberOfLines={1}>{bar.keyword}</Text>
          ) : null}
          <Text style={styles.barLine} numberOfLines={2}>{bar.line}</Text>
          {/* THE CLOCK, off the record and only when the record has one. */}
          {timeLeft ? (
            <Text style={styles.barClock} numberOfLines={1}>⏰ {timeLeft}</Text>
          ) : null}
        </View>
      </View>

      {!sessionReady ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={platform.color} />
        </View>
      ) : (
        <WebView
          source={{ uri: landing.url }}
          // ONE PLACE DECIDES WHAT LOADS, and it is the whitelist. The origin
          // list stays open on purpose so it cannot quietly become a second
          // opinion about an address that the whitelist has already answered.
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={whoLoadsIt}
          onNavigationStateChange={onNav}
          onLoadEnd={onLoadEnd}
          // ── THE CONNECT FLOW'S OWN WATCHER, IN THE SHOPPING VIEW ────────
          //
          // The same string the connect screen injects, taken from the same
          // frozen file by way of theSignIn.js. It asks the page whether a sign
          // in box is up, whether a way in or a way out is on it, and what the
          // header says, twice in a row before it speaks. It writes nothing,
          // types nothing and submits nothing — connect-words.spec.ts reads
          // that file from disk and refuses every one of those shapes.
          //
          // UNCONDITIONALLY, AND NOT ONLY ON A SIGN-IN VISIT. The connect
          // screen injects it only when it was opened to sign in, because that
          // is the only reason it is ever open. This screen is open for the
          // whole of somebody's shopping, and the moment a shop decides to ask
          // them to log in is not a moment Fayr chooses or can predict.
          // AND, FOR A SHOP NOBODY HAS MEASURED, THE WHOLE PAGE — Phase 8B-b.
          // The third script is added only when shouldMeasure says so, which is
          // never for Zepto, never for a shop that has been measured, and never
          // in a build a person has. __DEV__ is read here, once, and handed in:
          // the decision itself is pure and lives in measureLog.js.
          injectedJavaScript={
            watchSignInScript() + watchTheTitleScript()
            // eslint-disable-next-line no-undef
            + (shouldMeasure({ key, dev: typeof __DEV__ !== 'undefined' && __DEV__ === true })
              ? measureTheWholePageScript()
              : '')
          }
          onMessage={onShopMessage}
          onError={(e) => logShop('THE SHOP WOULD NOT OPEN',
            `where=onError code=${(e && e.nativeEvent && e.nativeEvent.code) || '?'}`)}
          onHttpError={(e) => logShop('THE SHOP ANSWERED WITH AN ERROR',
            `where=onHttpError status=${(e && e.nativeEvent && e.nativeEvent.statusCode) || '?'}`)}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          cacheEnabled
          javaScriptEnabled
          userAgent={userAgentFor(key, Platform.OS) || undefined}
          // Opaque white so the view never shows through as a black flash while a
          // heavy single-page shop is still loading.
          style={styles.web}
          scrollEnabled
          nestedScrollEnabled
          containerStyle={styles.webBox}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={platform.color} />
            </View>
          )}
          startInLoadingState
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.md,
    paddingVertical: 10,
    gap: SPACE.sm,
  },
  back: { paddingRight: 4 },
  backText: { fontFamily: FONT.bodyMed, fontSize: 28, lineHeight: 30, color: '#fff' },
  barWords: { flex: 1 },
  barProduct: { fontFamily: FONT.bodySemi, fontSize: 14, color: '#fff' },
  barKeyword: { fontFamily: FONT.body, fontSize: 12, color: '#fff', opacity: 0.92, marginTop: 1 },
  barLine: { fontFamily: FONT.body, fontSize: 11.5, color: '#fff', opacity: 0.92, marginTop: 1 },
  barClock: { fontFamily: FONT.bodySemi, fontSize: 11.5, color: '#fff', marginTop: 2 },
  web: { flex: 1, backgroundColor: '#fff' },
  webBox: { flex: 1, overflow: 'hidden', backgroundColor: '#fff' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  dead: {
    flex: 1,
    backgroundColor: COLOR.cream,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  deadText: { fontFamily: FONT.body, fontSize: 15, color: COLOR.ink, textAlign: 'center' },
  deadBack: { paddingHorizontal: SPACE.lg, paddingVertical: 10 },
  deadBackText: { fontFamily: FONT.bodyMed, fontSize: 14, color: COLOR.greenDeep },
});
