// THE WAITING BOX ON THE HOME PAGE — fayr-design.browser.jsx:3720
// (RotatingStatusCard), put on Home by the design at :1702.
//
// The owner asked for this on 1 September 2026: he must not have to tap My
// Products to find out where a claim stands. The card has been in the design since
// the beginning and had never been built.
//
// WHAT THE DESIGN DRAWS, AND WHAT THIS DRAWS: the same thing. A frosted card
// pinned just above the tab bar, which does not scroll away. A top row with
// "1/3" and a row of dots on the left and the cross on the RIGHT. Then one row you
// can tap: the product picture, the product name in grey, the status in the tone
// colour with the clock beside it in red, and the button on the end. It rotates
// every three and a half seconds when more than one claim is waiting, pauses while
// a finger is down, and hides itself when nothing is waiting.
//
// THREE THINGS ARE OURS, AND ALL THREE ARE BECAUSE THE DESIGN STATES A NUMBER THE
// BACKEND DOES NOT:
//
//  * THE CLOCK IS REAL. The design writes "25m 35s" and "23h 59m" into the file.
//    This reads the claim's own deadline through countdown() and ticks every
//    second, and when the slot runs out it changes what it says instead of sitting
//    at zero, which is the thing the owner objected to before.
//  * THE STATUS IS REAL. The design maps a mock `enrolled[id].step` of 1 to 7.
//    Every word here comes from src/ui/waiting.js, which reads the real record.
//  * THE CAMPAIGN'S OWN STATUS. The owner asked for the product's status and the
//    campaign's status. The design has no room for the second, so a dead shop page
//    gets one extra line under the status. See campaignLineFor.
//
// WHERE TAPPING GOES: the claim's journey, with no step named. The journey works
// out its own step from the same record, which is the resume it already does. A
// second opinion here about which step somebody is on is exactly the defect this
// project keeps finding.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

import * as campaignStore from '../backend/campaignStore';
import { getAuthoritative, getTasks, refreshFromBackend, subscribe } from '../taskStore';
import { COLOR, FONT, RADIUS, SHADOW } from './theme';
import { ProductImage } from './primitives';
import { toneOf } from './stagebits';
import { dismissKeyFor, waitingBoxes } from './waiting.js';

/** How long each claim is shown before the card slides to the next one. */
const ROTATE_MS = 3500;

/**
 * WHICH MESSAGES HAVE BEEN CLOSED, for this run of the app.
 *
 * MODULE LEVEL, NOT SAVED TO THE PHONE, and both halves of that are deliberate.
 *
 * Module level, so closing the box and moving between tabs keeps it closed. The
 * design holds the same thing in its own app state, which behaves the same way.
 *
 * Not saved, because the owner's requirement is that the box IS THERE when he
 * comes back — after thirty four minutes or any time at all. A dismissal saved to
 * the phone would mean a reminder about somebody's money could be switched off for
 * good by one tap, and a reminder that comes back after a restart is the far
 * kinder mistake of the two.
 *
 * KEYED PER MESSAGE, NOT PER CLAIM. See dismissKeyFor in waiting.js: closing "go
 * and buy it" silences that sentence about that claim and nothing else, so the
 * same claim reaching "show us your review" draws a new box.
 */
const closed = new Set();

/** Read every claim the store knows about, newest first, from the record. */
function readTasks() {
  return Object.keys(getTasks())
    .map((campaignId) => getAuthoritative(campaignId))
    .filter(Boolean);
}

export default function WaitingBox({ navigation }) {
  const tabBarHeight = useBottomTabBarHeight();
  const [tasks, setTasks] = useState(readTasks);
  const [campaigns, setCampaigns] = useState(() => campaignStore.getAll());
  const [now, setNow] = useState(() => Date.now());
  const [idx, setIdx] = useState(0);
  // Not the Set itself: mutating a Set in place does not tell React anything, so
  // a counter is bumped when something is closed and the render reads the Set.
  const [closedCount, setClosedCount] = useState(closed.size);
  const [paused, setPaused] = useState(false);
  const resumeAt = useRef(null);
  const fade = useRef(new Animated.Value(1)).current;

  // THE RECORD, AND ONLY THE RECORD. Asking the backend again on every arrival is
  // what makes this right after a force quit: the app comes back with nothing in
  // memory, and the list is fetched rather than remembered.
  useEffect(() => {
    const unsub = subscribe(() => setTasks(readTasks()));
    const unCampaigns = campaignStore.subscribe((list) => setCampaigns(list));
    const unfocus = navigation.addListener('focus', () => {
      refreshFromBackend();
      setTasks(readTasks());
      setNow(Date.now());
    });
    refreshFromBackend();
    return () => { unsub(); unCampaigns(); unfocus(); };
  }, [navigation]);

  const boxes = waitingBoxes({ tasks, campaigns, now })
    .filter((b) => !closed.has(dismissKeyFor(b)));
  void closedCount; // read so React redraws when something is closed

  const count = boxes.length;
  const current = count > 0 ? boxes[idx % count] : null;

  // A claim leaving the list must not leave the card pointing past the end.
  useEffect(() => {
    if (idx >= count && count > 0) setIdx(0);
  }, [idx, count]);

  // ONCE A SECOND, WHILE A CLOCK IS RUNNING. Guarded on the visible card's own
  // answer, so a card with no clock is not redrawing for nothing. It re-reads the
  // record each time rather than counting a number down, so a clock left running
  // while the phone slept cannot drift away from the real deadline.
  const ticking = !!(current && current.ticking);
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
      setTasks(readTasks());
    }, 1000);
    return () => clearInterval(id);
  }, [ticking]);

  // ROTATION, the design's three and a half seconds, with its fade.
  useEffect(() => {
    if (count <= 1 || paused) return undefined;
    const id = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true })
        .start(() => {
          setIdx((i) => (i + 1) % count);
          Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true })
            .start();
        });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [count, paused, fade]);

  // Hold to read. The design pauses on a finger down and starts again a few
  // seconds after it lifts, so a card cannot slide away mid-sentence.
  const hold = useCallback(() => {
    setPaused(true);
    if (resumeAt.current) clearTimeout(resumeAt.current);
  }, []);
  const letGo = useCallback(() => {
    if (resumeAt.current) clearTimeout(resumeAt.current);
    resumeAt.current = setTimeout(() => setPaused(false), ROTATE_MS);
  }, []);
  useEffect(() => () => {
    if (resumeAt.current) clearTimeout(resumeAt.current);
  }, []);

  const dismiss = useCallback(() => {
    if (!current) return;
    closed.add(dismissKeyFor(current));
    setClosedCount(closed.size);
    setIdx(0);
  }, [current]);

  const act = useCallback(() => {
    if (!current || !current.campaignId) return;
    // NO STEP NAMED. The journey reads the same record and lands on the step this
    // claim is really on, which is the resume it already does.
    navigation.navigate('Journey', { campaignId: current.campaignId });
  }, [current, navigation]);

  // NOTHING WAITING, NOTHING DRAWN. An empty box is noise.
  if (!current) return null;

  const tone = toneOf(current.tone);

  return (
    <View
      style={[styles.holder, { bottom: tabBarHeight + 10 }]}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        {/* TOP ROW: which one of how many, and the cross on the RIGHT. */}
        <View style={styles.topRow}>
          <View style={styles.dotsRow}>
            {count > 1 ? (
              <>
                <Text style={styles.counter}>{(idx % count) + 1}/{count}</Text>
                <View style={styles.dots}>
                  {boxes.map((b, k) => (
                    <TouchableOpacity
                      key={dismissKeyFor(b)}
                      onPress={() => { hold(); setIdx(k); letGo(); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${b.productName || 'this claim'}`}
                      hitSlop={8}
                    >
                      <View
                        style={[
                          styles.dot,
                          k === idx % count && { width: 12, backgroundColor: tone.dot },
                        ]}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={dismiss}
            style={styles.cross}
            accessibilityRole="button"
            accessibilityLabel="Close this reminder"
            hitSlop={10}
          >
            <Text style={styles.crossText}>✕</Text>
          </TouchableOpacity>
        </View>

        <Pressable
          onPress={act}
          onPressIn={hold}
          onPressOut={letGo}
          accessibilityRole="button"
          accessibilityLabel={
            `${current.productName || 'Your claim'}. ${current.status}.`
            + `${current.timer ? ` ${current.timer} left.` : ''} ${current.cta || ''}`
          }
        >
          <Animated.View style={[styles.row, { opacity: fade }]}>
            <ProductImage
              imageUrl={current.imageUrl}
              seed={current.campaignId}
              radius={11}
              style={styles.thumb}
            />
            <View style={styles.middle}>
              <Text style={styles.product} numberOfLines={1}>
                {current.productName || 'Your claim'}
              </Text>
              <View style={styles.statusRow}>
                <Text style={[styles.status, { color: tone.dot }]} numberOfLines={1}>
                  {current.status}
                </Text>
                {current.timer ? (
                  <Text style={styles.timer}>⏰ {current.timer} left</Text>
                ) : null}
              </View>
              <Text style={styles.line} numberOfLines={2}>{current.line}</Text>
              {/* THE CAMPAIGN'S OWN STATUS, only when there is something to say.
                  See campaignLineFor: a dead shop page matters to somebody about
                  to go and buy; a full offer does not, because they have their
                  place already. */}
              {current.campaignLine ? (
                <Text style={styles.campaignLine} numberOfLines={2}>
                  {current.campaignLine}
                </Text>
              ) : null}
            </View>
            {current.cta ? (
              <TouchableOpacity
                onPress={act}
                style={[styles.button, { backgroundColor: tone.dot }]}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={current.cta}
              >
                <Text style={styles.buttonText}>{current.cta}</Text>
              </TouchableOpacity>
            ) : null}
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  holder: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, zIndex: 60 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    ...SHADOW.card,
  },

  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 14, marginBottom: 4,
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  counter: { fontFamily: FONT.displaySemi, fontSize: 10, color: '#9a9b8c' },
  dots: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 5, backgroundColor: '#D6D7C8' },
  cross: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  crossText: { fontSize: 10, color: '#8a8b7f', lineHeight: 12 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  thumb: { width: 44, height: 44 },
  middle: { flex: 1, minWidth: 0 },
  product: {
    fontFamily: FONT.displaySemi, fontSize: 11.5, color: '#8a8b7f', lineHeight: 14,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 1 },
  status: { fontFamily: FONT.displayXBold, fontSize: 14, lineHeight: 18, flexShrink: 1 },
  timer: { fontFamily: FONT.displaySemi, fontSize: 10.5, color: COLOR.red },
  line: {
    fontFamily: FONT.body, fontSize: 10.5, lineHeight: 14, color: COLOR.sub, marginTop: 1,
  },
  campaignLine: {
    fontFamily: FONT.bodySemi, fontSize: 10.5, lineHeight: 14, color: '#B4271B',
    marginTop: 3,
  },

  button: {
    borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 118,
  },
  buttonText: {
    fontFamily: FONT.displaySemi, fontSize: 11.5, color: '#fff', textAlign: 'center',
  },
});

/** Test seam: forget every dismissal. Not used by the app. */
export function forgetDismissals() {
  closed.clear();
}
