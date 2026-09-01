// orderverified — fayr-design.browser.jsx:3533 (OrderVerified)
//
// The moment between "we can see your order" and the long wait: the refund is now
// tracked, and it is pending rather than paid. Built on 1 September 2026.
//
// IT WAS NOT BUILT BEFORE, and the note in the walk through said there was no
// moment of celebration between the order being read and the waiting starting, and
// that the status screen states the same fact quietly. That was true and it was the
// wrong call: the design has a screen here, the owner asked for every design screen
// to stay separate and work to its purpose, and this one's purpose is to tell
// somebody the thing they most want to know — that their money is on its way — at
// the moment it becomes true.
//
// THE DESIGN'S OWN SCREEN, built on its own MilestoneCelebration block, which
// src/screens/reward.js already ports. This is the second caller that block's own
// comment said would earn it a move, so it moved to src/ui/celebration.js.
//
// THE AMOUNT IS THE ONE THE PAYOUT WOULD USE. The design shows maxBack, a
// percentage of the campaign's LISTED price. This shows what the server says would
// be paid if released now, through src/ui/refund.js — the same chain the reward
// screen uses. When no figure can be settled yet, no figure is shown, because a
// number a person still has to confirm is not a promise Fayr can make.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { getAuthoritative } from '../taskStore';
import { COLOR, SPACE } from '../ui/theme';
import { Pill, TextBtn } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { MilestoneCelebration, useMotion } from '../ui/celebration';
import { money } from '../ui/orderDetails';
import { displayRefundPaise } from '../ui/refund';
import { goBackOrHome } from '../ui/nav';

export default function OrderVerifiedScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const task = campaignId ? getAuthoritative(campaignId) : null;
  const motion = useMotion();

  const refundPaise = displayRefundPaise({
    authoritativePaise: task && task.refund ? task.refund.amountPaise : null,
    chargedPaise: null,
    percent: campaign ? campaign.percent : null,
    capPaise: campaign ? campaign.payoutCapPaise : null,
  });
  const amount = refundPaise == null ? null : money(refundPaise);

  return (
    <Screen bg={COLOR.homeBg}>
      <View style={styles.body}>
        <MilestoneCelebration
          eyebrow="Order verified"
          title="Refund tracked"
          amount={amount}
          chip="Pending in your Fayr wallet"
          sub={
            amount
              ? 'It is tracked to your Fayr wallet as pending. It becomes yours once '
                + 'your review is checked and the shop’s return window has closed.'
              : 'It is tracked to your Fayr wallet as pending. We cannot settle the '
                + 'amount yet, so we are not going to name one. It becomes yours '
                + 'once your review is checked and the return window has closed.'
          }
          motion={motion}
        />
      </View>
      <View style={styles.foot}>
        <Pill
          onPress={() => navigation.navigate('Task', { campaignId })}
          color={COLOR.greenDeep}
        >
          CONTINUE →
        </Pill>
        <TextBtn onPress={() => goBackOrHome(navigation)}>Back to my products</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACE.xxl,
  },
  foot: { paddingHorizontal: SPACE.xxl, paddingBottom: SPACE.xxl },
});
