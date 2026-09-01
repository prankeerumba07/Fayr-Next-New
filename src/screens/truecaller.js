// truecaller — fayr-design.browser.jsx:631
//
// The sheet that rises over the sign in screen offering to sign somebody in with
// one tap, using the name and number Truecaller has already verified. The
// design's own layout: the dimmed backdrop, the grab handle, the blue Truecaller
// line, the round avatar, the name, the masked number, Continue, Use another
// method, and the small line about what Truecaller shares.
//
// NOTHING IS CONNECTED BEHIND IT. Fayr has no Truecaller integration and no way
// to turn a Truecaller token into a session, so Continue cannot sign anybody in.
// The screen says that in one plain line rather than offering a button that
// silently fails, and Use another method does what it says.
//
// THE NAME AND NUMBER COME IN AS PARAMETERS, and that is deliberate.
// fayr-design.browser.jsx has a real person's name and a real, only partly
// masked, mobile number written into this screen. That is personal information
// sitting in a file that gets bundled into the web preview, and it is not copied
// here. Nothing on this screen carries a real person unless something hands one
// in, and with nothing handed in it shows the shape and says it is waiting.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, FONT } from '../ui/theme';
import { Pill, TextBtn } from '../ui/brand';

/** Truecaller's own blue. Only ever used on this screen, which is theirs. */
const TRUECALLER_BLUE = '#0087FF';

/**
 * A number with only its last three digits showing.
 *
 * The design writes a number that is barely masked at all. Nothing that leaves
 * this function can identify anybody, and a number too short to mask safely is
 * hidden completely rather than half shown.
 */
export function maskedNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  const last = digits.slice(-3);
  return `+91 ${'•'.repeat(5)} ${'•'.repeat(2)}${last}`;
}

export default function TruecallerScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  const shown = maskedNumber(params.mobile);
  const ready = name.length > 0 && shown != null;

  const dismiss = params.onDismiss
    || (() => navigation && navigation.goBack && navigation.goBack());
  const another = params.onAnotherWay || dismiss;

  return (
    <View style={styles.root}>
      <View style={styles.scrim} />
      <TouchableOpacity style={styles.above} activeOpacity={1} onPress={dismiss} />

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 26) }]}>
        <View style={styles.handle} />
        <Text style={styles.brand}>Verify with Truecaller</Text>

        <View style={styles.avatar}><Text style={styles.avatarFace}>👤</Text></View>
        <Text style={styles.name}>{ready ? name : 'Waiting for Truecaller'}</Text>
        <Text style={styles.number}>{ready ? shown : 'No verified number yet'}</Text>

        <View style={styles.cta}>
          <Pill color={TRUECALLER_BLUE} onPress={params.onContinue} disabled={!ready}>
            Continue
          </Pill>
        </View>
        <TextBtn onPress={another}>Use another method</TextBtn>

        {ready ? null : (
          <Text style={styles.notReady}>
            Signing in this way is not built yet. Use your mobile number instead.
          </Text>
        )}
        <Text style={styles.shares}>
          Truecaller shares your verified name &amp; number with fayr.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,20,20,.45)' },
  above: { flex: 1 },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },
  handle: {
    width: 44, height: 4, borderRadius: 4,
    backgroundColor: '#e2e2d6', marginBottom: 18,
  },
  brand: { fontFamily: FONT.bodyBold, fontSize: 15, color: TRUECALLER_BLUE },
  avatar: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: COLOR.blueBg,
    alignItems: 'center', justifyContent: 'center', marginTop: 16, marginBottom: 10,
  },
  avatarFace: { fontSize: 32 },
  name: { fontFamily: FONT.display, fontSize: 20, color: COLOR.ink2 },
  number: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.sub, marginTop: 2 },
  cta: { alignSelf: 'stretch', marginTop: 18 },
  notReady: {
    fontFamily: FONT.bodyMed, fontSize: 11.5, lineHeight: 17,
    color: COLOR.sub, textAlign: 'center', marginTop: 6,
  },
  shares: {
    fontFamily: FONT.body, fontSize: 10.5,
    color: '#a3a49a', textAlign: 'center', marginTop: 4,
  },
});
