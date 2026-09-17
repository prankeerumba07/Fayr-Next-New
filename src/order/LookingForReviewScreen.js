// THE MOMENT AFTER SOMEBODY SAYS THEIR REVIEW IS LIVE.
//
// ── THE SAME SHAPE AS THE ORDER LOOK, FOR THE SAME REASONS ───────────────
//
// A ring, a line that changes, nothing to tap, and it always leaves. Every one of
// those was argued for in src/order/LookingForItScreen.js and none of it is
// re-argued here. What is different is only WHAT is opened: a person's own list
// of reviews instead of their list of orders.
//
// THIS SCREEN MUST NEVER TELL SOMEBODY THEIR SHOP ACCOUNT IS BEING LOOKED AT.
// The owner's rule, and it applies here word for word. The waiting lines come
// from src/ui/funnyWait.js, which has its own check that walks every one of them.
//
// ── WHY THE PROFILE PAGE IS NOT ENOUGH ON ITS OWN ────────────────────────
//
// It lists the words somebody wrote and the link to each review, and it never
// names the PRODUCT. So a read that stopped there could not tell one offer's
// review from another's — which is the entire question. Each review's own page is
// opened, because that is the page that says what it is about. Measured on the
// owner's account, 16 September 2026: four reviews, four permalinks, and the
// product named on each of the four pages and on none of the profile.
//
// ── AND THE PHONE STILL DECIDES NOTHING ──────────────────────────────────
//
// It opens pages and sends TEXT. Whether any of it is this campaign's product,
// and whether the review counts as publicly visible, are both settled on the
// server. There is no field on the way in for either.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, StyleSheet, Text, View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import * as campaignStore from '../backend/campaignStore';
import { getTaskId, refreshFromBackend } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { buildOrderListScript, buildPublicPageScript } from '../orderhistory';
import {
  harvestReviewLinks, readsReviewPages, reviewPageFor, reviewsPageFor,
  theResolvedProfileFrom, theReviewPagesAreDrawn,
} from './detailLook.js';
import {
  LEAST_A_DRAW_CAN_TAKE_MS, anAnswerTag, answerWithStatus, isOurAnswer,
  drawFacts, openOneReviewWith, openTheReviewsWith, readDetailStep, readListStep,
} from './drawnList.js';
import { restoreSession } from '../session';
import { errorTell, logLook } from './lookLog.js';
import { sendFoundReviews } from '../backend/reviewCandidatesApi';
import { useMotion } from '../ui/celebration';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { Screen } from '../ui/primitives';
import { WAIT_LINES, WAIT_LINE_MS, waitLineAt } from '../ui/funnyWait.js';

/**
 * THE ROOM ANOTHER DOORWAY ASK NEEDS BEFORE IT IS WORTH STARTING.
 *
 * A fetch of its own carries LIST_TIMEOUT_MS as its ceiling, so starting one
 * with less than that left buys a timeout and nothing else. Rounded up a little
 * so the answer has somewhere to land as well.
 */
export const LEAST_A_DOORWAY_NEEDS_MS = 6000;

/** The shortest this is on screen. Below it reads as a flicker, not a wait. */
export const LEAST_TIME_MS = 1600;

/** The longest, whatever the shop does. Nobody is left on a turning ring. */
/**
 * FORTY-FIVE, RAISED FROM TWENTY, AND THE ARITHMETIC IS WHY.
 *
 * This read opens the profile page — which has to be DRAWN and is given
 * DRAW_DEADLINE_MS to do it — and then up to MOST_REVIEW_PAGES review pages on
 * top. DRAW_DEADLINE_MS rides on MOST_DETAIL_PAGES, which went from six to ten
 * on 16 September 2026, so the draw alone may now take 13.5 seconds of what was
 * a twenty second budget. That left six and a half seconds for twelve pages.
 *
 * Raised to match the order read next door, which was raised the same day and
 * for the same measured reason.
 */
export const MOST_TIME_MS = 45000;

export default function LookingForReviewScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const platformKey = campaign ? campaign.marketplace : null;
  const platform = platformKey ? PLATFORMS[platformKey] : null;

  const motion = useMotion();
  const [line, setLine] = useState(WAIT_LINES[0]);
  const [job, setJob] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  const answered = useRef(false);
  const waiting = useRef(null);
  const web = useRef(null);
  const answerTag = useRef('');
  const strangers = useRef(0);
  const httpStatus = useRef(200);
  const spin = useRef(new Animated.Value(0)).current;

  // THE SHOP SESSION, PUT BACK BEFORE ANYTHING IS ASKED OF THE SHOP. Same rule
  // and same reason as the order look: a read that began first would ask as a
  // stranger. And it saves nothing on the way out, for the reason recorded
  // there — a look can end on a sign in wall, and writing that over a good
  // login would sign somebody out of their own shop.
  useEffect(() => {
    let alive = true;
    if (!platform) { setSessionReady(true); return undefined; }
    restoreSession(platform.key, platform.startUrl).finally(() => {
      if (alive) setSessionReady(true);
    });
    return () => { alive = false; };
  }, [platform]);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setLine(waitLineAt(Date.now() - startedAt));
    }, WAIT_LINE_MS);
    return () => clearInterval(id);
  }, []);

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
  const moveOn = useCallback(() => {
    if (answered.current) return;
    answered.current = true;
    // REPLACES ITSELF, so nobody can come back to a wait that is already over.
    // AND IT HANDS BACK TO THE JOURNEY rather than naming a screen: the journey
    // works its own step out from the record, which has just changed if the
    // server matched anything. A screen naming the next screen is a second
    // opinion about where somebody is.
    //
    // ── AND IT SAYS THAT IT RAN, WHICH IS ONE WORD AND NOT A DECISION ─────
    //
    // REVIEW-FLOW-PROMPT.md asks for two different screens after this: step
    // seventeen, where a look has just come back empty and the screen says so
    // knowing when they posted it, and step twenty, where somebody opens the app
    // days later and must not be shown the first-time message again.
    //
    // The difference between them is exactly "a look has just handed back", and
    // this is the only place that knows it. It says nothing about what the look
    // FOUND — that is the record's business and the record has already been
    // refreshed above — so it cannot be mistaken for an answer about a review.
    navigation.replace('Journey', { campaignId, reviewLookRan: true });
  }, [navigation, campaignId]);

  const onMessage = useCallback((event) => {
    let payload = null;
    try { payload = JSON.parse(event.nativeEvent.data); } catch (e) { payload = null; }
    if (!isOurAnswer(payload, answerTag.current)) {
      strangers.current += 1;
      return;
    }
    const resolve = waiting.current;
    waiting.current = null;
    if (resolve) resolve(answerWithStatus(payload, httpStatus.current));
  }, []);

  const givenUpOn = useCallback(() => {
    const resolve = waiting.current;
    waiting.current = null;
    if (resolve) resolve(null);
  }, []);

  useEffect(() => {
    if (!sessionReady) return undefined;
    let alive = true;
    const startedAt = Date.now();
    const giveUp = setTimeout(() => { if (alive) moveOn(); }, MOST_TIME_MS);
    const whatIsLeft = () => MOST_TIME_MS - (Date.now() - startedAt);
    const settle = () => new Promise((done) => {
      const left = LEAST_TIME_MS - (Date.now() - startedAt);
      if (left <= 0) done(); else setTimeout(done, left);
    });

    (async () => {
      const taskId = campaignId ? getTaskId(campaignId) : null;
      let pageNumber = 0;
      const aFreshName = () => {
        pageNumber += 1;
        answerTag.current = anAnswerTag(pageNumber, Math.random());
        return answerTag.current;
      };
      const openWith = (next) => new Promise((resolve) => {
        if (next.uri == null) {
          if (!web.current) { resolve(null); return; }
          waiting.current = resolve;
          web.current.injectJavaScript(next.script);
          return;
        }
        waiting.current = resolve;
        setJob(next);
      });

      const theProfile = platform && readsReviewPages(platformKey)
        ? openTheReviewsWith(platformKey, platform.startUrl, startedAt, aFreshName())
        : null;

      // NOTHING TO LOOK AT is not an error and is never explained. A shop whose
      // reviews nobody has measured is simply a shop this cannot read.
      if (!taskId || !theProfile || !platform) {
        await settle();
        if (alive) moveOn();
        return;
      }

      // ── THE DOORWAY IS ASKED MORE THAN ONCE, BECAUSE ONE ASK IS NOT A FACT ─
      //
      // This read is not opened for its BODY. Amazon refuses the signed in body
      // of the profile (see below); what it is opened for is the ADDRESS it
      // redirects to, which names the account and is the whole input to the
      // public read that follows. A refusal still carries that address.
      //
      // A fetch that fails OUTRIGHT carries nothing — status 0, no address, and
      // then nothing downstream can run. That happened on 17 September 2026 on a
      // run whose predecessor had been a clean 400 with the address on it, so it
      // is a thing that comes and goes rather than a thing that is true. It is
      // asked again instead of ending the look.
      //
      // THE SECOND ASK IS INJECTED, NOT NAVIGATED. The view is already sitting
      // on the shop's front door after the first, and re-pointing it at the same
      // address does not reload it — so the script would never run and the wait
      // would hang to the ceiling. Same reason the order look injects its later
      // fetches. See openWith: a job with no uri goes into the page already open.
      const DOORWAY_TRIES = 3;
      const doorway = reviewsPageFor(platformKey);
      let answer = null;
      let outcome = null;
      let html = '';
      let ids = [];
      let resolved = null;
      for (let go = 1; go <= DOORWAY_TRIES; go += 1) {
        if (!alive) return;
        let job = theProfile;
        if (go > 1) {
          if (doorway == null) break;
          const again = aFreshName();
          job = {
            uri: null, script: buildOrderListScript(doorway, again), drawn: false, tag: again,
          };
        }
        answer = await openWith(job);
        if (!alive) return;
        outcome = readListStep(job, answer);
        html = answer && typeof answer.html === 'string' ? answer.html : '';
        ids = harvestReviewLinks(html, platformKey);
        resolved = theResolvedProfileFrom(platformKey, answer && answer.url);

        // COUNTS AND STATUS WORDS ONLY, as everywhere else: `bytes` is the
        // page's length and never the page, and a review id is never logged.
        // `err` is the fetch's own message — "timed out", a TypeError — which is
        // the shop's or the phone's words about the request and carries nothing
        // of whose request it was. Without it a status of 0 said nothing at all.
        const drewIt = drawFacts(answer);
        logLook('reviews', `go=${go} status=${answer && answer.status} `
          + `bytes=${html.length} looked=${outcome.looked} `
          + `whyNot=${outcome.whyNot} wantsSignIn=${outcome.wantsSignIn} `
          + `landed=${outcome.landed == null ? 'null' : outcome.landed} `
          + `named=${resolved != null} `
          + `drawn=${job.drawn} drew=${drewIt.drew} settled=${drewIt.settled} `
          + `waited=${drewIt.waited} looks=${drewIt.looks} `
          + `found=${ids.length} `
          + `err=${answer && answer.error ? `"${String(answer.error).slice(0, 60)}"` : 'null'}`
          + ((answer && answer.status === 200) ? '' : ` ${errorTell(html)}`));

        if (ids.length > 0 || resolved != null) break;
        // Nothing to show and nothing to go on. Another ask needs room to land.
        if (whatIsLeft() < LEAST_A_DOORWAY_NEEDS_MS) break;
      }

      // ── REFUSED WITH A SIGN IN ATTACHED, SO ASK AGAIN WITHOUT ONE ────────
      //
      // MEASURED 17 September 2026 on the owner's own account. Amazon answers
      // the signed in read of his own profile with its automation notice — 400,
      // 2163 bytes, and the line above says apiblock=1 — and answers the SAME
      // address with no sign in attached 200, 345616 bytes, all four review
      // links in it, the one we want among them.
      //
      // A person's reviews are PUBLIC; that is what a review is. The sign in
      // buys nothing on this page and is the whole of what the refusal is
      // about, so the second ask drops it. Nothing is guessed and nothing is
      // typed: the address is the one the first read was REDIRECTED to, which
      // arrives even when the body is refused.
      if (ids.length === 0 && resolved != null) {
        const tag = aFreshName();
        const again = {
          uri: null, script: buildPublicPageScript(resolved, tag), drawn: false, tag,
        };
        const open = await openWith(again);
        if (!alive) return;
        const said = readListStep(again, open);
        const strangerHtml = open && typeof open.html === 'string' ? open.html : '';
        const strangerIds = harvestReviewLinks(strangerHtml, platformKey);
        logLook('reviews-public', `status=${open && open.status} `
          + `bytes=${strangerHtml.length} looked=${said.looked} `
          + `whyNot=${said.whyNot} found=${strangerIds.length} `
          + `err=${open && open.error ? `"${String(open.error).slice(0, 60)}"` : 'null'}`
          + ((open && open.status === 200) ? '' : ` ${errorTell(strangerHtml)}`));
        if (strangerIds.length > 0) {
          html = strangerHtml;
          ids = strangerIds;
        }
      }

      const drawn = theReviewPagesAreDrawn(platformKey);
      const pages = [];
      for (let i = 0; i < ids.length; i += 1) {
        if (!alive) return;
        const url = reviewPageFor(platformKey, ids[i]);
        if (url == null) continue;
        // WE DO NOT START A PAGE WE HAVE ALREADY LOST. Below this there is not
        // enough of the look left for any page to be called drawn, so opening
        // one buys a deadline and one more request asked of a shop for nothing.
        if (drawn && whatIsLeft() < LEAST_A_DRAW_CAN_TAKE_MS) break;

        const next = openOneReviewWith(
          platformKey, url, Date.now(), aFreshName(),
          drawn ? whatIsLeft() : undefined,
        );
        const one = await openWith(next);
        if (!alive) return;
        const detail = readDetailStep(next, one);
        logLook('review', `n=${i + 1} status=${one && one.status} `
          + `bytes=${(one && typeof one.html === 'string' ? one.html.length : 0)} `
          + `looked=${detail.looked} whyNot=${detail.whyNot}`);

        // ANY REFUSAL STOPS THE WHOLE LOOK. A dead end or a puzzle on one page
        // means the shop is done with us for now, and carrying on down the list
        // is what gets an account blocked.
        if (detail.wantsSignIn === true || detail.whyNot != null) break;
        if (!detail.looked) continue;

        pages.push(detail.text);
        const sent = await sendFoundReviews(taskId, pages);
        if (!alive) return;
        logLook('reviewpost', `pages=${pages.length} ok=${sent.ok} `
          + `status=${sent.status} matched=${sent.matched} `
          + `reason=${sent.reason == null ? 'null' : sent.reason} `
          + `why=${sent.why == null ? 'null' : `"${sent.why}"`}`);
        // THE FIRST MATCH ENDS IT. A person cannot write two reviews of one
        // product, so a second match would be the same review reached twice.
        if (sent.ok && sent.matched) break;
      }

      await refreshFromBackend();
      await settle();
      if (alive) moveOn();
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

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.middle}>
        <View style={styles.ring}>
          <Animated.View style={[styles.arc, { transform: [{ rotate: turn }] }]} />
          <Text style={styles.face}>🔎</Text>
        </View>
        <Text style={styles.head}>{line.head}</Text>
        <Text style={styles.small}>{line.small}</Text>
      </View>
      {job ? (
        <WebView
          /* ONE MOUNT FOR THE WHOLE LOOK, for the reason written out next door:
             keying on the address would reload a page before every read. */
          key="the-review-look"
          ref={web}
          source={{ uri: job.uri }}
          userAgent={platform.userAgent}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScript={job.script}
          onMessage={onMessage}
          onLoadStart={() => { httpStatus.current = 200; }}
          onHttpError={(e) => {
            const said = e && e.nativeEvent ? Number(e.nativeEvent.statusCode) : 0;
            httpStatus.current = Number.isFinite(said) ? said : 0;
          }}
          onError={givenUpOn}
          /* NOTHING HERE IS FOR ANYBODY TO READ OR REACH, and it holds somebody's
             own words — so it is out of the reading order as well as invisible. */
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.away}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  ring: {
    width: 110, height: 110, borderRadius: 55, borderWidth: 4,
    borderColor: COLOR.line, alignItems: 'center', justifyContent: 'center',
  },
  arc: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55,
    borderWidth: 4, borderColor: 'transparent', borderTopColor: COLOR.greenDeep,
  },
  face: { fontSize: 40 },
  head: {
    fontFamily: FONT.displaySemi, fontSize: 17, color: COLOR.ink,
    marginTop: 24, textAlign: 'center',
  },
  small: {
    fontFamily: FONT.bodyMed, fontSize: 13, color: COLOR.inkSoft,
    marginTop: SPACE.sm, textAlign: 'center', maxWidth: 280,
  },
  away: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -9999 },
});
