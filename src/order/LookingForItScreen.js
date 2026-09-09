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
import { getTaskId, refreshFromBackend } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { buildOrderListScript, orderListPageFor, readListOutcome } from '../orderhistory.js';
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

/** The longest, whatever the shop does. Nobody is left on a turning ring. */
export const MOST_TIME_MS = 20000;

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
  const answered = useRef(false);
  const waiting = useRef(null);
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
    const resolve = waiting.current;
    waiting.current = null;
    let payload = null;
    try { payload = JSON.parse(event.nativeEvent.data); } catch (e) { payload = null; }
    setJob(null);
    if (resolve) resolve(payload);
  }, []);

  useEffect(() => {
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

    /** Wait until the screen has been up long enough to have been seen. */
    const settle = () => new Promise((done) => {
      const left = LEAST_TIME_MS - (Date.now() - startedAt);
      if (left <= 0) done();
      else setTimeout(done, left);
    });

    (async () => {
      const taskId = campaignId ? getTaskId(campaignId) : null;
      const page = orderListPageFor(platformKey);

      // NOTHING TO LOOK AT is not an error and is never explained. Some shops
      // keep their list of orders somewhere a page of text cannot reach, and the
      // person is simply asked instead.
      if (!taskId || !page || !platform) {
        await settle();
        if (alive) moveOn('Journey');
        return;
      }

      const answer = await new Promise((resolve) => {
        waiting.current = resolve;
        setJob({ url: page });
      });
      if (!alive) return;

      const outcome = readListOutcome(answer);

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

      if (!outcome.looked) {
        await settle();
        if (alive) moveOn('Journey');
        return;
      }

      // THE TEXT, AND ONLY THE TEXT. The server reads it and decides.
      const sent = await sendFoundOrders(taskId, outcome.blocks);
      await refreshFromBackend();
      await settle();
      if (!alive) return;

      const matched = sent.ok
        ? sent.orders.filter((o) => o && o.matches === true && !o.chosenAt)
        : [];
      moveOn(matched.length > 0 ? 'IsThisYourOrder' : 'Journey');
    })();

    return () => {
      alive = false;
      clearTimeout(giveUp);
      waiting.current = null;
    };
  }, [campaignId, platformKey, platform, moveOn]);

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
      {job ? (
        <WebView
          key={job.url}
          source={{ uri: platform.startUrl }}
          userAgent={platform.userAgent}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScript={buildOrderListScript(job.url)}
          onMessage={onMessage}
          onError={() => onMessage({ nativeEvent: { data: '{"ok":false,"status":0,"html":""}' } })}
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
