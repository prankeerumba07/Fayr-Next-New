// returnwindow — fayr-design.browser.jsx:3081 (ReturnWindow)
//
// The last wait: the shop's return window has to close before the refund is
// released. Split out of src/journey/JourneyScreen.js on 1 September 2026, where
// it was one page of ten inside one file.
//
// WHY THIS WAIT EXISTS AT ALL, and it is the whole anti-fraud point of Fayr: a
// review that is deleted the moment the money lands is worth nothing to anybody.
// So the refund waits for the shop's own return window to close, and the review is
// checked again before the money moves.
//
// THE DESIGN'S OWN SCREEN: the ring with the number of days in it, the heading,
// the sentence naming the shop and the date, and the card about the last check.
//
// THE NUMBERS ARE THE SERVER'S, NOT THE DESIGN'S. The design writes "5 DAYS" into
// the ring and "closes on 11 Jul" into the sentence. Both would be wrong every
// time they were shown. They come from the task's own windowEndsAt, which is the
// same field the backend uses to decide whether a refund may be released — so the
// screen cannot say a different date from the one that actually gates the money.
// When the server has not sent one, the ring shows no number and the sentence says
// we do not have the date yet.
//
// The design's "CONTINUE (DEMO: SKIP WAIT)" button is not copied. There is nothing
// to skip: the wait is the product.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { getAuthoritative } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { daysUntil, windowLine } from '../ui/returnWindow';
import { goBackOrHome } from '../ui/nav';

export default function ReturnWindowScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const task = campaignId ? getAuthoritative(campaignId) : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : null;

  const endsAt = task ? task.windowEndsAt : null;
  const days = daysUntil(endsAt, Date.now());
  const line = windowLine({ endsAt, shopName: shop, now: Date.now() });

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.body}>
        <View style={styles.ring}>
          {days == null ? (
            <Text style={styles.ringNoNumber}>—</Text>
          ) : (
            <>
              <Text style={styles.ringNumber}>{days}</Text>
              <Text style={styles.ringWord}>{days === 1 ? 'DAY' : 'DAYS'}</Text>
            </>
          )}
        </View>
        <Text style={[hTitle, styles.title]}>
          {days == null
            ? 'Waiting for the return window'
            : days === 0
              ? 'Your refund unlocks today'
              : `Refund unlocks in ${days} ${days === 1 ? 'day' : 'days'}`}
        </Text>
        <Text style={[hSub, styles.sub]}>{line}</Text>
        <View style={styles.card}>
          <Text style={styles.cardText}>
            One last check when the window closes: we look at your review again and
            make sure it is still there. You have known about this since the offer
            page, so it is routine and not a surprise.
          </Text>
        </View>
      </View>
      <View style={styles.foot}>
        <Ghost onPress={() => navigation.navigate('Task', { campaignId })}>
          See where this claim stands
        </Ghost>
        <TextBtn onPress={() => goBackOrHome(navigation)}>Back to my products</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  ring: {
    width: 110, height: 110, borderRadius: 55, borderWidth: 5,
    borderColor: COLOR.greenBg, borderTopColor: COLOR.green,
    alignItems: 'center', justifyContent: 'center',
  },
  ringNumber: { fontFamily: FONT.displayXBold, fontSize: 26, color: COLOR.ink2 },
  ringNoNumber: { fontFamily: FONT.displayXBold, fontSize: 26, color: COLOR.sub },
  ringWord: {
    fontFamily: FONT.displayXBold, fontSize: 10, letterSpacing: 0.8, color: COLOR.sub,
  },
  title: { marginTop: 20, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 290 },
  card: {
    marginTop: 14, backgroundColor: '#fff', borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, maxWidth: 300,
  },
  cardText: {
    fontFamily: FONT.bodySemi, fontSize: 11.5, lineHeight: 18, color: COLOR.sub,
    textAlign: 'center',
  },
  foot: { paddingHorizontal: 28, paddingBottom: 28 },
});
