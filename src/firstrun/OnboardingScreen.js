// Onboarding — fayr-design.browser.jsx:557. Three slides, copy verbatim.
//
// The design's note about the motion is the point of the screen, so it is
// reproduced rather than simplified: this is ONE continuous scene, not three
// pages. Full-bleed artwork; the outgoing shot drifts past the camera
// (scale-up + slide + fade) while the next settles in from the opposite depth.
// The white dome baked into every artwork never moves — it anchors the whole
// journey — and the backdrop colour morphs instead of switching.
//
// Tap or swipe forward; swipe back to revisit. Skip is always available.
import React, { useRef, useState } from 'react';
import {
  Animated, Dimensions, Image, PanResponder, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLOR, FONT } from '../ui/theme';
import { Pill, ProgressDots } from '../ui/brand';
import { ONBOARD_ART } from '../ui/onboardArt';

const SLIDES = [
  {
    bg: '#8BB4F2',
    art: 'earn',
    title: 'Shop the brands you love',
    sub: 'Buy products you already want, from Amazon, Flipkart, Meesho, Blinkit, Zepto & Instamart.',
  },
  {
    bg: '#B776A1',
    art: 'clock',
    title: 'Review what you buy — honestly',
    sub: 'Share what you really think. Good or bad, your honest opinion is what counts.',
  },
  {
    bg: '#D0E995',
    art: 'wallet',
    title: 'Get your refund in your wallet',
    sub: 'Complete a campaign and get up to 100% of your money back.',
  },
];

const SWIPE = 42; // the design's threshold, unchanged
const { width: SCREEN_W } = Dimensions.get('window');

export default function OnboardingScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  // One driver for both the artwork depth and the backdrop morph, so they can
  // never fall out of step.
  const pos = useRef(new Animated.Value(0)).current;

  const goTo = (next) => {
    setI(next);
    Animated.timing(pos, {
      toValue: next,
      duration: 950,
      useNativeDriver: false, // backgroundColor interpolation needs the JS driver
    }).start();
  };
  const advance = () => (i < SLIDES.length - 1 ? goTo(i + 1) : onDone && onDone());
  const back = () => i > 0 && goTo(i - 1);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -SWIPE) advance();
        else if (g.dx > SWIPE) back();
      },
    }),
  ).current;

  const bg = pos.interpolate({
    inputRange: SLIDES.map((_, k) => k),
    outputRange: SLIDES.map((s) => s.bg),
  });
  const slide = SLIDES[i];

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.stage, { backgroundColor: bg }]} {...pan.panHandlers}>
        <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={advance}>
          {SLIDES.map((s, k) => {
            // Each slide's depth is a function of how far the deck has moved past
            // it: behind → drifts left and scales up; ahead → waits right, closer.
            const d = pos.interpolate({
              inputRange: [k - 1, k, k + 1],
              outputRange: [1, 0, -1],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={s.art}
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    opacity: pos.interpolate({
                      inputRange: [k - 1, k, k + 1],
                      outputRange: [0, 1, 0],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      { translateX: d.interpolate({ inputRange: [-1, 0, 1], outputRange: [30, 0, -30] }) },
                      { scale: d.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.06, 1, 1.09] }) },
                    ],
                  },
                ]}
              >
                <Image source={{ uri: ONBOARD_ART[s.art] }} style={styles.art} resizeMode="cover" />
              </Animated.View>
            );
          })}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.skip, { top: insets.top + 12 }]}
          activeOpacity={0.85}
          onPress={() => onDone && onDone()}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* The cream shelf with the domed top edge the design draws with an
          elliptical border-radius. RN has no elliptical radii, so this is the
          closest honest equivalent: a wide, shallow rounded top. */}
      <View style={[styles.shelf, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.sub}>{slide.sub}</Text>
        </View>
        <View style={{ flex: 1, minHeight: 16 }} />
        <ProgressDots n={SLIDES.length} i={i} style={{ marginBottom: 16 }} />
        <Pill onPress={advance}>{i < SLIDES.length - 1 ? 'NEXT' : 'GET STARTED'}</Pill>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  stage: { flex: 1, overflow: 'hidden' },
  art: { width: '100%', height: '100%' },
  skip: {
    position: 'absolute', right: 18, zIndex: 40,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  skipText: { fontFamily: FONT.bodyBold, fontSize: 12, color: COLOR.ink2 },
  shelf: {
    backgroundColor: COLOR.cream,
    borderTopLeftRadius: SCREEN_W * 0.5, borderTopRightRadius: SCREEN_W * 0.5,
    marginTop: -22, paddingTop: 32, paddingHorizontal: 30,
    minHeight: 265, justifyContent: 'flex-start',
  },
  title: {
    fontFamily: FONT.displayXBold, fontSize: 30, lineHeight: 33,
    letterSpacing: -0.9, color: COLOR.ink2,
  },
  sub: {
    fontFamily: FONT.bodySemi, fontSize: 14.5, lineHeight: 21,
    color: COLOR.ink2, marginTop: 14, maxWidth: 300,
  },
});
