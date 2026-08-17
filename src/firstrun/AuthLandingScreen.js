// AuthLanding — fayr-design.browser.jsx:611.
//
// ONE CHANGE from the design, agreed explicitly: the design's PRIMARY button is
// "Continue with Truecaller", which needs the Truecaller SDK (native) plus a
// backend verify path — neither exists. Rather than show a button that cannot
// work, phone becomes the primary action and Truecaller is not shown at all.
// Everything else — the mark, the grid, "Shop. Review. Earn.", the reassurance
// line and the terms footnote — is the design's.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { GridFloor, LogoMark, Pill, hSub, hTitle } from '../ui/brand';

export default function AuthLandingScreen({ onContinue, onOpenPolicy }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <GridFloor style={styles.grid} />
        <LogoMark size={64} />
        <Text style={[hTitle, styles.title]}>Shop. Review. Earn.</Text>
        <Text style={[hSub, styles.sub]}>We only use your number to verify you.</Text>
      </View>

      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 26) }]}>
        <Pill onPress={onContinue}>Continue with phone number</Pill>
        <Text style={styles.terms}>
          By continuing you agree to our{' '}
          <Text style={styles.link} onPress={() => onOpenPolicy && onOpenPolicy('terms')}>Terms</Text>
          {' '}&amp;{' '}
          <Text style={styles.link} onPress={() => onOpenPolicy && onOpenPolicy('privacy')}>Privacy Policy</Text>.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  grid: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 170 },
  title: { fontSize: 30, marginTop: 20, textAlign: 'center' },
  sub: { textAlign: 'center' },
  foot: { paddingHorizontal: 26 },
  terms: {
    fontFamily: FONT.body, fontSize: 11, color: COLOR.sub,
    textAlign: 'center', marginTop: 14, lineHeight: 17,
  },
  link: { fontFamily: FONT.bodySemi, textDecorationLine: 'underline', color: COLOR.ink2 },
});
