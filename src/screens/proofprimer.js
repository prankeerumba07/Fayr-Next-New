// proofprimer — fayr-design.browser.jsx:2588 (ProofPrimer)
//
// What a screenshot of the order has to show, before somebody goes and takes one.
// Split out of src/journey/JourneyScreen.js on 1 September 2026, where it was one
// page of ten inside one file.
//
// THE DESIGN'S OWN CONTENT, IN THE DESIGN'S ORDER: the heading, the sentence
// naming the shop's orders page, the sample card with the order number circled,
// the red line about the order number, and the one button.
//
// TWO DEPARTURES:
//
//  * THE SAMPLE ORDER NUMBER IS NOT COPIED. The design writes a real-looking
//    Amazon order number into the file. Showing a made-up number in a picture of
//    what to send is the fastest way to have somebody send us that number, so the
//    sample shows the SHAPE and says in words what belongs there.
//  * THE INBOX CARD IS GONE FROM THIS SCREEN, on the owner's instruction, 11
//    September 2026. The design opens with a card offering to read order emails
//    instead of taking screenshots, and this screen carried it with a line saying
//    it was not ready yet. He does not want it offered here in any form — not as
//    a coming-soon, not as a greyed-out card, not at all.
//
//    IT IS REMOVED, NOT HIDDEN. No flag, no wrapper that could be switched back
//    on by accident, no styles left behind for it. The screen that connects an
//    inbox still exists and is still reachable from the walk through
//    (src/screens/emailconnect.js); what is gone is this screen OFFERING it.
//
//    In its place is the true thing, said warmly and in two lines: Fayr looked
//    for the order itself, did not find it, and is asking. Somebody who lands
//    here has just watched a turning ring come back with nothing, and a screen
//    that opened with an unrelated offer read as a change of subject.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { PLATFORMS } from '../platforms';
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Pill, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen, ProductImage } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';

export default function ProofPrimerScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : 'the shop';
  const product = campaign ? campaign.productName || campaign.title : null;

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Order proof" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        {/* WHY THEY ARE HERE, SAID WARMLY AND SAID FIRST. They have just watched a
            turning ring come back with nothing, so the honest opening is that
            Fayr looked, did not find it, and is asking. It names no shop, no
            account and no reason — there is nothing here a person could act on
            beyond the screenshot the rest of the screen asks for. */}
        <View style={styles.lead}>
          <Text style={styles.leadTitle}>We couldn’t spot this one ourselves</Text>
          <Text style={styles.leadBody}>
            Send over a screenshot of your order and we’ll take it from there.
          </Text>
        </View>

        <Text style={[hTitle, styles.title]}>Grab a screenshot of your order</Text>
        <Text style={hSub}>
          From your <Text style={styles.strong}>{shop} orders page</Text>. Here is
          exactly what we need:
        </Text>

        <View style={styles.sampleCard}>
          <View style={styles.sample}>
            <Text style={styles.sampleHead}>{shop} · Your Orders</Text>
            <View style={styles.sampleRow}>
              <ProductImage
                imageUrl={campaign ? campaign.imageUrl : null}
                seed={campaignId}
                radius={9}
                style={styles.sampleThumb}
              />
              <View style={styles.flex}>
                <Text style={styles.sampleProduct} numberOfLines={2}>
                  {product || 'The product you bought'}
                </Text>
                {/* THE SHAPE, NOT A NUMBER. See the note at the top of this file. */}
                <View style={styles.circled}>
                  <Text style={styles.circledText}>Order #  your own order number</Text>
                </View>
              </View>
            </View>
          </View>
          <Text style={styles.mustShow}>
            The order number has to be readable. That is the part in the box.
          </Text>
        </View>

        <View style={styles.alsoCard}>
          <Text style={styles.alsoTitle}>Three things in one picture</Text>
          {[
            'The product, so we can see it is the right one',
            'The amount you paid',
            'The date you ordered it',
          ].map((line) => (
            <View key={line} style={styles.alsoRow}>
              <Text style={styles.alsoDot}>•</Text>
              <Text style={styles.alsoText}>{line}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <Pill
          onPress={() => navigation.navigate('ProofUpload', {
            campaignId, kind: 'PURCHASE',
          })}
          color={COLOR.ink}
        >
          SEND A SCREENSHOT
        </Pill>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: SPACE.xl, paddingTop: 4, paddingBottom: SPACE.xl },

  // The lead. Quiet on purpose: it is a friendly word before the instruction,
  // not a second heading competing with the one under it.
  lead: { marginTop: 6, marginBottom: SPACE.lg },
  leadTitle: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.ink2 },
  leadBody: {
    fontFamily: FONT.bodyMed, fontSize: 12.5, lineHeight: 18, color: COLOR.sub,
    marginTop: 3,
  },

  title: { fontSize: 23, lineHeight: 28 },
  strong: { fontFamily: FONT.bodyBold, color: COLOR.ink2 },

  sampleCard: {
    marginTop: SPACE.lg, backgroundColor: '#fff', borderRadius: RADIUS.lg,
    padding: 14, ...SHADOW.card,
  },
  sample: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLOR.line,
    borderRadius: RADIUS.md, padding: 12,
  },
  sampleHead: { fontFamily: FONT.bodyBold, fontSize: 11, color: '#232F3E' },
  sampleRow: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center' },
  sampleThumb: { width: 44, height: 44 },
  sampleProduct: {
    fontFamily: FONT.bodyBold, fontSize: 11.5, lineHeight: 16, color: COLOR.ink2,
  },
  circled: {
    alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#FFF3B0',
    borderWidth: 1.5, borderColor: COLOR.red, borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  circledText: { fontFamily: FONT.bodyMed, fontSize: 11, color: COLOR.ink2 },
  mustShow: {
    fontFamily: FONT.bodySemi, fontSize: 11.5, lineHeight: 17, color: COLOR.red,
    marginTop: 10,
  },

  alsoCard: {
    marginTop: 12, backgroundColor: COLOR.creamDeep, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  alsoTitle: { fontFamily: FONT.displaySemi, fontSize: 13, color: COLOR.ink2 },
  alsoRow: { flexDirection: 'row', gap: 8, marginTop: 5 },
  alsoDot: { fontFamily: FONT.bodyBold, fontSize: 12, color: COLOR.ink2 },
  alsoText: {
    flex: 1, fontFamily: FONT.bodyMed, fontSize: 12, lineHeight: 18, color: COLOR.sub,
  },

  foot: { paddingHorizontal: SPACE.xl, paddingTop: 10, paddingBottom: SPACE.xl },
});
