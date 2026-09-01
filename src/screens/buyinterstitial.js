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
//  * The design opens the shop's homepage in a browser tab. Here the shop opens
//    inside Fayr, on the same address, which is what the OPENS box shows.
import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { PLATFORMS } from '../platforms';
import { markVisitedShop } from '../journey/shopVisits';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { CardBox, Pill, TopBar } from '../ui/brand';
import { Screen, ProductImage } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';

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
  const key = campaign ? campaign.marketplace : params.marketplace || 'amazon';
  const platform = PLATFORMS[key];
  const shop = platform ? platform.name : String(key);
  const opens = platform ? platform.startUrl : null;

  const go = useCallback(() => {
    if (campaignId) markVisitedShop(campaignId);
    navigation.navigate(key, { campaignId });
  }, [navigation, key, campaignId]);

  const product = campaign
    ? campaign.productName || campaign.title
    : params.productName || null;

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Before you go" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
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
      </ScrollView>

      <View style={styles.foot}>
        <Pill onPress={go} color={COLOR.ink}>OPEN {shop.toUpperCase()} →</Pill>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: SPACE.xl, paddingTop: 4, paddingBottom: SPACE.xl },
  spaced: { marginTop: 12 },

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

  foot: { paddingHorizontal: SPACE.xl, paddingTop: 10, paddingBottom: SPACE.xl },
});
