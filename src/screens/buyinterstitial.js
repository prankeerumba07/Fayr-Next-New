// buyinterstitial — fayr-design.browser.jsx:2539 (BuyInterstitial)
//
// The last screen before somebody leaves for the shop. Its whole job is to make
// sure they buy the RIGHT thing: the exact product, in the exact variant, from
// their own account. Split out of src/journey/JourneyScreen.js on 1 September
// 2026, where it was one page of ten inside one file.
//
// THE DESIGN'S OWN CONTENT, IN THE DESIGN'S ORDER: the "Before you go" bar, the
// "Buy exactly this" card with the product and its variant, the three lines about
// how to buy, the OPENS box with the address, and the one button in the shop's own
// colour.
//
// TWO DEPARTURES, BOTH BECAUSE THE APP HAS NO SUCH FACT:
//
//  * "Variant: {variant}". Campaigns carry no variant or size — the audit records
//    this. The line is left out rather than filled with the product name again.
//  * The design opens the shop's homepage in a browser tab. Here there are two
//    doors, because the owner asked for both and they are genuinely different.
//
// THE TWO DOORS, AND WHY BOTH ARE HERE.
//
//   OPEN <SHOP>            the shop inside Fayr, in its own web view. This is the
//                          one that lets Fayr read the order afterwards.
//   GO TO <SHOP> NOW       the shop's own installed app, by its own address,
//                          falling back to the website when it is not installed.
//
// Fayr cannot see inside another app, so an order placed there is invisible until
// the person comes back and lets Fayr read their orders. That is not hidden: one
// plain line on the screen says which door is which and why it matters.
//
// TWO FACES, AND THE SECOND ONE IS WHY THIS SCREEN CHANGED.
//
// The owner tapped Buy, went to Amazon, came back to Fayr, and saw this screen
// exactly as he had left it: "Before you go", and one button offering to open
// Amazon again. The new message was on Home and on My Products, and this is the
// one place he was actually standing, so it was the one place that did not say
// anything. A screen that cannot tell it has already been used is a screen that
// invites somebody to buy the same thing twice.
//
// So once the visit is recorded this screen shows THE SAME ONE MESSAGE the other
// three places show, read off task.message, with the clock beside it, and the one
// button below becomes step seven's question instead of the shop's door again.
// Not one word of that is written here.
//
// AND THE PRODUCT NAME GOES ON THE CLIPBOARD, on either door. The owner asked for
// it so nobody has to type a product name into a search box. It is the name and
// nothing else — no price, no shop, nothing of ours — because anything extra turns
// a search that finds the product into a search that finds nothing. The screen says
// out loud that the clipboard changed, and says so if it could not.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { PLATFORMS } from '../platforms';
import { WENT_TO_BUY, markVisitedShop } from '../journey/shopVisits';
import { copyProductName, openShopApp } from '../openShop';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { CardBox, Pill, TopBar } from '../ui/brand';
import { Screen, ProductImage } from '../ui/primitives';
import { copyLine } from '../ui/shopApp';
import { goBackOrHome } from '../ui/nav';
import { deadlineLine } from '../ui/confirmJoin';
import { applyAuthoritative, getAuthoritative, getTaskId, subscribe } from '../taskStore';
import { goingToTheShop } from '../backend/tasksApi';
import {
  countdownFor, holdIsOver, messageText, noticeFromTask,
} from '../journey/theNotice';
import {
  COULD_NOT_START, HAVE_YOU_BOUGHT_IT, NOTHING_WAS_SPENT,
  NOT_YET, TRY_AGAIN, YES_I_HAVE,
} from '../ui/journeyWords';
import { Modal, TouchableOpacity } from 'react-native';

/** The design's three lines about how to buy, in its order and its words. */
function howToBuy(shop) {
  return [
    ['👤', `Use your own ${shop} account`],
    ['💳', 'Any payment method works'],
    ['🔎', 'Opens the shop — search for the exact product and buy it yourself'],
  ];
}

export default function BuyInterstitialScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  // WATCHED, NOT READ ONCE. This used to be a single read at render time, so the
  // screen could not notice the visit it had itself just recorded. It is the
  // AUTHORITATIVE task and not the optimistic one because the store builds the
  // optimistic copy from a hand written list of fields that does not carry the
  // visit at all — see the note in src/journey/theNotice.js.
  const [authoritative, setAuthoritative] = useState(
    campaignId ? getAuthoritative(campaignId) : null,
  );
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!campaignId) return undefined;
    const sync = () => setAuthoritative(getAuthoritative(campaignId));
    const un = subscribe((id) => {
      if (id !== campaignId) return;
      sync();
    });
    sync();
    return un;
  }, [campaignId]);

  // The clock the message sits beside. Thirty seconds, the same as the opened
  // task screen, because the count is written in whole minutes and a faster tick
  // would only redraw the same words.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // ── WHICH FACE THIS SCREEN IS WEARING ────────────────────────────────────
  //
  // One fact decides it: has our own side recorded the visit? Everything below
  // reads off the authoritative task and writes nothing.
  const hasGone = !!(authoritative && authoritative.wentToShopAt != null);
  // THE ONE RECORD, LONG FORM. The bar above the navigation and the My Products
  // row show the short form of this same string. Built once on the server, in
  // backend engine/journey-message.ts, and READ here.
  const theMessage = messageText(authoritative, 'long');
  const timeLeft = countdownFor(authoritative, now);
  // THE TWO HOURS ARE GONE. The message already says so — the server swaps it for
  // the ran-out one on its own — and what this decides is that there is no way
  // onward, because offering one would be offering something we cannot pay.
  const over = holdIsOver(authoritative, now);

  // HOW LONG IS LEFT TO BUY, in the same one line the connect page and the slot
  // reserved moment use. The confirmation page carried this in a card of its own
  // until the owner took that page off the path on 2 September 2026.
  //
  // AND IT IS HIDDEN THE MOMENT THEY HAVE TAPPED BUY.
  // This line is the CLAIM's own half hour, which the tap spends. Leaving it up
  // afterwards meant that half hour ran out while the two hours were still going
  // and the screen said "Your time to buy has run out." to somebody who had an
  // hour and a half left. Two clocks, and only one of them applies at a time.
  const deadline = hasGone ? null : deadlineLine(authoritative, new Date());
  const key = campaign ? campaign.marketplace : params.marketplace || 'amazon';
  const platform = PLATFORMS[key];
  const shop = platform ? platform.name : String(key);
  const opens = platform ? platform.startUrl : null;

  const product = campaign
    ? campaign.productName || campaign.title
    : params.productName || null;

  // null = not tried yet, true = on the clipboard, false = we could not.
  const [copied, setCopied] = useState(null);

  const putOnClipboard = useCallback(async () => {
    const done = await copyProductName(product);
    setCopied(done);
  }, [product]);

  // THE NOTICE OUR SIDE BUILT, once it has recorded the visit. Null until then,
  // and null is what keeps the shop shut: nothing opens without these words.
  const [notice, setNotice] = useState(null);
  // null = nothing has gone wrong, true = the call failed and we did not open.
  const [couldNotStart, setCouldNotStart] = useState(false);
  const [asking, setAsking] = useState(false);
  /**
   * THEY SAID YES, AND NOW IT GOES SOMEWHERE.
   *
   * ── THIS WAS THE ONE MISSING LINK, AND IT WAS ONE LINE ────────────────────
   *
   * Yesterday this set a flag and the screen said "we have not built the next
   * step yet", which was true of the ROUTE and not of the work. Both screens
   * already existed: src/order/LookingForItScreen.js reads the shop's own list of
   * orders from inside the web view and hands the TEXT to our side, which parses
   * it and decides; src/order/IsThisYourOrderScreen.js shows what came back and
   * asks. The whole path was reachable only from src/screens/returncatch.js, so
   * nobody arriving from "I have bought it" could ever get to it.
   *
   * SO NOTHING IS HALF-BUILT HERE. This screen still reads no order, matches
   * nothing, and moves no task on. It navigates.
   *
   * AND THE SCREENSHOT IS NOT ON THIS PATH. LookingForIt hands back to the
   * journey only when the read found nothing, and the journey then asks for a
   * picture — which is the owner's rule exactly: the screenshot is the fallback,
   * offered when the read finds nothing, and never the first thing.
   */
  const lookForTheOrder = useCallback(() => {
    navigation.navigate('LookingForIt', { campaignId });
  }, [navigation, campaignId]);

  /**
   * TAPPING BUY NOW GOES THROUGH OUR SIDE FIRST.
   *
   * ── AND IF THAT FAILS, THE SHOP DOES NOT OPEN ─────────────────────────────
   *
   * A visit our own side does not know about is a visit that can never be paid.
   * Sending somebody shopping on a promise nothing recorded is worse than making
   * them tap twice, so a failure keeps them exactly where they are, says what did
   * not happen, and offers the tap again.
   *
   * The clipboard is still filled either way. It is the one part of this that
   * costs nothing if the visit is never recorded, and having the product name
   * ready is useful even to somebody who has to tap again.
   */
  const openTheirApp = useCallback(async () => {
    if (asking) return;
    setAsking(true);
    setCouldNotStart(false);
    await putOnClipboard();
    const taskId = campaignId ? getTaskId(campaignId) : null;
    const answer = await goingToTheShop(taskId);
    setAsking(false);
    if (!answer || !answer.ok || !answer.task) {
      setCouldNotStart(true);
      return;
    }
    // ── THE STORE IS TOLD, AND IT IS TOLD FIRST ──────────────────────────────
    //
    // MY BUG, AND THE OWNER FOUND IT ON A REAL PHONE. This screen asked our side
    // to record the visit, read the answer for the pop-up's words, and THREW THE
    // REST OF IT AWAY. Nothing else in the app ever saw that reply. So the store
    // still held the task as it was before the tap, and this screen watches the
    // store — so it went on offering OPEN AMAZON to somebody who had already
    // gone, which is the very thing the last change was supposed to fix. Adding
    // the watching without adding this made the screen watch a record nobody was
    // updating.
    //
    // BEFORE the notice is built, not after: applyAuthoritative notifies every
    // listener, and one of them is this screen. Doing it first means the face
    // behind the pop-up is already the right one when the pop-up is dismissed,
    // rather than changing a moment later in front of them.
    //
    // It also reaches the other three places at once — the bar above the
    // navigation, the My Products row, the opened task screen — because they all
    // read the same store. One reply, one record, four screens.
    applyAuthoritative(answer.task);
    const built = noticeFromTask(answer.task, shop);
    if (built == null) {
      // RECORDED BUT WORDLESS. The row is written, so the hold is real, but this
      // build of the server sent no notice. Drawing a pop-up of our own here is
      // the one thing forbidden, so it is treated as a failure they can retry.
      setCouldNotStart(true);
      return;
    }
    if (campaignId) markVisitedShop(campaignId, WENT_TO_BUY);
    setNotice(built);
  }, [asking, putOnClipboard, campaignId, shop]);

  /** The one button on the notice. Only this opens the shop. Nothing else does. */
  const leaveForTheShop = useCallback(async () => {
    setNotice(null);
    await openShopApp(key, opens);
  }, [key, opens]);

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Before you go" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        {deadline ? <Text style={styles.deadline}>⏰ {deadline}</Text> : null}

        {/* ── THE ONE MESSAGE, ON THE SCREEN THEY ARE ACTUALLY STANDING ON ──
            The same record the bar above the navigation and the My Products row
            read, in its long form, exactly as the opened task screen shows it.
            Built once on the server and READ here: there is no wording of this
            screen's own anywhere in this box, and no fourth version of it.

            The clock beside it ticks on the phone, because a number that changes
            cannot come from a record built on a server. It is NEVER drawn for a
            task with no recorded tap — countdownFor answers nothing to that, and
            this box is not drawn at all without a message. */}
        {theMessage ? (
          <View style={styles.sentMessage}>
            <Text style={styles.sentMessageText}>{theMessage}</Text>
            {timeLeft ? (
              <Text style={styles.sentMessageClock}>⏰ {timeLeft}</Text>
            ) : null}
          </View>
        ) : null}

        <CardBox>
          <Text style={styles.cardTitle}>Buy exactly this</Text>
          <View style={styles.productRow}>
            <ProductImage
              imageUrl={campaign ? campaign.imageUrl : null}
              seed={campaignId}
              radius={12}
              style={styles.thumb}
            />
            <View style={styles.flex}>
              <Text style={styles.productName} numberOfLines={3}>
                {product || 'This offer is no longer here.'}
              </Text>
            </View>
          </View>
        </CardBox>

        <CardBox style={styles.spaced}>
          {howToBuy(shop).map(([icon, line]) => (
            <View key={line} style={styles.howRow}>
              <Text style={styles.howIcon}>{icon}</Text>
              <Text style={styles.howText}>{line}</Text>
            </View>
          ))}
        </CardBox>

        {opens ? (
          <View style={styles.opens}>
            <Text style={styles.opensLabel}>OPENS</Text>
            <Text style={styles.opensUrl}>{opens}</Text>
          </View>
        ) : null}


        {copied === null ? null : (
          <Text style={[styles.copied, copied === false && styles.copiedNo]}>
            {copyLine(product, copied)}
          </Text>
        )}
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
        {couldNotStart && !hasGone ? (
          <View style={styles.couldNot}>
            <Text style={styles.couldNotText}>{COULD_NOT_START}</Text>
            <Text style={styles.couldNotText}>{NOTHING_WAS_SPENT}</Text>
          </View>
        ) : null}

        {/* ── AND WHEN THE TWO HOURS ARE GONE, NOTHING IS OFFERED ────────────
            No question, no shop, no retry. The message above already says the
            two hours ran out and that the offer went to somebody else, and the
            honest thing under that sentence is empty space. A button here would
            be offering something we cannot pay for.

            NOT A DEAD END THOUGH: the back control at the top of the screen is
            untouched, so they can leave and claim something else. So there is
            nothing to render here, and the two blocks below both refuse to draw
            when `over` is true. This comment is the only thing in this place. */}

        {/* ── STEP SEVEN, WHEN THEY HAVE ALREADY GONE ────────────────────────
            The question and both answers come from src/ui/journeyWords.js, which
            Fayr's plain language rule reads off disk.

            YES LOOKS FOR THE ORDER. It navigates to the waiting screen, which
            reads the shop's own list of orders and hands the TEXT to our side to
            judge. NOTHING IS HALF-BUILT HERE: this screen reads no order,
            matches nothing, and moves no task on.

            NOT YET simply leaves. Nothing has changed, their place is still
            held, and My Products brings them back to this exact screen. */}
        {hasGone && !over ? (
          <View style={styles.step7}>
            <Text style={styles.askedText}>{HAVE_YOU_BOUGHT_IT}</Text>
            <Pill onPress={lookForTheOrder} color={COLOR.ink}>
              {YES_I_HAVE.toUpperCase()}
            </Pill>
            <Pill onPress={() => goBackOrHome(navigation)} color={COLOR.line}>
              {NOT_YET.toUpperCase()}
            </Pill>
          </View>
        ) : null}

        {/* TWO WRITINGS OF ONE BUTTON, AND THE DESIGN'S OWN IS KEPT INTACT.
            Its before you go screen reads "OPEN AMAZON →"
            (fayr-design.browser.jsx:2568), and src/ui/shopApp.test.mjs reads this
            file to check that wording is still here. Folding both into one
            template string broke that check, so the two are written out
            separately: the design's words stay exactly as the design has them,
            and the retry is its own line.

            AND NEITHER IS DRAWN ONCE THE VISIT IS RECORDED. The shop's door is
            what the owner was left staring at after he had already walked through
            it. A second tap on it would record nothing new — our side keeps the
            first tap and cannot move it — so all it could do is send somebody to
            buy the same thing twice. */}
        {!hasGone && couldNotStart ? (
          <Pill onPress={openTheirApp} color={COLOR.ink}>
            {TRY_AGAIN.toUpperCase()}
          </Pill>
        ) : null}
        {!hasGone && !couldNotStart ? (
          <Pill onPress={openTheirApp} color={COLOR.ink}>
            OPEN {shop.toUpperCase()} →
          </Pill>
        ) : null}
      </View>

      {/* ── THE NOTICE, OVER EVERYTHING, WITH ONE WAY OUT ───────────────────
          Every sentence in it came from the server on task.shopVisitNoticeText,
          already built with the real clock time inside it. THIS SCREEN WRITES
          NOT ONE WORD OF IT.

          NO WAY PAST IT. onRequestClose does nothing, so Android's own back
          control cannot dismiss it; there is no backdrop control to tap; and the
          only thing on it that responds to a tap is the button. The shop opens
          from that button and from nowhere else. */}
      <Modal
        visible={notice != null}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.noticeBack}>
          <View style={styles.noticeCard}>
            {(notice ? notice.lines : []).map((line, at) => (
              <Text
                key={line}
                style={at === 0 ? styles.noticeHead : styles.noticeLine}
              >
                {line}
              </Text>
            ))}
            <TouchableOpacity
              style={styles.noticeBtn}
              onPress={leaveForTheShop}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.noticeBtnText}>
                {notice ? notice.button : null}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // THE ONE MESSAGE, drawn the same way the opened task screen draws it, so the
  // same words look the same in both places.
  sentMessage: {
    marginBottom: 12, backgroundColor: '#fff', borderWidth: 1,
    borderColor: COLOR.line, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  sentMessageText: {
    fontFamily: FONT.bodySemi, fontSize: 13, lineHeight: 19, color: COLOR.ink2,
  },
  sentMessageClock: {
    fontFamily: FONT.bodyBold, fontSize: 12.5, color: COLOR.red, marginTop: 6,
  },

  step7: { gap: 8 },
  askedText: {
    fontFamily: FONT.bodyBold, fontSize: 15, lineHeight: 21, color: COLOR.ink,
    textAlign: 'center', marginBottom: 2,
  },

  couldNot: { marginBottom: 10 },
  couldNotText: {
    fontFamily: FONT.bodyMed, fontSize: 13, lineHeight: 19,
    color: COLOR.red, textAlign: 'center',
  },
  // OVER EVERYTHING, and opaque behind the card so nothing underneath reads as
  // still tappable.
  noticeBack: {
    flex: 1, backgroundColor: 'rgba(20,20,20,.55)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
  },
  noticeCard: {
    backgroundColor: COLOR.cream, borderRadius: RADIUS.lg,
    paddingHorizontal: 24, paddingVertical: 26, width: '100%',
  },
  noticeHead: {
    fontFamily: FONT.displaySemi, fontSize: 19, color: COLOR.ink,
    textAlign: 'center', marginBottom: 12,
  },
  noticeLine: {
    fontFamily: FONT.bodyMed, fontSize: 14.5, lineHeight: 21,
    color: COLOR.ink2, textAlign: 'center', marginBottom: 10,
  },
  noticeBtn: {
    marginTop: 14, paddingVertical: 14, borderRadius: RADIUS.round,
    backgroundColor: COLOR.ink, alignItems: 'center',
  },
  noticeBtnText: { fontFamily: FONT.bodySemi, fontSize: 14.5, color: '#fff' },

  scroll: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: SPACE.xl, paddingTop: 4, paddingBottom: SPACE.xl },
  spaced: { marginTop: 12 },

  deadline: {
    fontFamily: FONT.bodyBold, fontSize: 12.5, color: COLOR.red, marginBottom: 10,
  },
  cardTitle: {
    fontFamily: FONT.bodyBold, fontSize: 15, color: COLOR.ink2, marginBottom: 10,
  },
  productRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 56, height: 56 },
  productName: {
    fontFamily: FONT.bodyBold, fontSize: 13.5, lineHeight: 19, color: COLOR.ink2,
  },

  howRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 7 },
  howIcon: { fontSize: 14 },
  howText: {
    flex: 1, fontFamily: FONT.bodySemi, fontSize: 12.5, lineHeight: 18,
    color: COLOR.ink2,
  },

  opens: {
    marginTop: 12, backgroundColor: '#fff', borderWidth: 1, borderStyle: 'dashed',
    borderColor: COLOR.line, borderRadius: RADIUS.md, paddingHorizontal: 12,
    paddingVertical: 10,
  },
  opensLabel: { fontFamily: FONT.body, fontSize: 10, letterSpacing: 0.7, color: '#A9AA9C' },
  opensUrl: { fontFamily: FONT.bodyMed, fontSize: 11, color: COLOR.greenDeep, marginTop: 3 },

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
