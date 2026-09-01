// underreview — fayr-design.browser.jsx:2948 (UnderReview)
//
// "Proof under review" — the wait while a person at Fayr looks at what was sent.
// Split out of src/journey/JourneyScreen.js on 1 September 2026, where it shared
// one page with the design's ocrconfirm screen; they are two screens now, because
// they do two different things. This one is the wait. ocrconfirm is the details.
//
// THE DESIGN'S OWN SCREEN: the magnifying glass in a blue circle, the heading, the
// sentence about how long and about being told, and the two actions.
//
// THREE DEPARTURES, ALL ABOUT NOT PROMISING WHAT FAYR DOES NOT DO:
//
//  * The design's main button is "CONTINUE (DEMO: SKIP WAIT)", which jumps the
//    queue. There is nothing to skip: a person at Fayr really has to look. The
//    button is gone and the screen offers the honest action instead, which is to
//    go and do something else.
//  * The design says "every transition notifies you". Fayr sends no notifications
//    yet, so that half of the sentence is not copied. What is true is that the
//    claim's own page always says where it stands, and that is what is said.
//  * The design writes a fixed "Usually within 2 hours" into the screen. How long
//    it takes is not something the app knows, so nothing invents a figure: the
//    wait is handed in, and when nothing hands one in the screen says so plainly.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';

export default function UnderReviewScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  // The design's `title` and `eta` are both parameters in the design too — it
  // reuses this screen for the review wait as well — so they are parameters here.
  const title = typeof params.title === 'string' && params.title
    ? params.title
    : 'Proof under review';
  const howLong = typeof params.howLong === 'string' && params.howLong
    ? params.howLong
    : null;

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.body}>
        <View style={styles.circle}>
          <Text style={styles.glass}>🔎</Text>
        </View>
        <Text style={[hTitle, styles.title]}>{title}</Text>
        <Text style={[hSub, styles.sub]}>
          {howLong
            ? `${howLong}. You can close the app. Nothing is lost while you wait.`
            : 'A person at Fayr is checking it. We cannot say exactly how long that '
              + 'takes, so we will not guess. You can close the app: nothing is '
              + 'lost while you wait.'}
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardText}>
            Nothing is needed from you on this screen. Your claim&apos;s own page
            always says where it stands.
          </Text>
        </View>
      </View>
      <View style={styles.foot}>
        <Ghost onPress={() => navigation.navigate('Task', { campaignId })}>
          See where this claim stands
        </Ghost>
        <TextBtn onPress={() => goBackOrHome(navigation)}>Back to my products</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  circle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: COLOR.blueBg,
    alignItems: 'center', justifyContent: 'center',
  },
  glass: { fontSize: 38 },
  title: { marginTop: 18, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 280 },
  card: {
    marginTop: SPACE.xl, backgroundColor: COLOR.blueBg, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, maxWidth: 300,
  },
  cardText: {
    fontFamily: FONT.bodyMed, fontSize: 12.5, lineHeight: 19, color: '#2F6FD0',
    textAlign: 'center',
  },
  foot: { paddingHorizontal: 28, paddingBottom: 28 },
});
