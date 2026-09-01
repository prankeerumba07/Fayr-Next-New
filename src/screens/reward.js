// reward — fayr-design.browser.jsx:3601 (Reward), built on the design's reusable
// MilestoneCelebration block (:3554).
//
// MOVED HERE ON 1 SEPTEMBER 2026, from src/RewardScreen.js, as part of giving
// every design screen its own file under its own key. It is the SAME screen:
// nothing about what it draws changed in the move.
//
// IT IS ALSO THE SURVIVOR OF A DOUBLE BUILD. The claim journey drew its own
// "your refund is in your wallet" page as well, so one design screen had two
// implementations. This one won: it shows the amount the ledger actually paid
// rather than a percentage of a listed price, it states the charged basis it was
// worked out from, it refuses to celebrate when there is no refund on file, and
// it is the design's own celebration block rather than a heading and a sentence.
// The journey's page is gone, and the journey now sends somebody here.
//
// This is step 16 of the demo, and until now it had no screen. Releasing the
// refund re-rendered the same timeline with one row flipped to "done", and the
// only way to see the result was to switch tabs to Earnings by hand. The money
// moving is the whole product; it deserves a moment.
//
// MilestoneCelebration is a COMPONENT in the design, not a screen. It used to be
// built in this file, alongside its only caller, with a note saying a second caller
// would earn it a move. The second caller arrived — src/screens/orderverified.js —
// so it moved to src/ui/celebration.js, along with the rule about reduced motion.
// Nothing about what it draws changed.
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

import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as campaignStore from '../backend/campaignStore';
import { getAuthoritative } from '../taskStore';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { Screen, Pill } from '../ui/primitives';
import { MilestoneCelebration, useMotion } from '../ui/celebration';
import { displayRefundPaise, displayChargedPaise } from '../ui/refund';
import { rewardView } from '../ui/reward';

/** The design's TextBtn: a quiet centred secondary action. */
function TextBtn({ children, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.textBtn}>
      <Text style={styles.textBtnLabel}>{children}</Text>
    </TouchableOpacity>
  );
}

export default function RewardScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const task = getAuthoritative(campaignId);
  const motion = useMotion();

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
  textBtn: { paddingVertical: 14, alignItems: 'center' },
  textBtnLabel: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.sub },
});
