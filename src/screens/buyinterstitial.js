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
import { getAuthoritative } from '../taskStore';

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

  const openTheirApp = useCallback(async () => {
    await putOnClipboard();
    if (campaignId) markVisitedShop(campaignId, WENT_TO_BUY);
    await openShopApp(key, opens);
  }, [putOnClipboard, key, opens, campaignId]);

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
        <Pill onPress={openTheirApp} color={COLOR.ink}>
          OPEN {shop.toUpperCase()} →
        </Pill>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
