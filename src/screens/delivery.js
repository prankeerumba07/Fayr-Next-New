// delivery — fayr-design.browser.jsx:2963 (DeliveryConfirm)
//
// "Is the product delivered?" — the screen that opens the review step. Split out
// of src/journey/JourneyScreen.js on 1 September 2026, where it was one page of
// ten inside one file.
//
// ── IT ASKS AGAIN, AND THE QUESTION IS NOT WHAT IT WAS BEFORE ─────────────
//
// On 16 September 2026 the question was taken off this screen, in the owner's
// own words: "Fayr must confirm delivery by reading the user's own Amazon order
// page, with no buttons and no user input. src/screens/delivery.js currently
// asks the user, which is wrong." It was rebuilt to read the shop by itself the
// moment it opened.
//
// On 17 September REVIEW-FLOW-PROMPT.md puts a question back at step eight —
// "the app asks: Is the product delivered? with Yes / No" — and step nine says
// what Yes does: "reads the delivery off the shop's own page".
//
// ── THE TWO INSTRUCTIONS AGREE, AND IT IS WORTH BEING EXACT ABOUT WHY ─────
//
// What the first one forbids is A TAP SETTLING A DELIVERY. The old button did
// exactly that: it was labelled "YES — IT IS DELIVERED", it was an assertion by
// the person being paid, and a refund that moves because somebody said "it came"
// is a refund anybody could have.
//
// THIS TAP ASSERTS NOTHING. It starts the read. The shop's own page is still the
// only evidence, the server still decides, and somebody who taps Yes on a parcel
// that has not arrived gets exactly what somebody who taps nothing gets: the
// screen below, saying the shop has not said it arrived. What the question buys
// is that Fayr does not go asking a shop for pages every time an app is opened —
// which is the thing that gets an account blocked.
//
// ── THE SAME READ, NOT A SECOND ONE ───────────────────────────────────────
//
// It starts src/order/LookingForItScreen.js, which is the read the purchase step
// already runs. Writing a second reader here would be two copies of one thing,
// in one language, both deciding things about somebody's refund.
//
// THE SERVER DOES THE REST WITHOUT BEING TOLD TO. A later look at an order
// somebody has already said is theirs fills in the delivery it did not have —
// see deliveryFromALaterLook in backend/src/tasks/order-candidates.service.ts —
// and a delivery fragment moves the task to DELIVERED through the ordinary
// funnel. The journey then works its own step out from the record. Nothing on
// this screen chooses that.
//
// ── AND IT CARRIES STEP SEVEN'S SENTENCE, WHICH HAS NOWHERE ELSE TO GO ────
//
// "Thank you for confirming. Once your product is delivered, use it and give a
// fair review." is what the owner asks for the moment somebody confirms the
// order is theirs. Confirming moves the record to this step, so this is the
// first screen they see afterwards and this is where the sentence belongs.
//
// IT IS SHOWN EVERY TIME UNTIL THE PARCEL ARRIVES, rather than only on the first
// arrival, and that is a decision rather than an oversight. The alternative is a
// note on the phone recording that a sentence has been read once, which is state
// kept for the sake of hiding a true sentence. Both halves stay true for the
// whole of this step.
//
// ── WHAT WAS REMOVED EARLIER STAYS REMOVED ────────────────────────────────
//
// "Open <shop> so we can read it" is gone, and it was a bug. It called
// navigation.navigate(key) — the marketplace's own web view, which is the screen
// for READING A REVIEW — and landed the person on the shop's home page with no
// reason to be there and nothing to do. Nobody has to open their shop for Fayr:
// the read opens it.
//
// "It is late, or there is a problem" stays. The design's own deliverydelayed
// screen has not been built, so it says so plainly and opens help.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { getTask as getTaskFromServer } from '../backend/tasksApi';
import { getAuthoritative, getTaskId, subscribe } from '../taskStore';
import { PLATFORMS } from '../platforms';
import {
  alreadyLookedForDelivery, rememberWeLookedForDelivery,
} from '../order/deliveryLook';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, Pill, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import {
  IS_THE_PRODUCT_DELIVERED, NO, THANK_YOU_FOR_CONFIRMING,
  USE_IT_AND_REVIEW_FAIRLY, YES,
} from '../ui/journeyWords';
import { goBackOrHome } from '../ui/nav';

/**
 * HOW LONG THE READ IS GIVEN TO TAKE THIS SCREEN AWAY, ONCE IT IS ASKED FOR.
 *
 * Tapping Yes means leaving for the read, so in the ordinary case this screen is
 * gone within a frame and this timer never fires. It is here for the case where
 * it is not gone: a navigator that refused the move, or this screen opened
 * somewhere that has no navigator at all, like the walk through.
 *
 * NOBODY IS LEFT ON A SPINNER. That is the same rule the read itself keeps — see
 * MOST_TIME_MS in LookingForItScreen — and it is worth keeping twice, because
 * the failure it guards against is a screen with no way off it.
 */
export const READ_SHOULD_HAVE_LEFT_MS = 4000;

export default function DeliveryScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const product = campaign ? campaign.productName || campaign.title : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : 'the shop';

  const [, setTick] = useState(0);
  const taskId = campaignId ? getTaskId(campaignId) : null;

  // ── WHERE THIS SCREEN IS, IN ONE WORD ────────────────────────────────────
  //
  //   'asking'   the question is up, and nothing has been asked of the shop
  //   'reading'  they said yes, and the read is being opened
  //   'nothing'  it was read, and the shop's page does not say it arrived
  //
  // There is no fourth value for "delivered": that is not a state of this screen,
  // it is a state of the RECORD, and when the record says so the journey has
  // already moved somebody past here. Keeping a copy of it on this side is how
  // two places end up disagreeing about where somebody is.
  //
  // THE NOTE DECIDES BETWEEN THE FIRST AND THE LAST. A read that has already run
  // in this sitting and found nothing must not put the question back up, or the
  // person answers Yes and watches the same nothing happen again.
  const looked = alreadyLookedForDelivery(taskId);
  const [where, setWhere] = useState(looked ? 'nothing' : 'asking');
  const started = useRef(false);

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

  // ── THE READ, STARTED BY THIS SCREEN OPENING AND BY NOTHING ELSE ─────────
  // ── THE READ, STARTED BY THE ANSWER AND BY NOTHING ELSE ─────────────────
  //
  // Not on mount, and that is the change of 17 September 2026. See the note at
  // the top of this file for why a question is allowed here at all and what it
  // is and is not allowed to settle.
  const theySaidYes = useCallback(() => {
    if (started.current) return;
    started.current = true;
    // NO TASK IS NOTHING TO READ. The read is of one person's orders against one
    // claim, and without a task there is no claim to read them against.
    if (taskId == null || alreadyLookedForDelivery(taskId)) {
      setWhere('nothing');
      return;
    }
    // THE NOTE IS WRITTEN BEFORE THE MOVE, not after it. Written after, a screen
    // that comes straight back has no note and starts again.
    rememberWeLookedForDelivery(taskId);
    setWhere('reading');
    if (navigation && typeof navigation.navigate === 'function') {
      // ── AND WHICH ORDER, BECAUSE BY NOW WE KNOW ────────────────────────
      //
      // THE PURCHASE STEP HAS TO SEARCH. It opens the shop's list of recent
      // orders, harvests the numbers and opens them one at a time until one of
      // them is the campaign's product, because nobody has said yet which order
      // this is about.
      //
      // THIS STEP DOES NOT, AND SEARCHING HERE IS A BUG. The order was chosen
      // pages ago and its number is on the record. Searching again means the
      // read is at the mercy of how many cards the shop's list happens to have
      // drawn — measured on the owner's own phone, 16 September 2026: the list
      // was read while it was still filling in, four cards instead of six, two
      // of those four were payments rather than purchases, and the order this
      // task is actually about was never opened at all. The delivery was on a
      // page the look never asked for.
      //
      // So it is named. One page, the right one, every time.
      //
      // NULL IS STILL A SEARCH, deliberately: a task with no order number on it
      // yet has nothing to name, and the ordinary search is the honest fallback
      // rather than a read of nothing.
      const known = campaignId ? getAuthoritative(campaignId) : null;
      const itsOrder = known && known.order && typeof known.order.id === 'string'
        && known.order.id !== '' ? known.order.id : null;
      navigation.navigate('LookingForIt', { campaignId, onlyThisOrder: itsOrder });
    }
  }, [navigation, campaignId, taskId]);

  // ── AND NOBODY IS LEFT WATCHING A WORD THAT NEVER CHANGES ───────────────
  //
  // Leaving for the read normally takes this screen away within a frame. When it
  // does not — a navigator that refused the move, or this screen opened with no
  // navigator at all, as the walk through opens it — the reading state has to
  // end by itself. Same rule as the read's own ceiling next door.
  useEffect(() => {
    if (where !== 'reading') return undefined;
    const giveUp = setTimeout(() => setWhere('nothing'), READ_SHOULD_HAVE_LEFT_MS);
    return () => clearTimeout(giveUp);
  }, [where]);

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
  const reading = where === 'reading' && !delivered;
  const asking = where === 'asking' && !delivered;

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.body}>
        <Text style={styles.parcel}>📦</Text>

        {/* ── STEP SEVEN, ABOVE EVERYTHING ELSE ON THIS STEP ──────────────
            The sentence the owner asks for the moment somebody confirms the
            order is theirs. Confirming is what moves the record to this step, so
            this screen is the first thing they see afterwards.

            IT GOES AS SOON AS THE PARCEL IS KNOWN TO HAVE ARRIVED, because by
            then it is about a thing that has already happened. */}
        {!delivered ? (
          <Text style={[hSub, styles.thanks]}>
            {THANK_YOU_FOR_CONFIRMING} {USE_IT_AND_REVIEW_FAIRLY}
          </Text>
        ) : null}

        <Text style={[hTitle, styles.title]}>
          {delivered
            ? 'It arrived'
            : asking
              ? IS_THE_PRODUCT_DELIVERED
              : reading ? 'Checking' : 'Not yet'}
        </Text>
        <Text style={[hSub, styles.sub]}>
          {delivered
            ? `${shop} has told us it arrived. The review step is open.`
            : asking
              ? `Tell us and we will read it off your own ${shop} orders. `
                + 'There is nothing to send us.'
              : reading
                ? `Checking your ${shop} orders…`
                : product
                  ? `We checked your ${shop} orders. ${shop} has not said your `
                    + `${product} arrived yet.`
                  : `We checked your ${shop} orders. ${shop} has not said it `
                    + 'arrived yet.'}
        </Text>

        {!reading && !asking && !delivered ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nothing to do</Text>
            <Text style={styles.cardBody}>
              We read the delivery from your own orders on {shop}, so there is
              nothing to tap and nothing to tell us. We look again next time you
              open this. If it has arrived and {shop} is slow to say so, send us a
              picture and a person will take it from there.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        {/* ── STEP EIGHT'S TWO ANSWERS, AND NEITHER ONE SETTLES ANYTHING ───
            YES starts the read of the shop's own page. It does not say the
            parcel came, it does not move the task, and it does not reach
            anything that decides money. NO simply leaves: nothing has changed,
            their place is still held, and My Products brings them back here.

            BOTH WORDS COME FROM src/ui/journeyWords.js, which Fayr's plain
            language rule reads off disk. */}
        {asking ? (
          <>
            <Pill onPress={theySaidYes} color={COLOR.greenDeep}>
              {YES.toUpperCase()}
            </Pill>
            <Pill onPress={() => goBackOrHome(navigation)} color={COLOR.line}>
              {NO.toUpperCase()}
            </Pill>
          </>
        ) : null}

        {/* THE ONE THING THERE IS TO OFFER, and only once the read has run.
            Offering it while the shop is still being read would be asking for a
            photograph of something Fayr is in the middle of reading for itself,
            and offering it before the question is answered would be asking for
            one before anybody had looked at all. */}
        {!reading && !asking && !delivered ? (
          <Ghost
            onPress={() => navigation.navigate('ProofUpload', {
              campaignId, kind: 'DELIVERY',
            })}
          >
            Send a picture of the delivery
          </Ghost>
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
  thanks: { textAlign: 'center', maxWidth: 300, marginTop: 14 },
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
