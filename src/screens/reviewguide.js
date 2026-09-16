// reviewguide — fayr-design.browser.jsx:3013 (ReviewGuide)
//
// The screen that decides whether Fayr is honest. Split out of
// src/journey/JourneyScreen.js on 1 September 2026, where it was one page of ten
// inside one file.
//
// EVERY WORD ON IT IS THE DESIGN'S, and that is the point rather than tidiness.
// This is where somebody is about to write a review they are being paid for, and
// the design's own copy is careful about it: six neutral prompts that steer nobody,
// a line saying the prompts are optional, and a locked blue note saying a low
// rating pays the same as a high one. Nothing here is reworded, softened, or
// helpfully rearranged into something that reads as a nudge.
//
// The design's own screen also carries this promise on `honesty`, a separate screen
// that Fayr has not built. Both say the same thing; keeping it here means it is in
// front of somebody at the moment they write, which is when it matters.
//
// TWO DEPARTURES:
//
//  * The design opens the shop's homepage in a browser tab. Here there are two
//    doors: the shop inside Fayr, which is how Fayr later reads that the review is
//    really there, and the shop's own installed app, which the owner asked for.
//    One plain line says which is which.
//  * The product name goes on the clipboard on the way out, on either door, so
//    nobody has to type it into a search box to find their own product again. The
//    name and nothing else, and the screen says out loud that it happened.
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { PLATFORMS } from '../platforms';
import { SIGNED_IN, markVisitedShop } from '../journey/shopVisits';
import { copyProductName, openShopApp } from '../openShop';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Ghost, Pill, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { copyLine } from '../ui/shopApp';
import { goBackOrHome } from '../ui/nav';

/**
 * The design's six prompts, in its order and its words.
 *
 * NEUTRAL ON PURPOSE. Not one of them asks for anything good. "Value for money"
 * asks whether it felt worth the price, not whether it was a bargain. Changing any
 * of these into a leading question would turn the screen into the thing Fayr says
 * it is not.
 */
const TOPICS = [
  ['✨', 'Product quality', 'How it looks, feels, and performs'],
  ['📦', 'Packaging', 'How it arrived — sealed, intact, presentable'],
  ['💰', 'Value for money', 'Whether it felt worth the price you paid'],
  ['🖐', 'Ease of use', 'How simple or fiddly it was to use'],
  ['🛡', 'Durability', 'How it is holding up over time'],
  ['💬', 'Overall experience', 'Anything else you genuinely felt'],
];

export default function ReviewGuideScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = campaign ? campaign.marketplace : params.marketplace || 'amazon';
  const shop = PLATFORMS[key] ? PLATFORMS[key].name : String(key);

  const product = campaign ? campaign.productName || campaign.title : null;
  const opens = PLATFORMS[key] ? PLATFORMS[key].startUrl : null;
  const [copied, setCopied] = useState(null);

  const putOnClipboard = useCallback(async () => {
    const done = await copyProductName(product);
    setCopied(done);
  }, [product]);

  const openTheirApp = useCallback(async () => {
    await putOnClipboard();
    if (campaignId) markVisitedShop(campaignId, SIGNED_IN);
    await openShopApp(key, opens);
  }, [putOnClipboard, key, opens, campaignId]);

  return (
    <Screen bg={COLOR.homeBg}>
      <TopBar title="Write your review" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={[hTitle, styles.title]}>Share your honest review</Text>
        <Text style={hSub}>
          We will open <Text style={styles.strong}>{shop}</Text>. Find your product
          and post your review there. Say exactly what you think: a low rating and a
          high one are paid the same.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Things you might mention</Text>
          <Text style={styles.cardLead}>
            Just prompts to help you structure it. Cover any, all, or none. Your
            honest opinion is entirely yours.
          </Text>
          <View style={styles.grid}>
            {TOPICS.map(([icon, name, what]) => (
              <View key={name} style={styles.topic}>
                <Text style={styles.topicIcon}>{icon}</Text>
                <Text style={styles.topicName}>{name}</Text>
                <Text style={styles.topicWhat}>{what}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.promise}>
          <Text style={styles.promiseIcon}>🔒</Text>
          <Text style={styles.promiseText}>
            Fayr never asks for positive reviews or for a set number of stars.
            Honest feedback, good or bad, earns the same refund.
          </Text>
        </View>

        {copied === null ? null : (
          <Text style={[styles.copied, copied === false && styles.copiedNo]}>
            {copyLine(product, copied)}
          </Text>
        )}

        {/* ── WHAT HAPPENS AFTER THEY POST IT, SAID BEFORE THEY GO ──────────
            A review is not visible the moment it is written. The shop moderates
            it first, and on this one that takes days — so somebody who comes
            straight back and finds nothing would reasonably think Fayr had lost
            their review.

            THE NUMBER IS THE SHOP'S OWN AND IT IS ATTRIBUTED. Fayr is not
            promising it and cannot: the shop decides, and the words say so. */}
        <View style={styles.wait}>
          <Text style={styles.waitTitle}>{shop} takes a few days to show it</Text>
          <Text style={styles.waitBody}>
            {shop} checks every review before it appears, which usually takes
            {' '}<Text style={styles.strong}>48 to 72 hours</Text> and sometimes
            longer. {shop} emails you when it is live.
            {'\n\n'}
            Come back whenever you like — today, tomorrow, or after the email —
            and tap the button below. We will look for it ourselves. There is
            nothing to copy and nothing to send us.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.foot}>
        {/* ONE DOOR, AND IT IS THE SHOP'S OWN APP. The other button opened the
            shop inside Fayr in a web view. The owner asked on 2 September 2026 for
            no marketplace ever to open inside Fayr, so it is gone.

            THE WORDS ARE THE DESIGN'S OWN. Its before you go screen has exactly
            one button, reading "OPEN AMAZON →" (fayr-design.browser.jsx:2568), so
            that is what this says rather than wording of mine.

            src/openShop.js opens the shop's own app by its own address and falls
            back to the shop's website in the phone's own browser. Nothing renders
            a marketplace inside Fayr. */}
        <Pill onPress={openTheirApp} color={COLOR.ink}>
          OPEN {shop.toUpperCase()} →
        </Pill>
        {/* ── AND THE WAY BACK, WHICH IS THE WHOLE POINT OF THE SCREEN ──────
            It starts the read and nothing else. It does not say the review IS
            live and it cannot: whether a review is publicly visible is the
            payout signal, it is settled on the server from the shop's own page,
            and there is no field on the way in for a phone to claim it.

            SO THE WORDS ARE ABOUT LOOKING, NOT ABOUT PAYING. "I have posted it,
            check now" is a request. "My review is live" would be an assertion,
            and an assertion by the person being paid is exactly what this
            product refuses to accept anywhere else. */}
        <Ghost onPress={() => navigation.navigate('LookingForReview', { campaignId })}>
          I have posted it — check now
        </Ghost>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wait: {
    marginTop: SPACE.lg, backgroundColor: COLOR.amberBg, borderWidth: 1,
    borderColor: COLOR.amberLine, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  waitTitle: { fontFamily: FONT.displaySemi, fontSize: 13, color: '#8A5A00' },
  waitBody: {
    fontFamily: FONT.bodyMed, fontSize: 12, lineHeight: 18, color: '#7A5A10',
    marginTop: 4,
  },
  scroll: { flex: 1 },
  body: { paddingHorizontal: SPACE.xl, paddingTop: 4, paddingBottom: SPACE.lg },

  title: { fontSize: 23, lineHeight: 28 },
  strong: { fontFamily: FONT.bodyBold, color: COLOR.ink2 },

  card: {
    marginTop: SPACE.lg, backgroundColor: '#fff', borderRadius: RADIUS.lg,
    paddingHorizontal: 15, paddingVertical: 14, ...SHADOW.card,
  },
  cardTitle: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.ink },
  cardLead: {
    fontFamily: FONT.bodyMed, fontSize: 11.5, lineHeight: 17, color: COLOR.sub,
    marginTop: 4, marginBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  topic: {
    width: '47.5%', backgroundColor: COLOR.cream, borderRadius: RADIUS.md,
    paddingHorizontal: 11, paddingVertical: 10,
  },
  topicIcon: { fontSize: 17 },
  topicName: {
    fontFamily: FONT.displaySemi, fontSize: 12.5, color: COLOR.ink, marginTop: 5,
  },
  topicWhat: {
    fontFamily: FONT.bodyMed, fontSize: 10.5, lineHeight: 14, color: '#9A9B8C',
    marginTop: 2,
  },

  promise: {
    flexDirection: 'row', gap: 9, marginTop: 12, backgroundColor: COLOR.blueBg,
    borderWidth: 1, borderColor: '#CBE0FF', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  promiseIcon: { fontSize: 14 },
  promiseText: {
    flex: 1, fontFamily: FONT.bodySemi, fontSize: 11, lineHeight: 17,
    color: '#2F6FD0',
  },

  copied: {
    fontFamily: FONT.bodySemi, fontSize: 12, lineHeight: 18,
    color: COLOR.refundInk, backgroundColor: COLOR.refundBg,
    borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10,
    marginTop: 12,
  },
  copiedNo: { color: '#8A5A00', backgroundColor: COLOR.amberBg },

  foot: {
    paddingHorizontal: SPACE.xl, paddingTop: 10, paddingBottom: SPACE.xl, gap: 8,
  },
});
