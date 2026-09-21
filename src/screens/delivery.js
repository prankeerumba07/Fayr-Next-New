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
// THE TWO FORMATTERS, from the file that owns them. Both pure, both already
// walked — see src/ui/orderCard.test.mjs. Nothing here formats money or a day
// by hand, which is the rule that keeps two screens from disagreeing about one
// figure.
import { amountInWords, dayInWords } from '../ui/orderCard';
import { PLATFORMS } from '../platforms';
import {
  alreadyLookedForDelivery, rememberWeLookedForDelivery,
} from '../order/deliveryLook';
import { SAID_IT_ARRIVED, hasVisitedShop, markVisitedShop } from '../journey/shopVisits';
import { shopsInsideFayr } from '../shop/insideFayr';
import { mayLookForDeliveryNow, rememberTheDeliveryLook } from '../journey/deliveryCadence';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, Pill, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import {
  IS_THE_PRODUCT_DELIVERED, NO, ORDER_PLACED_WE_SAW_IT, THANK_YOU_FOR_CONFIRMING,
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

  // `tick` is read by the automatic look below, so a screen left open on this
  // step asks the cadence again every half minute — see deliveryCadence.js.
  const [tick, setTick] = useState(0);
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
  // ── A SHOP INSIDE FAYR ASKS NOTHING — 18 SEPTEMBER 2026, PHASE 7 ────────
  //
  // The owner: "delivery fetches itself. No screen, no tap." For Zepto, Blinkit
  // and Instamart the question and its two buttons are not drawn at all; the
  // read is started by this screen opening, on the cadence
  // src/journey/deliveryCadence.js decides, and what is drawn is only "checking"
  // or "not yet". The four other shops keep the question and everything under
  // it, for the reason the long note at the top of this file gives.
  // A PHOTOGRAPH IS STILL NEVER ASKED OF A SHOP INSIDE FAYR. The watched order's
  // own page is read again instead, and that page is the only evidence there is.
  // This flag keeps the camera door shut; it no longer decides whether anybody is
  // ASKED anything — see theShopLooksWithoutBeingAsked directly below.
  const asksNothing = shopsInsideFayr(key);

  // ── AND THE QUESTION IS BACK FOR EVERY SHOP — 21 SEPTEMBER 2026 ─────────
  //
  // This was `shopsInsideFayr(key)`, on the owner's instruction of 18 September:
  // "delivery fetches itself. No screen, no tap." He reversed it on 21 September,
  // in his own words: "there should be a trigger ... 'We can see that you have
  // completed your purchase. Once your order is delivered, please confirm yes or
  // no.' Once someone clicks on yes, the backend actually goes and checks if the
  // product is delivered or not."
  //
  // WHAT THE REVERSAL DOES AND DOES NOT CHANGE. It changes WHO STARTS the read:
  // a tap, instead of this screen opening on a ten minute cadence. It changes
  // nothing about what the read means. The tap writes one device-local note and
  // opens the same read of the same page; the record's delivery still comes only
  // from the server reading the page text the read posts. A Yes on a parcel that
  // has not arrived comes back "Not yet" and moves nothing, which is the whole
  // reason a tap is allowed to be a trigger at all.
  //
  // FALSE AND NOT DELETED, on purpose: the automatic look below and the question
  // further down are two halves of one decision, and a reader who finds only one
  // of them changed would reasonably think the other had been forgotten. One flag
  // holds both halves together and says which way it is set and why.
  const theShopLooksWithoutBeingAsked = false;
  const [where, setWhere] = useState(looked ? 'nothing' : 'asking');
  const started = useRef(false);

  // ── WHAT THE RECORD SAYS, READ BEFORE THE ANSWER IS WIRED UP ────────────
  //
  // `known` is the SHOP's word, off the shop's own page. `saidSo` is whether
  // this person has answered the question. They are different facts and the
  // screen needs both: the record can carry a delivery before anybody has been
  // asked anything, which is the ordinary case for an order whose return window
  // has already closed.
  const task = campaignId ? getAuthoritative(campaignId) : null;
  // THE ORDER AS OUR SIDE HOLDS IT, for the card above the question.
  const order = task && task.order && typeof task.order === 'object' ? task.order : null;
  // The day, as a day, from the instant our side sent. dayInWords wants the
  // "2026-09-21" shape and answers null for anything else, so a date we could
  // not read falls through to whatever the shop printed.
  const orderDay = order && typeof order.date === 'string' && order.date.length >= 10
    ? order.date.slice(0, 10)
    : null;
  const known = !!(task && task.delivery);
  const saidSo = campaignId ? hasVisitedShop(campaignId, SAID_IT_ARRIVED) : false;

  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);

  // ── AND THE CLOCK, SO A SCREEN LEFT OPEN LOOKS AGAIN WHEN IT MAY — 8A ────
  //
  // The owner: "delivery fetches itself. No screen, no tap." Until 19 September
  // 2026 the automatic look ran on arrival and then only on the next arrival,
  // so a phone left on this step for ten minutes never looked again. Every half
  // minute this asks the cadence once more; the cadence, not this clock, says
  // whether a look may start. See the note in deliveryCadence.js.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

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
    // ── THE RECORD ALREADY KNOWS, SO THERE IS NOTHING TO READ ─────────────
    //
    // Their answer is the only thing missing. Asking the shop again for a fact
    // it has already given us is one more request against a shop that rate
    // limits us, for nothing — the same rule the order step keeps when it is
    // handed an order number it already has.
    //
    // THE NOTE IS ALL THIS WRITES. The delivery on the record is not touched,
    // because a tap is not evidence and this one could not be: see the
    // DELIVERED branch in ui/journey.js.
    if (known) {
      if (campaignId) markVisitedShop(campaignId, SAID_IT_ARRIVED);
      if (params.onJourneyMoved) params.onJourneyMoved();
      return;
    }
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
  }, [navigation, campaignId, taskId, known, params]);

  // ── STARTED BY THE SCREEN, FOR A SHOP INSIDE FAYR, AND NOT TOO OFTEN ────
  //
  // The same read the Yes button starts, started without the button. The
  // cadence is the whole of what is decided here: once when the step is reached
  // in a sitting, and again only after LOOK_AGAIN_AFTER_MS — ten minutes, the
  // shop's own delivery time — so a phone left on this step does not ask the
  // shop for pages every time it redraws. The reasoning is beside the number.
  //
  // THE NOTE IS WRITTEN BEFORE THE MOVE, for the same reason the tap's path
  // writes its own first: a screen that comes straight back has no note and
  // starts again.
  //
  // AND IT DOES NOT GO THROUGH theySaidYes — CORRECTED 18 SEPTEMBER 2026. That
  // path refuses a second look in a sitting through deliveryLook.js's own note,
  // which is right for a tap and wrong here: it made the ten minute re-look a
  // promise the screen could not keep, because the very first look in a sitting
  // wrote the note and every later arrival was refused by it. Found by an
  // adversarial review of the phase. So the automatic look opens the read
  // directly, names the order exactly as the tap's path does, and lets the
  // cadence alone decide when it may run again.
  useEffect(() => {
    if (!theShopLooksWithoutBeingAsked || known || taskId == null) return;
    if (!mayLookForDeliveryNow(taskId, Date.now())) return;
    rememberTheDeliveryLook(taskId, Date.now());
    setWhere('reading');
    if (navigation && typeof navigation.navigate === 'function') {
      const record = campaignId ? getAuthoritative(campaignId) : null;
      const itsOrder = record && record.order && typeof record.order.id === 'string'
        && record.order.id !== '' ? record.order.id : null;
      navigation.navigate('LookingForIt', { campaignId, onlyThisOrder: itsOrder });
    }
    // `tick` IS A DEPENDENCY ON PURPOSE: it is what makes an open screen ask
    // the cadence again. The read itself reads the WATCHED ORDER'S OWN PAGE
    // when the record carries its key — whichRead.js decides that inside
    // LookingForIt, from the record, so the order named here is the fallback
    // for a shop whose pages are addressed by their number.
  }, [theShopLooksWithoutBeingAsked, known, taskId, campaignId, navigation, tick]);

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

  // ── THE THREE FACES, AND WHICH ONE IS UP ────────────────────────────────
  //
  // `mustAsk` is the case this screen used to have no answer for: the shop has
  // already said the parcel arrived and the person has not been asked yet. It
  // used to fall straight through to the "It arrived" face, so the owner's step
  // seven — the question — was never once seen on an order whose return window
  // had already closed. The question wins until it is answered.
  const mustAsk = known && !saidSo;
  const delivered = known && saidSo;
  // ── A SHOP INSIDE FAYR IS NEVER ASKED, so `asking` is false for one whatever
  //    `where` says — 18 September 2026 ────────────────────────────────────
  //
  // The two lines above are kept exactly as they were, on purpose: the record's
  // word and the person's answer, narrowed and never widened. For a shop inside
  // Fayr the journey sends a DELIVERED claim straight to the review, so this
  // screen is not drawn with `known` at all for one; what it draws is the wait
  // between looks, and the look is started by the screen on its own cadence.
  const reading = where === 'reading' && !delivered && !mustAsk;
  const asking = (where === 'asking' || mustAsk) && !delivered
    && !theShopLooksWithoutBeingAsked;

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
        {/* ── WHAT FAYR READ OFF THE ORDER, BEFORE IT ASKS ANYTHING ───────
            21 September 2026. The owner watched a purchase complete, came back,
            and was asked "Is the product delivered?" with nothing else on the
            screen: "No, it is not showing the order details."

            A WATCHED ORDER SKIPS THE ORDER-DETAILS STEP ON PURPOSE, and that is
            still right — that screen ASKS "is this your order?", and Fayr
            watched this one being placed from this claim, so the question is
            already answered. Seeing the order and being asked about it are
            different things, and only the question was meant to go.

            THE FOUR THINGS HE ASKED FOR, since the first day: order ID, order
            date, order amount, product name. Every one is read off the record
            and shown as blank when the shop did not print it — nothing here
            invents a figure, and the amount is what the ORDER says rather than
            what the refund will be, which is a different number and is the
            refund step's to state. */}
        {order ? (
          <View style={styles.order}>
            {[
              ['Product', order.product || (campaign ? campaign.productName : null)],
              ['Order ID', order.id],
              ['Order date', dayInWords(orderDay) || order.dateRaw],
              ['Order amount', amountInWords(order.itemPaise)],
            ].map(([label, value]) => (
              <View key={label} style={styles.orderRow}>
                <Text style={styles.orderLabel}>{label}</Text>
                <Text style={styles.orderValue} numberOfLines={2}>
                  {value || 'Not shown by the shop'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {!delivered ? (
          <Text style={[hSub, styles.thanks]}>
            {/* ── WHAT FAYR ALREADY KNOWS, SAID BEFORE ANYTHING IS ASKED ───
                21 September 2026, the owner: "you are saying that we can see
                that you have purchased your order, so there should be a
                trigger". Asking "is it delivered?" of somebody Fayr watched pay
                reads as if Fayr had lost track of them. Saying what we already
                know first is what makes the question a next step rather than a
                doubt.

                THE SENTENCE IS NOT A NEW ONE. ORDER_PLACED_WE_SAW_IT already
                lives in src/ui/journeyWords.js and already passes the plain
                language walk; it is named here, never retyped. */}
            {asking ? `${ORDER_PLACED_WE_SAW_IT} ` : null}
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
              open this.
              {/* THE PICTURE IS OFFERED ONLY WHERE IT IS OFFERED, which since
                  Phase 8A is not on a shop inside Fayr: the watched order's own
                  page is read again instead. The sentence goes with the door. */}
              {!asksNothing
                ? ` If it has arrived and ${shop} is slow to say so, send us a `
                  + 'picture and a person will take it from there.'
                // AND THIS SENTENCE CHANGED WITH THE TRIGGER, 21 September 2026.
                // It used to promise "We look again by ourselves while this is
                // open", which stopped being true the moment the tap became what
                // starts the read. A screen that promises a thing it no longer
                // does is worse than one that says nothing.
                : ' Open this again when it has arrived and we will look.'}
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
        {/* ── AND NEVER FOR A SHOP INSIDE FAYR — PHASE 8A, TASK 4 ──────────
            The owner: "The product is delivered. It should not ask the user if
            the product is delivered." A photograph is the same question asked
            of a camera. For Zepto, Blinkit and Instamart the watched order's own
            page is read again on the cadence, and that page is the only
            evidence there is. The four other shops keep the door. */}
        {!reading && !asking && !delivered && !asksNothing ? (
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
  order: {
    alignSelf: 'stretch', marginTop: 18, borderRadius: 14,
    backgroundColor: COLOR.white, paddingVertical: 4, paddingHorizontal: 14,
  },
  orderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: 12, paddingVertical: 7,
  },
  orderLabel: { fontFamily: FONT.body, fontSize: 12.5, color: COLOR.ink2 },
  orderValue: {
    fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.ink,
    flexShrink: 1, textAlign: 'right',
  },

  foot: { paddingHorizontal: 28, paddingBottom: 28, gap: 8 },
});
