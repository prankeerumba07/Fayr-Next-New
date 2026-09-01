// imagesuploaded — fayr-design.browser.jsx:3510 (ImagesUploaded)
//
// "Images Uploaded!" — the sheet that comes up when the pictures have arrived, and
// says what happens next. Built on 1 September 2026.
//
// IT WAS NOT BUILT BEFORE, and the note in the walk through said the upload screen
// says so where the picture is, which is where somebody is already looking, and
// that a whole page to repeat it is a tap for nothing. The first half is true. The
// second half missed the point of the screen: it is not there to say the picture
// arrived, it is there to say WHAT TO DO NEXT, and after sending a delivery picture
// what to do next is go and write the review — which nothing was telling anybody.
//
// THE DESIGN'S OWN SHEET: the grab handle, the tick, the heading, the two bullet
// points and the green button.
//
// ONE DEPARTURE, AND IT IS THE DESIGN'S OWN STRUCTURE. The design's two bullets are
// written for one kind of picture, the delivery one. Fayr takes three kinds, and
// telling somebody who just sent a picture of their REVIEW to go and write their
// review would be nonsense. So what happens next is chosen by the kind of picture,
// the same way the design chooses its own wording elsewhere from a variable.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { PLATFORMS } from '../platforms';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { Pill, TextBtn } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';

/**
 * What happens next, per kind of picture.
 *
 * Each returns the design's two bullet points and the one green action. Nothing
 * here promises a picture was accepted: a person at Fayr always decides, and the
 * last bullet says so on every one of the three.
 */
function whatNext(kind, shop) {
  const checked = 'A person at Fayr checks every picture. Nothing is decided by '
    + 'the picture alone.';
  switch (kind) {
    case 'DELIVERY':
      return {
        lines: [
          `Once you have used it, share your honest feedback on the ${shop} product `
          + 'page.',
          'After it is live there, send us a picture of it so your refund can move on.',
          checked,
        ],
        action: 'WRITE MY REVIEW',
        goes: 'reviewguide',
      };
    case 'REVIEW':
      return {
        lines: [
          'We will look for your review on the product page ourselves, and check it '
          + 'is still there before your refund is released.',
          'Nothing else is needed from you.',
          checked,
        ],
        action: 'SEE WHERE THIS STANDS',
        goes: 'Task',
      };
    default:
      return {
        lines: [
          'We will read your order details from the picture and ask you to confirm '
          + 'they are yours.',
          'Then we wait for the shop to tell us it was delivered.',
          checked,
        ],
        action: 'CONFIRM MY ORDER DETAILS',
        goes: 'ocrconfirm',
      };
  }
}

export default function ImagesUploadedScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : 'the shop';
  const next = whatNext(params.kind, shop);

  return (
    <Screen bg={COLOR.homeBg}>
      <View style={styles.top} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.tick}>✅</Text>
        <Text style={styles.title}>Pictures received</Text>
        <View style={styles.lines}>
          {next.lines.map((line) => (
            <View key={line} style={styles.line}>
              <Text style={styles.dot}>•</Text>
              <Text style={styles.lineText}>{line}</Text>
            </View>
          ))}
        </View>
        <Pill
          onPress={() => navigation.navigate(next.goes, { campaignId })}
          color={COLOR.greenDeep}
        >
          {next.action} →
        </Pill>
        <TextBtn onPress={() => goBackOrHome(navigation)}>Not now</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flex: 1 },
  sheet: {
    backgroundColor: COLOR.creamDeep,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 26,
    paddingTop: 22,
    paddingBottom: 26,
  },
  handle: {
    width: 46, height: 4, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.12)',
    alignSelf: 'center', marginBottom: 22,
  },
  tick: { fontSize: 64, textAlign: 'center' },
  title: {
    fontFamily: FONT.displayXBold, fontSize: 28, color: COLOR.ink,
    textAlign: 'center', marginTop: 12, marginBottom: 20,
  },
  lines: { gap: 14, marginBottom: SPACE.lg },
  line: { flexDirection: 'row', gap: 10 },
  dot: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.ink },
  lineText: {
    flex: 1, fontFamily: FONT.bodyMed, fontSize: 14, lineHeight: 21, color: COLOR.sub,
  },
});
