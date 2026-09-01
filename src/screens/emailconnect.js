// emailconnect — fayr-design.browser.jsx:2640 (EmailConnect)
//
// THE PAGE THE OWNER ASKED ABOUT BY NAME: "they should see the page where they can
// connect their email for order and delivery tracking. They should also have the
// option to manually upload screenshots. Where is that page in the current app?"
//
// It was nowhere. Built on 1 September 2026, exactly as the design draws it.
//
// WHY IT MATTERS MORE THAN ANY OTHER UNBUILT SCREEN. A shop signs its own order
// emails, cryptographically, and a person cannot forge that signature. It is the
// strongest evidence Fayr can ever hold — stronger than reading a web page, and far
// stronger than a screenshot. Everything else on this screen is arranging for Fayr
// to be allowed to read one.
//
// WHAT IS BUILT AND WHAT IS NOT, SAID ON THE SCREEN RATHER THAN FAKED. The screen
// is real: the heading, the three promises about what would be read, the Gmail
// button, the address box with the design's own typo catcher, and the quiet way out
// are all here and all the design's. What is NOT here is anywhere for the answer to
// go: Fayr has no route that connects an inbox and nothing that reads an email. So
// the two actions do not pretend. They say what would happen, and they say that it
// is not ready, and the way out to the screenshot path is real and works today.
//
// A FAKE HERE WOULD BE WORSE THAN NOTHING. A button that spun and then said
// "connected" would tell somebody their orders were being confirmed automatically
// when nothing of the kind was happening, and they would stop sending screenshots.
import React, { useCallback, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import { COLOR, FONT, RADIUS, SHADOW, SPACE } from '../ui/theme';
import { Ghost, Pill, TextBtn, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { looksLikeAnAddress, tidyAddress, typoFix } from '../ui/emailAddress';
import { goBackOrHome } from '../ui/nav';

/** The design's three promises, in its order and its words. */
const PROMISES = [
  ['🔎', 'Marketplace order emails only',
    'Amazon, Flipkart, Meesho, Blinkit, Zepto and Instamart. Purchase, delivery '
    + 'and return updates, and nothing else.'],
  ['📥', 'Read only',
    'We could never send, delete or change anything in your inbox.'],
  ['🚫', 'Never your personal mail',
    'Not read, not stored. You could disconnect it at any time from your profile.'],
];

/** Said in one place, so the two actions cannot describe it differently. */
const NOT_READY = 'Not ready yet. Fayr has nowhere to connect an inbox to, so we '
  + 'are not going to take your address and do nothing with it.';

export default function EmailConnectScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const [typed, setTyped] = useState('');
  const [showNotReady, setShowNotReady] = useState(false);

  const valid = looksLikeAnAddress(typed);
  const fix = typoFix(typed);

  const notReady = useCallback(() => setShowNotReady(true), []);

  const useScreenshots = useCallback(() => {
    navigation.navigate('proofprimer', { campaignId });
  }, [navigation, campaignId]);

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Connect your inbox" onBack={() => goBackOrHome(navigation)} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={[hTitle, styles.title]}>Skip the screenshots?</Text>
        <Text style={hSub}>
          Completely optional. Connect your inbox and we would confirm your orders
          by themselves, or keep sending screenshots, whichever you prefer.
        </Text>

        <View style={styles.promises}>
          {PROMISES.map(([icon, name, what]) => (
            <View key={name} style={styles.promise}>
              <Text style={styles.promiseIcon}>{icon}</Text>
              <View style={styles.flex}>
                <Text style={styles.promiseName}>{name}</Text>
                <Text style={styles.promiseWhat}>{what}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.gmailWrap}>
          <Ghost onPress={notReady}>Connect Gmail — verify straight away</Ghost>
        </View>

        <Text style={styles.divider}>or prove it with a code</Text>

        <View style={[styles.inputWrap, valid && styles.inputWrapOk]}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="you@example.com"
            placeholderTextColor="#A9AA9C"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Your email address"
          />
          {valid ? <Text style={styles.tick}>✓</Text> : null}
        </View>

        {fix ? (
          <TouchableOpacity
            onPress={() => setTyped(fix)}
            style={styles.typo}
            activeOpacity={0.8}
          >
            <Text style={styles.typoText}>Did you mean {fix}?</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.sendWrap}>
          <Pill
            onPress={notReady}
            disabled={!valid}
            color={valid ? COLOR.ink : '#cfcfcf'}
          >
            SEND ME A CODE
          </Pill>
        </View>

        {showNotReady ? (
          <View style={styles.notReady}>
            <Text style={styles.notReadyTitle}>Not built yet</Text>
            <Text style={styles.notReadyBody}>{NOT_READY}</Text>
            <Text style={styles.notReadyBody}>
              When it is, this is the strongest proof Fayr can have: the shop signs
              its own emails and nobody can forge that. For now, a screenshot works
              and a person at Fayr checks it.
            </Text>
          </View>
        ) : null}

        <TextBtn onPress={useScreenshots}>
          No thanks — I will send screenshots
        </TextBtn>
        <Text style={styles.footNote}>
          {tidyAddress(typed) === ''
            ? 'Nothing is sent anywhere from this screen.'
            : 'Nothing is sent anywhere from this screen, including the address '
              + 'you have typed.'}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 22 },

  title: { fontSize: 24, lineHeight: 29 },

  promises: { gap: 10, marginTop: SPACE.lg },
  promise: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 13, ...SHADOW.card,
  },
  promiseIcon: { fontSize: 19 },
  promiseName: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink2 },
  promiseWhat: {
    fontFamily: FONT.bodyMed, fontSize: 11.5, lineHeight: 17, color: COLOR.sub,
    marginTop: 2,
  },

  gmailWrap: { marginTop: SPACE.lg },
  divider: {
    textAlign: 'center', fontFamily: FONT.bodyMed, fontSize: 11,
    color: '#A9AA9C', marginVertical: 12,
  },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: COLOR.line, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 4,
  },
  inputWrapOk: { borderColor: COLOR.green },
  input: {
    flex: 1, fontFamily: FONT.bodySemi, fontSize: 14.5, color: COLOR.ink2,
    paddingVertical: 10,
  },
  tick: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.green },

  typo: {
    alignSelf: 'flex-start', marginTop: 8, backgroundColor: COLOR.purpleBg,
    borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 6,
  },
  typoText: { fontFamily: FONT.bodySemi, fontSize: 12, color: COLOR.purple },

  sendWrap: { marginTop: 12 },

  notReady: {
    marginTop: 14, backgroundColor: COLOR.amberBg, borderWidth: 1,
    borderColor: COLOR.amberLine, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, gap: 8,
  },
  notReadyTitle: { fontFamily: FONT.displaySemi, fontSize: 13, color: '#8A5A00' },
  notReadyBody: {
    fontFamily: FONT.bodyMed, fontSize: 12, lineHeight: 18, color: '#7A5A10',
  },

  footNote: {
    fontFamily: FONT.body, fontSize: 10.5, lineHeight: 16, color: '#A9AA9C',
    textAlign: 'center',
  },
});
