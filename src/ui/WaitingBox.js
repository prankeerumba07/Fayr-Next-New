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
//
// TWO THINGS THE OWNER CORRECTED ON 2 SEPTEMBER 2026.
//
//  * WHERE IT SITS. It was drawing itself a whole tab bar too high, so it landed
//    in the middle of the screen instead of just above the bar. The design's own
//    numbers and the measurement are written out in src/ui/waitingPlace.js.
//  * WHAT THE CROSS DOES. His words: "when there is a cross button in the
//    notification box, when I click on it, it should vanish. The box should
//    vanish. It should not show me the next notification. It should clearly
//    vanish." It used to close one MESSAGE, keyed by dismissKeyFor, so closing one
//    showed the next. It now closes the whole box for this run of the app, which
//    is also what the design does: Home holds one `reminderDismissed` flag and
//    `onDismiss` sets it once (:1699).
//
// AND THE EXTRA WORDS ARE GONE. The design's card shows four things: the picture,
// the product's name, the status with its clock, and the button. It has no room
// for a sentence under the status and none for a note about the shop's page, so
// both are dropped from the drawing. The words themselves stay in
// src/ui/waiting.js, where the journey still uses them.
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
import {
  DESIGN_LAYER, DESIGN_SIDE, bottomAboveBar, roomToReserve,
} from './waitingPlace.js';

/**
 * How long each claim is shown before the card slides to the next one.
 *
 * THE DESIGN'S OWN NUMBER, read off RotatingStatusCard at
 * fayr-design.browser.jsx:3733, where the interval is 3500 milliseconds. The
 * owner asked for "every 2 to 3 seconds"; the design says three and a half, and
 * the design wins on a visual decision, so 3500 it is.
 */
const ROTATE_MS = 3500;

/**
 * WHETHER THE BOX HAS BEEN CLOSED, for this run of the app.
 *
 * ONE FLAG FOR THE WHOLE BOX, not one per message, and that is the owner's own
 * correction. It used to be a set keyed by dismissKeyFor, so closing "go and buy
 * it" simply showed the next reminder. He said plainly that is wrong: the cross
 * must make the box vanish.
 *
 * MODULE LEVEL, NOT SAVED TO THE PHONE, and both halves of that are deliberate.
 *
 * Module level, so closing the box and moving between tabs keeps it closed. The
 * design holds the same thing in its own app state — one `reminderDismissed`
 * flag on Home — which behaves the same way.
 *
 * Not saved, because the owner's requirement is that the box IS THERE when he
 * comes back. A dismissal saved to the phone would mean a reminder about
 * somebody's money could be switched off for good by one tap, and a reminder that
 * comes back after a restart is the far kinder mistake of the two.
 */
let boxClosed = false;

/** Read every claim the store knows about, newest first, from the record. */
function readTasks() {
  return Object.keys(getTasks())
    .map((campaignId) => getAuthoritative(campaignId))
    .filter(Boolean);
}

export default function WaitingBox({ navigation, onRoomNeeded }) {
  const tabBarHeight = useBottomTabBarHeight();
  const [tasks, setTasks] = useState(readTasks);
  const [campaigns, setCampaigns] = useState(() => campaignStore.getAll());
  const [now, setNow] = useState(() => Date.now());
  const [idx, setIdx] = useState(0);
  // The flag lives at module level so it survives moving between tabs; this
  // copy is what makes React redraw when it changes.
  const [gone, setGone] = useState(boxClosed);
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

  // EVERY WAITING CLAIM, or none at all once the cross has been used. There is no
  // filtering by message any more: the cross closes the box, not one reminder.
  const boxes = gone ? [] : waitingBoxes({ tasks, campaigns, now });

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

  // THE CROSS. It closes the whole box and nothing takes its place.
  const dismiss = useCallback(() => {
    boxClosed = true;
    setGone(true);
  }, []);

  const act = useCallback(() => {
    if (!current || !current.campaignId) return;
    // NO STEP NAMED. The journey reads the same record and lands on the step this
    // claim is really on, which is the resume it already does.
    navigation.navigate('Journey', { campaignId: current.campaignId });
  }, [current, navigation]);

  // HOW MUCH ROOM THE LIST BEHIND HAS TO LEAVE, told to whoever is drawing it.
  //
  // NOTHING IS EVER PERMANENTLY HIDDEN. The card floats over the list, which is
  // what the design does, so without this the last campaign would be buried for
  // good. The page it sits on adds this much empty room at the end of its list
  // and scrolling to the bottom always brings the last campaign out from under.
  const showing = !!current;
  useEffect(() => {
    if (typeof onRoomNeeded === 'function') onRoomNeeded(roomToReserve(showing));
  }, [onRoomNeeded, showing]);

  // NOTHING WAITING, NOTHING DRAWN. An empty box is noise.
  if (!current) return null;

  const tone = toneOf(current.tone);

  return (
    <View
      // THE DESIGN'S OWN PLACE. See src/ui/waitingPlace.js for the numbers and
      // the measurement of what was wrong before.
      style={[styles.holder, { bottom: bottomAboveBar(tabBarHeight) }]}
      // "box-none", NOT "none", AND THE DIFFERENCE IS THE WHOLE CARD WORKING.
      //
      // This said "none" for a few hours on 2 September 2026 and the owner found
      // it at once: the cross did nothing, and neither did tapping the card. It
      // was a web idiom copied straight across — on a web page "pointer-events:
      // none" on a box with "pointer-events: all" on the child does give you two
      // layers. React Native does not work that way.
      //
      // WHAT THE PHONE ACTUALLY DOES, read out of React Native 0.81.5 itself:
      //
      //   React/Views/RCTView.m:172
      //     self.userInteractionEnabled = (pointerEvents != RCTPointerEventsNone);
      //   React/Views/RCTView.m:180
      //     if (!canReceiveTouchEvents) { return nil; }
      //
      // With "none" the phone switches touches off for this view AND everything
      // drawn inside it, before it ever looks at a child. A child asking for
      // "auto" is never reached, so it cannot undo it. The same file's own
      // description of the modes (Libraries/Components/View/ViewPropTypes.d.ts,
      // around :180) says the two are different values on purpose:
      //
      //   none        the box and everything in it take no touches
      //   box-none    the BOX takes no touches, the things inside it do
      //
      // and RCTView.m:220 is that in one line: "case RCTPointerEventsBoxNone:
      // return hitSubview" — walk the children, hand back the child that was hit,
      // never hand back this box. That IS the design's two layers, so this is the
      // right translation of them and "none" never was.
      //
      // WHAT THIS BUYS, and it is the reason the wrapper exists at all: the card
      // is 12 points in from each edge and the strip it sits in runs the full
      // width. The empty space either side belongs to the campaign list behind,
      // and with box-none a tap there still reaches the campaign.
      pointerEvents="box-none"
    >
      {/* THE DESIGN'S OWN TWO LAYERS, :1699 to :1701: a strip that takes no taps
          of its own and a card inside it that does. The "auto" here is the
          design's own second layer written out. In React Native it is also what a
          view does when nothing is said, so it changes nothing on the phone and is
          kept because it states the intent beside the strip that refuses taps. */}
      <View style={styles.card} pointerEvents="auto">
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
          accessibilityHint={current.line || undefined}
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
              {/* NO SENTENCE UNDER THE STATUS, AND NO NOTE ABOUT THE SHOP'S
                  PAGE. The design's card carries four things and neither of those
                  is one of them. Both sets of words still exist in
                  src/ui/waiting.js and the journey still shows them; this card is
                  the design's card. */}
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
  holder: {
    position: 'absolute', left: 0, right: 0,
    paddingHorizontal: DESIGN_SIDE, zIndex: DESIGN_LAYER,
  },
  card: {
    // The design's own card, :3760: a frosted white at 86 in a hundred, an 18
    // point corner, a half point line, and 10 above and below with 12 at the
    // sides. The design also blurs what is behind it; that needs a native piece
    // this app does not carry, so the white is a little more solid instead, which
    // is the closest honest thing without adding one.
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    ...SHADOW.card,
  },

  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 12, marginBottom: 6,
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  counter: { fontFamily: FONT.displaySemi, fontSize: 10, color: '#9a9b8c' },
  dots: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 5, backgroundColor: '#D6D7C8' },
  // The design's cross: 18 across, round, a faint grey behind it, on the RIGHT.
  cross: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  crossText: { fontSize: 10, color: '#8a8b7f', lineHeight: 12 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  thumb: { width: 44, height: 44 },
  middle: { flex: 1, minWidth: 0 },
  product: {
    fontFamily: FONT.displaySemi, fontSize: 11.5, color: '#8a8b7f', lineHeight: 14,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  status: { fontFamily: FONT.displayXBold, fontSize: 14, lineHeight: 17, flexShrink: 1 },
  timer: { fontFamily: FONT.displaySemi, fontSize: 10.5, color: COLOR.red },

  button: {
    borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 118,
  },
  buttonText: {
    fontFamily: FONT.displaySemi, fontSize: 11.5, color: '#fff', textAlign: 'center',
  },
});

/** Test seam: open the box again. Not used by the app. */
export function forgetDismissals() {
  boxClosed = false;
}
