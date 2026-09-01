// newdevice — fayr-design.browser.jsx:796
//
// Signing in on a new phone while there is money in the wallet, so the code is
// asked for again before anything else happens. The design's own screen: the
// bar, the shield, the heading, the sentence and the one button.
//
// NOTHING DECIDES TO SHOW THIS YET. Fayr records no device against a session, so
// nothing can tell a new phone from the usual one. It is worth saying plainly
// that this screen does not currently ADD any safety: every sign in already needs
// a code, so there is no weaker path for this to strengthen. It becomes worth
// wiring the day there is a second way in, such as Truecaller.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, FONT, SHADOW } from '../ui/theme';
import { Pill, hSub, hTitle } from '../ui/brand';

export default function NewDeviceScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const back = params.onBack || (() => navigation && navigation.goBack && navigation.goBack());
  const send = params.onSendCode || back;

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={back}
          style={styles.back}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.barTitle}>Security check</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.icon}>🛡️</Text>
        <Text style={[hTitle, styles.title]}>Let&apos;s make sure it&apos;s you</Text>
        <Text style={[hSub, styles.sub]}>
          You&apos;re signing in on a new device and your wallet has a balance.
          We&apos;ll re-verify with an OTP to keep your earnings safe.
        </Text>
      </View>
      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Pill onPress={send}>SEND OTP</Pill>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingBottom: 8,
  },
  back: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 17, color: COLOR.ink },
  barTitle: { fontFamily: FONT.bodyBold, fontSize: 16, color: COLOR.ink2 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  icon: { fontSize: 56 },
  title: { marginTop: 16, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 285 },
  foot: { paddingHorizontal: 28 },
});
