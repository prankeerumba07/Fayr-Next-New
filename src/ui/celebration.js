// THE DESIGN'S CELEBRATION BLOCK, AND THE RULE ABOUT MOTION.
//
// MilestoneCelebration is a COMPONENT in the design (fayr-design.browser.jsx:3554),
// not a screen: it takes an eyebrow, a title, an amount, a chip and a sub-line, and
// two of the design's screens compose it — Reward, and OrderVerified.
//
// IT LIVED IN src/RewardScreen.js UNTIL 1 SEPTEMBER 2026, alongside its only caller,
// and that file's own comment said "a second caller is what would earn it a move,
// and there is one". The second caller arrived — src/screens/orderverified.js — so
// it moved here. Nothing about what it draws changed in the move.
//
// PRESENTATIONAL. Every word is handed in, so it cannot state anything of its own,
// and it never works out an amount: a screen that shows money resolves the figure
// through src/ui/refund.js first, which is the chain the payout itself uses.
//
// NO CONFETTI. The design animates fourteen particles. Fourteen absolute views
// animating at once is the highest variance, lowest information part of the most
// watched screen in the app. The badge and the text still arrive, on natively
// driven transforms and opacity only, so nothing can jank the JS thread — and
// reduce motion turns even that off.
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, StyleSheet, Text, View,
} from 'react-native';

import { COLOR, FONT, RADIUS } from './theme';

/**
 * Should anything animate on this phone?
 *
 * Asks once, and defaults to NO motion until the answer arrives — a celebration
 * that ignores the setting is worse than one that arrives plainly.
 */
export function useMotion() {
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => { if (alive) setMotion(!reduce); })
      .catch(() => { if (alive) setMotion(true); });
    return () => { alive = false; };
  }, []);
  return motion;
}

/**
 * The design's celebration block.
 *
 * `motion` is false when the device asks for reduced motion, in which case
 * everything renders at its final value and nothing animates.
 */
export function MilestoneCelebration({ eyebrow, title, amount, chip, sub, motion }) {
  // One driver for the whole entrance: the badge springs, the text follows. Two
  // values rather than six so the stagger cannot drift out of order.
  const badge = useRef(new Animated.Value(motion ? 0 : 1)).current;
  const text = useRef(new Animated.Value(motion ? 0 : 1)).current;

  useEffect(() => {
    if (!motion) return undefined;
    const anim = Animated.sequence([
      Animated.spring(badge, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.timing(text, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [badge, text, motion]);

  const rise = text.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <View style={styles.celebration}>
      <Animated.View style={[styles.badge, { transform: [{ scale: badge }] }]}>
        <Text style={styles.badgeTick}>✓</Text>
      </Animated.View>

      <Animated.View style={{ opacity: text, transform: [{ translateY: rise }] }}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>

        {amount ? (
          <View style={styles.amountRow}>
            <View style={styles.hair} />
            <Text style={styles.amount}>{amount}</Text>
            <View style={styles.hair} />
          </View>
        ) : null}

        {chip ? (
          <View style={styles.chipWrap}>
            <Text style={styles.chip}>{chip}</Text>
          </View>
        ) : null}

        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  celebration: { alignItems: 'center' },
  badge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: COLOR.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  badgeTick: { fontSize: 44, lineHeight: 50, color: '#fff', fontFamily: FONT.displayXBold },

  eyebrow: {
    fontFamily: FONT.display,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: COLOR.refundInk,
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    fontFamily: FONT.displayXBold,
    fontSize: 27,
    color: COLOR.ink,
    textAlign: 'center',
  },

  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 14,
  },
  hair: { height: 1.5, width: 30, backgroundColor: COLOR.greenDeep, opacity: 0.5 },
  amount: {
    fontFamily: FONT.displayXBold,
    fontSize: 30,
    fontStyle: 'italic',
    color: COLOR.greenDeep,
  },

  chipWrap: {
    alignSelf: 'center',
    marginTop: 12,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    borderColor: '#9FD97F',
    backgroundColor: COLOR.refundBg,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  chip: { fontFamily: FONT.displaySemi, fontSize: 12.5, color: COLOR.refundInk },

  sub: {
    fontFamily: FONT.bodyMed,
    fontSize: 13.5,
    lineHeight: 21,
    color: COLOR.sub,
    textAlign: 'center',
    marginTop: 15,
    maxWidth: 300,
  },
});
