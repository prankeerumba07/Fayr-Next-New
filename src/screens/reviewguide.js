// reviewguide — fayr-design.browser.jsx:3013 (ReviewGuide)
//
// The screen that decides whether Fayr is honest. Split out of
// src/journey/JourneyScreen.js on 1 September 2026, where it was one page of ten
// inside one file.
//
// EVERY WORD ON IT IS THE DESIGN'S, and that is the point rather than tidiness.
// This is where somebody is about to write a review they are being paid for, and
// the design's own copy is careful about it: six neutral prompts that steer
// nobody, a line saying the prompts are optional, and a locked blue note saying a
// low rating pays the same as a high one. Nothing here is reworded, softened, or
// helpfully rearranged into something that reads as a nudge.
//
// ── AND SINCE 17 SEPTEMBER 2026 IT IS SIX SCREENS WEARING ONE NAME ────────
//
// REVIEW-FLOW-PROMPT.md, steps eleven to twenty one, turns this step into a
// small sequence. WHICH of the six somebody is looking at is decided next door,
// in src/journey/reviewStep.js, and is pure — so every combination of the record,
// the note on the phone and what just happened can be walked under node. This
// file draws them and does not choose between them.
//
//   locked        the day since the parcel arrived is not up yet
//   guide         it is open, and they have not gone to write one yet
//   asking        they went and came back. "Have you posted the review?"
//   notice        they said yes, just now. The shop takes 48 to 72 hours
//   notice-again  a look ran and found nothing. The same thing, knowing more
//   asking-again  any later visit. "Review confirmation received."
//
// ── THE DAY IT IS SHUT FOR IS NOT A DELAY, IT IS THE POINT ───────────────
//
// Step eleven asks for "a fair review after using the product", and a review
// written in the minute the parcel lands is not a review of using anything. The
// day is measured from the DELIVERY INSTANT ON THE RECORD — the server's word,
// read off the shop's own page — so two phones cannot open the step at two
// different times for one parcel.
//
// IT OPENS BY ITSELF. No tap, no pull to refresh, nothing to come back to. The
// screen re-asks its own question on a timer that is exact at the boundary: see
// theClockTicking below.
//
// ── AND THE LONG WAIT IS NOT AN ERROR ────────────────────────────────────
//
// The owner's own words at step sixteen: "the app does NOT immediately claim
// failure". A review that has just been written is not visible yet, and a screen
// saying "we could not find it" would be telling somebody their work had not
// counted when nothing at all is wrong. The number is the shop's, and it is
// attributed to the shop, because the shop is what decides it.
//
// TWO DEPARTURES FROM THE DESIGN:
//
//  * The design opens the shop's homepage in a browser tab. Here the one door is
//    the shop's own installed app, which the owner asked for.
//  * The product name goes on the clipboard on the way out, so nobody has to type
//    it into a search box to find their own product again. The name and nothing
//    else, and the screen says out loud that it happened.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { goingToTheReview } from '../backend/tasksApi';
import { getAuthoritative, getTaskId, subscribe } from '../taskStore';
import { PLATFORMS } from '../platforms';
import {
  SIGNED_IN, TOLD_ABOUT_THE_REVIEW_WAIT, WENT_TO_REVIEW,
  hasVisitedShop, markVisitedShop,
} from '../journey/shopVisits';
import { reviewStepFace } from '../journey/reviewStep';
import { copyProductName, openShopApp } from '../openShop';
import { shopsInsideFayr } from '../shop/insideFayr';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Ghost, Pill, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { copyLine } from '../ui/shopApp';
import { goBackOrHome } from '../ui/nav';
import {
  HAVE_YOU_POSTED_THE_REVIEW, I_WILL_DO_IT_LATER, NO,
  PLEASE_WAIT_FOR_THAT_TIME, REVIEW_CONFIRMATION_RECEIVED,
  STILL_WANT_TO_CONTINUE, WRITE_A_FAIR_REVIEW, YES,
  howLongAgoInWords, reviewsGoLiveIn, waitThenComeBack, youPostedItAgo,
} from '../ui/journeyWords';

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

/** When our own side recorded them leaving to write it, or null. */
function wentToReviewInstant(task) {
  const at = task && typeof task.wentToReviewAt === 'string' ? task.wentToReviewAt : null;
  if (at == null || at === '') return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

export default function ReviewGuideScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = campaign ? campaign.marketplace : params.marketplace || 'amazon';
  const shop = PLATFORMS[key] ? PLATFORMS[key].name : String(key);

  const product = campaign ? campaign.productName || campaign.title : null;
  const opens = PLATFORMS[key] ? PLATFORMS[key].startUrl : null;
  const [copied, setCopied] = useState(null);

  // ── THE SHOPS WITH NO REVIEW FORM AT ALL ────────────────────────────────
  //
  // Zepto, Blinkit and Instamart take a private star rating on the order and
  // publish nothing a stranger can read — src/reviewCopy.test.mjs names all
  // three and holds the app to it. So for those three the WORDS are written
  // inside Fayr and stay with Fayr, and the descriptive feedback is the thing a
  // brand is actually paying for.
  //
  // AND ONLY ONCE THE SERVER HAS MATCHED AN ORDER. A review about a purchase
  // nobody has confirmed is a review about nothing, and the server refuses one
  // anyway — this is the same rule said on screen instead of as a 409.
  //
  // THE SHOP'S OWN DOOR BELOW IS UNTOUCHED. The star rating still happens there;
  // that step is not this one's business.

  // ── THE CLOCK, TICKING, SO A SHUT STEP OPENS WITHOUT BEING TOUCHED ──────
  const [, setTick] = useState(0);
  const task = campaignId ? getAuthoritative(campaignId) : null;
  const went = wentToReviewInstant(task);

  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);

  const orderMatched = !!(task && task.order && task.order.id != null);
  const writesItInFayr = shopsInsideFayr(key) && orderMatched;
  const writeItHere = useCallback(() => {
    navigation.navigate('WriteReview', { campaignId });
  }, [navigation, campaignId]);

  // ── WHICH OF THE FIVE, DECIDED NEXT DOOR ────────────────────────────────
  //
  // THERE IS NO CLOCK ON THIS SCREEN ANY MORE. It used to hold a timer that
  // re-armed every minute so a step shut for a day would open itself without
  // being touched. The waiting period was removed on 18 September 2026 — see
  // src/journey/reviewStep.js for the owner's words — so there is nothing left
  // for a clock to be waiting for.
  //
  // OUR OWN RECORD FIRST, THEN THE NOTE ON THE PHONE. The note is written before
  // the request leaves, so somebody who has plainly just come back from the shop
  // is never shown the screen that sends them there again while our side catches
  // up. The INSTANT is only ever the record's: a note has none to give, and an
  // invented one would be printed on this screen as a time they posted it.
  const [justAskedYes, setJustAskedYes] = useState(false);
  const wentToReview = went != null || hasVisitedShop(campaignId, WENT_TO_REVIEW);
  const told = hasVisitedShop(campaignId, TOLD_ABOUT_THE_REVIEW_WAIT);
  const face = reviewStepFace({
    // A shop inside Fayr is always the guide — see reviewStep.js.
    inFayrShop: shopsInsideFayr(key),
    wentToReview,
    told,
    justAskedYes,
    // A LOOK HAS JUST HANDED BACK TO US, and it is the read's own word rather
    // than a guess from a clock. src/order/LookingForReviewScreen.js sets it when
    // it leaves, so it is true on exactly one arrival and false on every later
    // one — which is the whole of what tells step seventeen from step twenty.
    lookJustRan: params.reviewLookRan === true,
  });

  const putOnClipboard = useCallback(async () => {
    const done = await copyProductName(product);
    setCopied(done);
  }, [product]);

  // ── GOING TO WRITE IT, AND OUR SIDE HEARING ABOUT IT ────────────────────
  //
  // ── WHY THIS DOES NOT REFUSE THE WAY THE BUY STEP REFUSES ──────────────
  //
  // The buy step will not open a shop until our side has recorded the visit,
  // because a purchase our side does not know about can never be paid. NOTHING
  // ABOUT THE MONEY HANGS OFF THIS ONE. Whether a review is publicly visible is
  // read off the shop's own page, and a review written while our side was
  // offline is read exactly the same way as any other.
  //
  // So a request that fails costs a sentence, not a refund, and standing between
  // somebody and the review they came here to write would be the larger harm.
  // The note on the phone is written either way, so the screen still moves on.
  const goingToWriteIt = useCallback(async () => {
    await putOnClipboard();
    if (campaignId) {
      markVisitedShop(campaignId, SIGNED_IN);
      markVisitedShop(campaignId, WENT_TO_REVIEW);
    }
    const taskId = campaignId ? getTaskId(campaignId) : null;
    if (taskId) await goingToTheReview(taskId);
    await openShopApp(key, opens);
  }, [putOnClipboard, key, opens, campaignId]);

  /** They say the review is written. Tell them what the shop does next. */
  const theySaidYes = useCallback(() => {
    if (campaignId) markVisitedShop(campaignId, TOLD_ABOUT_THE_REVIEW_WAIT);
    setJustAskedYes(true);
  }, [campaignId]);

  /** Look anyway. The read decides, and it hands back here either way. */
  const lookNow = useCallback(() => {
    navigation.navigate('LookingForReview', { campaignId });
  }, [navigation, campaignId]);

  // ── THE QUESTION, AND THE SAME QUESTION WITH A LINE ABOVE IT ────────────
  if (face === 'asking' || face === 'asking-again') {
    return (
      <Screen bg={COLOR.homeBg}>
        <TopBar title="Write your review" onBack={() => goBackOrHome(navigation)} />
        <View style={styles.middle}>
          <Text style={styles.bigEmoji}>📝</Text>
          {face === 'asking-again' ? (
            <Text style={[hSub, styles.midSub]}>{REVIEW_CONFIRMATION_RECEIVED}</Text>
          ) : null}
          <Text style={[hTitle, styles.midTitle]}>{HAVE_YOU_POSTED_THE_REVIEW}</Text>
        </View>
        <View style={styles.foot}>
          {/* YES SETTLES NOTHING. On the first time it opens the shop's own
              waiting period, said in the shop's name; later it starts the look.
              Whether a review is publicly visible is read off the shop's own
              page and is decided nowhere on this side. */}
          <Pill
            onPress={face === 'asking' ? theySaidYes : lookNow}
            color={COLOR.ink}
          >
            {YES.toUpperCase()}
          </Pill>
          <Pill onPress={() => goBackOrHome(navigation)} color={COLOR.line}>
            {NO.toUpperCase()}
          </Pill>
        </View>
      </Screen>
    );
  }

  // ── THE WAIT, WHICH IS THE SHOP'S AND IS NOT AN ERROR ───────────────────
  if (face === 'notice' || face === 'notice-again') {
    return (
      <Screen bg={COLOR.homeBg}>
        <TopBar title="Write your review" onBack={() => goBackOrHome(navigation)} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          <Text style={[hTitle, styles.title]}>{reviewsGoLiveIn(shop)}</Text>
          <Text style={hSub}>{waitThenComeBack(shop)}</Text>

          {/* ── AND WHAT WE ALREADY KNOW, ONCE A LOOK HAS COME BACK EMPTY ──
              Step seventeen: it says the same thing again, but now naming what
              it knows. THE TIME IS THE RECORD'S: the moment our own side wrote
              down that they left to write the review. When there is no such
              moment — the request never reached us — the sentence is left out
              rather than guessed at from a clock on the phone. */}
          {face === 'notice-again' ? (
            <View style={styles.wait}>
              {went != null ? (
                <Text style={styles.waitTitle}>
                  {youPostedItAgo(howLongAgoInWords(Date.now() - went))}
                </Text>
              ) : null}
              <Text style={styles.waitBody}>{PLEASE_WAIT_FOR_THAT_TIME}</Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.foot}>
          <Pill onPress={lookNow} color={COLOR.ink}>
            {STILL_WANT_TO_CONTINUE.toUpperCase()}
          </Pill>
          <Ghost onPress={() => goBackOrHome(navigation)}>{I_WILL_DO_IT_LATER}</Ghost>
        </View>
      </Screen>
    );
  }

  // ── THE GUIDE ITSELF ────────────────────────────────────────────────────
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
        <Text style={[hSub, styles.fair]}>{WRITE_A_FAIR_REVIEW}</Text>

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

            THE SENTENCES ARE THE SAME ONES THE WAIT SCREEN USES, named from the
            one file rather than written twice. Two wordings of one fact is how
            two screens end up seeming to say different things. */}
        <View style={styles.wait}>
          <Text style={styles.waitTitle}>{reviewsGoLiveIn(shop)}</Text>
          <Text style={styles.waitBody}>{waitThenComeBack(shop)}</Text>
        </View>
      </ScrollView>

      <View style={styles.foot}>
        {/* ── AND FOR A SHOP WITH NO REVIEW FORM, THE WORDS ARE WRITTEN HERE ──
            Drawn ABOVE the shop's own door rather than instead of it: the star
            rating still happens at the shop. Nothing about this control blocks
            or hides the one below it. */}
        {writesItInFayr ? (
          <>
            {/* LAYOUT ONLY. The two controls did the same two things before this
                and do the same two things after it — the only change is that
                each now sits with the words that belong to it, and a hairline
                separates the pair so they stop reading as two competing primary
                buttons stacked on top of one another. */}
            <View style={styles.inFayrGroup}>
              <Pill onPress={writeItHere} color={COLOR.greenDeep}>
                WRITE YOUR REVIEW IN FAYR
              </Pill>
              <Text style={styles.inFayr}>
                {shop} only takes a star rating on your order, and nobody but you
                can see it. Your words stay with us.
              </Text>
            </View>
            <View style={styles.footRule} />
          </>
        ) : null}
        {/* ONE DOOR, AND IT IS THE SHOP'S OWN APP. The owner asked on 2 September
            2026 for no marketplace ever to open inside Fayr.

            THE WORDS ARE THE DESIGN'S OWN. Its before you go screen has exactly
            one button, reading "OPEN AMAZON →" (fayr-design.browser.jsx:2568).

            AND OUR SIDE IS TOLD, which is step fourteen: "the backend must know
            they left for the review". See goingToWriteIt for why this one does
            not refuse to open when that request fails. */}
        {/* ── NEITHER OF THESE FOR A SHOP INSIDE FAYR — 18 SEPTEMBER 2026 ──
            Both open the shop's own APP and both exist because the person left
            Fayr to write the review. Inside Fayr the review is written above,
            one tap copies it and opens the order's own page in Fayr's view, and
            coming back from that page runs the check by itself — see
            src/review/WriteReviewScreen.js and ShopScreen's order landing. */}
        {!shopsInsideFayr(key) ? (
          <>
            <Pill onPress={goingToWriteIt} color={COLOR.ink}>
              OPEN {shop.toUpperCase()} →
            </Pill>
            {/* ── AND THE WAY BACK, WHICH IS THE WHOLE POINT OF THE SCREEN ──
                It starts the read and nothing else. It does not say the review
                IS live and it cannot: whether a review is publicly visible is
                the payout signal, it is settled on the server from the shop's
                own page, and there is no field on the way in for a phone to
                claim it. */}
            <Ghost onPress={lookNow}>I have posted it — check now</Ghost>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  inFayrGroup: { gap: 6 },
  inFayr: { fontFamily: FONT.body, fontSize: 12, color: COLOR.sub, textAlign: 'center' },
  footRule: {
    height: 1, backgroundColor: COLOR.line, marginVertical: 2, alignSelf: 'stretch',
  },
  middle: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACE.xl,
  },
  bigEmoji: { fontSize: 52 },
  midTitle: { marginTop: 16, textAlign: 'center', fontSize: 22, lineHeight: 28 },
  midSub: { textAlign: 'center', maxWidth: 300, marginTop: 6 },
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
  fair: { marginTop: 8 },
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
