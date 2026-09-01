// otplocked — fayr-design.browser.jsx:766
//
// Five wrong codes, so entry is paused. The design's own screen, split out of
// src/firstrun/OtpScreen.js where it was an interior state that only appeared
// after getting a real code wrong five times.
//
// THE WORDING IS NOW THE DESIGN'S. The app said "This account is on hold", which
// is not what this is: the account is fine, the typing is paused. The design says
// "Too many attempts", and the design wins.
//
// THE COUNTDOWN IS NOT INVENTED. The design starts a timer at fourteen minutes
// and thirty two seconds, written into the file. A number written into the app
// would be wrong every time it was shown, so the seconds are handed in by
// whoever knows, and when nobody does the screen says to try again shortly
// instead of counting down to a moment it made up.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, FONT } from '../ui/theme';
import { Ghost, hSub, hTitle } from '../ui/brand';

/** Seconds as minutes and seconds, the way the design writes them. */
export function countdown(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export default function OtpLockedScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const [left, setLeft] = useState(
    typeof params.secondsLeft === 'number' ? params.secondsLeft : null,
  );

  useEffect(() => {
    if (left == null) return undefined;
    const tick = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [left == null]);

  const clock = countdown(left);
  const support = () => {
    if (params.onSupport) params.onSupport();
    else if (navigation && navigation.navigate) navigation.navigate('Support');
  };

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.barTitle}>Verify OTP</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.icon}>🔒</Text>
        <Text style={[hTitle, styles.title]}>Too many attempts</Text>
        <Text style={[hSub, styles.sub]}>
          For your security, OTP entry is paused.
          {clock ? ' Try again in ' : ' You can try again shortly.'}
          {clock ? <Text style={styles.strong}>{clock}</Text> : null}
          {clock ? '.' : ''}
        </Text>
      </View>
      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Ghost onPress={support}>Contact support</Ghost>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  bar: { paddingHorizontal: 18, paddingBottom: 8 },
  barTitle: { fontFamily: FONT.bodyBold, fontSize: 16, color: COLOR.ink2 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  icon: { fontSize: 56 },
  title: { marginTop: 16, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 270 },
  strong: { fontFamily: FONT.bodyBold, color: COLOR.ink2 },
  foot: { paddingHorizontal: 28 },
});
