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

/** The shortest this is on screen. Below this it reads as a flicker, not a wait. */
export const LEAST_TIME_MS = 1600;

/** The longest, whatever the shop does. Nobody is left on a turning ring. */
export const MOST_TIME_MS = 20000;

export default function LookingForItScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const platformKey = campaign ? campaign.marketplace : null;
  const platform = platformKey ? PLATFORMS[platformKey] : null;

  const motion = useMotion();
  const [line, setLine] = useState(WAIT_LINES[0]);
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
