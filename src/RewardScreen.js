// The payoff — the design's Reward screen (fayr-design.browser.jsx:3601), built on
// its reusable MilestoneCelebration block (:3554).
//
// This is step 16 of the demo, and until now it had no screen. Releasing the
// refund re-rendered the same timeline with one row flipped to "done", and the
// only way to see the result was to switch tabs to Earnings by hand. The money
// moving is the whole product; it deserves a moment.
//
// MilestoneCelebration is a COMPONENT in the design, not a screen — it takes a
// tone, an icon, an eyebrow, a title, an amount, a chip and a sub-line, and Reward
// composes it. It is built here, alongside its only caller, rather than in
// primitives: a second caller is what would earn it a move, and there is one.
//
// THREE DELIBERATE DIFFERENCES FROM THE DESIGN, all for the same reason — it
// states figures the backend does not:
//
//  * The amount. The design shows `maxBack`, a percentage of the campaign's
//    LISTED price floored to whole rupees. That would read ₹539 where the ledger,
//    the run-sheet and TaskScreen all say ₹539.10, and it would be a percentage of
//    a price the buyer may never have been charged. Both figures here come from
//    src/ui/refund.js, which prefers the backend's own answer because that is the
//    one the payout used.
//  * The sub-line's basis. The design uses `examplePay`, which maps from the
//    campaign's EXPECTED price. The real charged basis is `refund.basedOnPaise`,
//    and when it is unknown the arithmetic is dropped rather than guessed.
//  * No confetti particles. The design animates fourteen. The badge and the text
//    still arrive — natively driven transforms and opacity only, so nothing can
//    jank the JS thread — and reduce-motion turns even that off. Fourteen
//    concurrently animating absolute views is the highest-variance, lowest-
//    information part of the most-watched screen in the demo.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  AccessibilityInfo,
} from 'react-native';
import * as campaignStore from './backend/campaignStore';
import { getAuthoritative } from './taskStore';
import { COLOR, FONT, RADIUS, SPACE } from './ui/theme';
import { Screen, Pill } from './ui/primitives';
import { displayRefundPaise, displayChargedPaise } from './ui/refund';
import { rewardView } from './ui/reward';

/** The design's TextBtn: a quiet centred secondary action. */
function TextBtn({ children, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.textBtn}>
      <Text style={styles.textBtnLabel}>{children}</Text>
    </TouchableOpacity>
  );
}

/**
 * The design's celebration block. Presentational — every word is handed in, so it
 * cannot state anything of its own.
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
      <Animated.View
        style={[
          styles.badge,
          { transform: [{ scale: badge }] },
        ]}
      >
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

export default function RewardScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const task = getAuthoritative(campaignId);
  const [motion, setMotion] = useState(false);

  // Ask once, and default to NO motion until the answer arrives — a celebration
  // that ignores the setting is worse than one that arrives plainly.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => { if (alive) setMotion(!reduce); })
      .catch(() => { if (alive) setMotion(true); });
    return () => { alive = false; };
  }, []);

  // BOTH figures through src/ui/refund.js — the chain the payout itself used. The
  // local fallback inside those helpers only applies before the server's answer
  // has landed, and by definition it has here: the task is refunded.
  const refundPaise = displayRefundPaise({
    authoritativePaise: task && task.refund ? task.refund.amountPaise : null,
    chargedPaise: null,
    percent: campaign ? campaign.percent : null,
    capPaise: campaign ? campaign.payoutCapPaise : null,
  });
  const basedOnPaise = displayChargedPaise({
    authoritativePaise: task && task.refund ? task.refund.basedOnPaise : null,
    localPaise: null,
  });

  const view = rewardView({
    state: task ? task.state : null,
    refundPaise,
    basedOnPaise,
    percent: campaign ? campaign.percent : null,
  });

  const viewWallet = useCallback(
    () => navigation.navigate('Tabs', { screen: 'Earnings' }),
    [navigation],
  );
  const explore = useCallback(
    () => navigation.navigate('Tabs', { screen: 'Home' }),
    [navigation],
  );

  // Nothing true to celebrate — no refund on file, or no resolvable amount. Go
  // back to the timeline the user was reading rather than name a payment we
  // cannot state. In an effect so the redirect happens after mount.
  //
  // EVERY HOOK IS ABOVE THIS LINE, and that is not stylistic. The first version
  // had the two useCallbacks below the early return, so a render that bailed out
  // called fewer hooks than one that did not — which is the rules-of-hooks
  // violation React throws on, on the most-watched screen in the demo.
  useEffect(() => {
    if (view == null) navigation.replace('Task', { campaignId });
  }, [view, navigation, campaignId]);
  if (view == null) return <Screen bg={COLOR.homeBg} />;

  return (
    <Screen bg={COLOR.homeBg}>
      <View style={styles.body}>
        <MilestoneCelebration
          eyebrow={view.eyebrow}
          title={view.title}
          amount={view.amount}
          chip={view.chip}
          sub={view.sub}
          motion={motion}
        />
      </View>
      <View style={styles.foot}>
        <Pill onPress={viewWallet} color={COLOR.greenDeep}>VIEW WALLET</Pill>
        <TextBtn onPress={explore}>Explore more campaigns</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.xxl },
  foot: { paddingHorizontal: SPACE.xxl, paddingBottom: SPACE.xxl },

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
    gap: SPACE.md,
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

  textBtn: { paddingVertical: 14, alignItems: 'center' },
  textBtnLabel: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.sub },
});
