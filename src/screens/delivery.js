// delivery — fayr-design.browser.jsx:2963 (DeliveryConfirm)
//
// "Delivered?" — the screen that opens the review step. Split out of
// src/journey/JourneyScreen.js on 1 September 2026, where it was one page of ten
// inside one file.
//
// THE DESIGN'S OWN SCREEN: the parcel, the heading, the sentence naming the
// product, the green button, and the quiet second action for a parcel that has not
// turned up.
//
// WHAT THIS BUTTON USED TO DO, AND WHY IT NO LONGER DOES IT. Until the split, "Yes,
// it is delivered" fired CONFIRM_ORDER, whose meaning in the engine is "this is my
// order" (src/taskflow.js:998) — a different fact, on the wrong screen, under the
// wrong words. It was there because the design's screen for confirming an order,
// ocrconfirm, had never been built, so its event had nowhere else to live. It has
// its own screen now, so this one is free to be about delivery.
//
// AND DELIVERY IS NOT SOMETHING A TAP CAN SETTLE. Fayr reads it from the person's
// own orders on the shop, because a refund that moved on somebody saying "it came"
// would be a refund anybody could have. So the button asks Fayr to LOOK: it re-reads
// the record, and if the shop has not told us yet it says so and offers the two
// things that really help — open the shop so the reader can see the delivery, or
// send a screenshot of it.
//
// "It's delayed / there's a problem" goes to the design's own deliverydelayed
// screen, which Fayr has not built. Until it is, this says so plainly and opens
// help rather than being a button that goes nowhere.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { getTask as getTaskFromServer } from '../backend/tasksApi';
import { getAuthoritative, getTaskId, subscribe } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { SIGNED_IN, markVisitedShop } from '../journey/shopVisits';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, Pill, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';

export default function DeliveryScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const product = campaign ? campaign.productName || campaign.title : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : 'the shop';

  const [, setTick] = useState(0);
  const [looking, setLooking] = useState(false);
  // True once the person has said it arrived and Fayr looked and could not see it.
  const [notSeenYet, setNotSeenYet] = useState(false);

  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);

  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return undefined;
    const reread = () => {
      const id = campaignId ? getTaskId(campaignId) : null;
      if (id) getTaskFromServer(id).catch(() => {});
    };
    const unfocus = navigation.addListener('focus', reread);
    reread();
    return unfocus;
  }, [navigation, campaignId]);

  const itArrived = useCallback(async () => {
    if (looking) return;
    const id = campaignId ? getTaskId(campaignId) : null;
    if (!id) return;
    setLooking(true);
    const res = await getTaskFromServer(id);
    setLooking(false);
    const seen = !!(res && res.ok && res.task && res.task.delivery);
    // If the shop has told us, the record has moved and the journey moves with it
    // by itself. If it has not, say so instead of pretending.
    setNotSeenYet(!seen);
  }, [campaignId, looking]);

  const openShop = useCallback(() => {
    if (campaignId) markVisitedShop(campaignId, SIGNED_IN);
    if (key) navigation.navigate(key, { campaignId });
  }, [navigation, key, campaignId]);

  const problem = useCallback(() => {
    Alert.alert(
      'Tell us what happened',
      'There is no screen for a late, wrong or lost parcel yet. Open Help and '
      + 'support and tell us in your own words, and a person at Fayr will sort it '
      + 'out. Nothing about your claim is lost while we do.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open help', onPress: () => navigation.navigate('Support') },
      ],
    );
  }, [navigation]);

  const task = campaignId ? getAuthoritative(campaignId) : null;
  const delivered = !!(task && task.delivery);

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.body}>
        <Text style={styles.parcel}>📦</Text>
        <Text style={[hTitle, styles.title]}>
          {delivered ? 'It arrived' : 'Delivered?'}
        </Text>
        <Text style={[hSub, styles.sub]}>
          {delivered
            ? `${shop} has told us it arrived. The review step is open.`
            : product
              ? `Your ${product} should have arrived around now. Tell us, and we `
                + 'will check with the shop.'
              : 'Your order should have arrived around now. Tell us, and we will '
                + 'check with the shop.'}
        </Text>

        {notSeenYet && !delivered ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{shop} has not told us yet</Text>
            <Text style={styles.cardBody}>
              We read the delivery from your own orders on {shop}, so it is not
              something we can take your word for. Two things help: open {shop} so we
              can read it, or send us a picture of the delivery.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        {delivered ? null : (
          <Pill onPress={itArrived} disabled={looking} color={COLOR.greenDeep}>
            {looking ? 'Checking with the shop…' : 'YES — IT IS DELIVERED'}
          </Pill>
        )}
        {notSeenYet && !delivered ? (
          <>
            <Ghost onPress={openShop}>Open {shop} so we can read it</Ghost>
            <Ghost
              onPress={() => navigation.navigate('ProofUpload', {
                campaignId, kind: 'DELIVERY',
              })}
            >
              Send a picture of the delivery
            </Ghost>
          </>
        ) : null}
        <TextBtn onPress={problem}>It is late, or there is a problem</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  parcel: { fontSize: 56 },
  title: { marginTop: 16, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 285 },
  card: {
    marginTop: SPACE.xl, backgroundColor: COLOR.amberBg, borderWidth: 1,
    borderColor: COLOR.amberLine, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, maxWidth: 305,
  },
  cardTitle: { fontFamily: FONT.displaySemi, fontSize: 13, color: '#8A5A00' },
  cardBody: {
    fontFamily: FONT.bodyMed, fontSize: 12, lineHeight: 18, color: '#7A5A10',
    marginTop: 4,
  },
  foot: { paddingHorizontal: 28, paddingBottom: 28, gap: 8 },
});
