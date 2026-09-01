// returncatch — fayr-design.browser.jsx:2573 (ReturnCatch)
//
// "Did you buy it?" — the screen somebody comes back to from the shop. Built on
// 1 September 2026, on the owner's instruction: "When they come back to FAYR, they
// should see: Have you purchased the product?"
//
// IT WAS NOT BUILT BEFORE, and the reason it was skipped was wrong. The note in the
// walk through said the journey works out where somebody is from what the shop and
// the server say, so it never has to ask — and that saying yes without buying would
// let somebody skip ahead. The first half is true from the moment the shop tells us
// anything. It is NOT true in the gap before that, which is exactly where this
// screen sits: somebody who has just come back from the shop was being shown "Before
// you go", a screen about a trip they had already made.
//
// AND SAYING YES SKIPS NOTHING. It moves them one screen on, to the one that asks
// for the order. It does not create an order, does not confirm one, and does not
// move money: every one of those still needs the shop's own word, read by Fayr.
// What the answer really does is stop asking a question that has been answered.
//
// THE DESIGN'S OWN SCREEN: the product picture, the heading, the sentence naming
// the product, the green button and the quiet second action. One departure: the
// design says "so we can move you to Step 2", which is a number from its own seven
// step tracker and not this journey's. The sentence says what happens instead.
import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { SAID_THEY_BOUGHT, markVisitedShop } from '../journey/shopVisits';
import { COLOR, SPACE } from '../ui/theme';
import { Pill, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen, ProductImage } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';

export default function ReturnCatchScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const product = campaign ? campaign.productName || campaign.title : null;

  const yes = useCallback(() => {
    if (campaignId) markVisitedShop(campaignId, SAID_THEY_BOUGHT);
    // Ask the journey to look again. It re-derives the step from the record and the
    // notes; this screen does not choose where anybody goes.
    if (params.onJourneyMoved) params.onJourneyMoved();
    else navigation.navigate('proofprimer', { campaignId });
  }, [campaignId, params, navigation]);

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.body}>
        <ProductImage
          imageUrl={campaign ? campaign.imageUrl : null}
          seed={campaignId}
          radius={20}
          style={styles.art}
        />
        <Text style={[hTitle, styles.title]}>Did you buy it?</Text>
        <Text style={[hSub, styles.sub]}>
          {product
            ? `Tell us once your ${product} order is placed, and we will ask you to `
              + 'show us the order.'
            : 'Tell us once your order is placed, and we will ask you to show us '
              + 'the order.'}
        </Text>
      </View>
      <View style={styles.foot}>
        <Pill onPress={yes} color={COLOR.greenDeep}>YES, I HAVE BOUGHT IT ✓</Pill>
        <TextBtn onPress={() => goBackOrHome(navigation)}>
          Not yet — remind me later
        </TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  art: { width: 92, height: 92 },
  title: { marginTop: 18, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 270 },
  foot: { paddingHorizontal: 28, paddingBottom: 28, gap: SPACE.xs },
});
