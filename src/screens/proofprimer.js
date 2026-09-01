// proofprimer — fayr-design.browser.jsx:2588 (ProofPrimer)
//
// What a screenshot of the order has to show, before somebody goes and takes one.
// Split out of src/journey/JourneyScreen.js on 1 September 2026, where it was one
// page of ten inside one file.
//
// THE DESIGN'S OWN CONTENT, IN THE DESIGN'S ORDER: the inbox card at the top, the
// "or upload manually" divider, the heading, the sentence naming the shop's orders
// page, the sample card with the order number circled, the red line about the order
// number, and the one button.
//
// TWO DEPARTURES:
//
//  * THE SAMPLE ORDER NUMBER IS NOT COPIED. The design writes a real-looking
//    Amazon order number into the file. Showing a made-up number in a picture of
//    what to send is the fastest way to have somebody send us that number, so the
//    sample shows the SHAPE and says in words what belongs there.
//  * THE INBOX CARD OPENS THE DESIGN'S OWN INBOX SCREEN, which was built later the
//    same day and is the page the owner asked about by name. Connecting an inbox is
//    the strongest evidence Fayr can hold, because the shop signs its own email and
//    a person cannot forge one, and that screen says on itself that Fayr has
//    nowhere to connect one to yet. The card says the same in one line, so nobody
//    taps it expecting it to work.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
        {/* The inbox card, where the design puts it: at the moment of need. */}
        <TouchableOpacity
          style={styles.inbox}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('emailconnect', { campaignId })}
          accessibilityRole="button"
        >
          <View style={styles.inboxIcon}><Text style={styles.inboxEmoji}>📧</Text></View>
          <View style={styles.flex}>
            <Text style={styles.inboxTitle}>Skip screenshots — connect your inbox</Text>
            <Text style={styles.inboxBody}>
              We would read only order emails from {shop} and the other shops we
              work with, never your personal mail.
            </Text>
            <Text style={styles.inboxSoon}>
              Not ready yet. Tap to see what it will do, then send a screenshot below.
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.divider}>or send a screenshot</Text>

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

  inbox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLOR.line,
    borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 13,
    ...SHADOW.card,
  },
  inboxIcon: {
    width: 40, height: 40, borderRadius: 11, backgroundColor: COLOR.creamDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  inboxEmoji: { fontSize: 20 },
  inboxTitle: { fontFamily: FONT.bodyBold, fontSize: 13.5, color: COLOR.ink2 },
  inboxBody: {
    fontFamily: FONT.bodyMed, fontSize: 11, lineHeight: 16, color: COLOR.sub,
    marginTop: 2,
  },
  inboxSoon: {
    fontFamily: FONT.bodyBold, fontSize: 11, color: '#8A5A00', marginTop: 6,
  },

  divider: {
    textAlign: 'center', fontFamily: FONT.bodyMed, fontSize: 11,
    color: '#A9AA9C', marginVertical: 12,
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
