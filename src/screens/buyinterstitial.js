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
// AND THE PRODUCT NAME GOES ON THE CLIPBOARD, on either door. The owner asked for
// it so nobody has to type a product name into a search box. It is the name and
// nothing else — no price, no shop, nothing of ours — because anything extra turns
// a search that finds the product into a search that finds nothing. The screen says
// out loud that the clipboard changed, and says so if it could not.
import React, { useCallback, useState } from 'react';
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
import { getAuthoritative, getTaskId } from '../taskStore';
import { goingToTheShop } from '../backend/tasksApi';
import { noticeFromTask } from '../journey/theNotice';
import { COULD_NOT_START, NOTHING_WAS_SPENT, TRY_AGAIN } from '../ui/journeyWords';
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
  // HOW LONG IS LEFT TO BUY, in the same one line the connect page and the slot
  // reserved moment use. The confirmation page carried this in a card of its own
  // until the owner took that page off the path on 2 September 2026.
  const deadline = deadlineLine(getAuthoritative(campaignId), new Date());
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
        {couldNotStart ? (
          <View style={styles.couldNot}>
            <Text style={styles.couldNotText}>{COULD_NOT_START}</Text>
            <Text style={styles.couldNotText}>{NOTHING_WAS_SPENT}</Text>
          </View>
        ) : null}
        {/* TWO WRITINGS OF ONE BUTTON, AND THE DESIGN'S OWN IS KEPT INTACT.
            Its before you go screen reads "OPEN AMAZON →"
            (fayr-design.browser.jsx:2568), and src/ui/shopApp.test.mjs reads this
            file to check that wording is still here. Folding both into one
            template string broke that check, so the two are written out
            separately: the design's words stay exactly as the design has them,
            and the retry is its own line. */}
        {couldNotStart ? (
          <Pill onPress={openTheirApp} color={COLOR.ink}>
            {TRY_AGAIN.toUpperCase()}
          </Pill>
        ) : (
          <Pill onPress={openTheirApp} color={COLOR.ink}>
            OPEN {shop.toUpperCase()} →
          </Pill>
        )}
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
