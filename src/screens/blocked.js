// blocked — fayr-design.browser.jsx:781
//
// This account is restricted. The design's own screen, split out of
// src/firstrun/OtpScreen.js where it was an interior state.
//
// THE WORDING AND THE BUTTONS ARE NOW THE DESIGN'S. The app said "This account is
// on hold" and offered one button. The design says "Your account is restricted",
// explains that activity needs a closer look, and offers TWO things: submit an
// appeal, and contact support. Both are now here.
//
// THE APPEAL HAS NOWHERE TO GO YET. There is no appeal anywhere in Fayr, so the
// button opens the same help route as Contact support and the screen says so in
// one plain line. A button that silently does nothing would be worse than a
// button that says what it can do.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, FONT } from '../ui/theme';
import { Pill, TextBtn, hSub, hTitle } from '../ui/brand';

export default function BlockedScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const help = () => {
    if (params.onSupport) params.onSupport();
    else if (navigation && navigation.navigate) navigation.navigate('Support');
  };

  return (
    <View style={styles.root}>
      <View style={[styles.body, { paddingTop: insets.top + 30 }]}>
        <Text style={styles.icon}>🚫</Text>
        <Text style={[hTitle, styles.title]}>Your account is restricted</Text>
        <Text style={[hSub, styles.sub]}>
          Some activity on this account needs a closer look. You can submit an
          appeal and our team will review it.
        </Text>
      </View>
      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Pill onPress={help}>SUBMIT AN APPEAL</Pill>
        <TextBtn onPress={help}>Contact support</TextBtn>
        <Text style={styles.note}>
          Both of these open the same place today. Write down what happened and
          our team will read it.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  icon: { fontSize: 56 },
  title: { marginTop: 16, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 280 },
  foot: { paddingHorizontal: 28 },
  note: {
    fontFamily: FONT.body,
    fontSize: 11,
    lineHeight: 17,
    color: COLOR.sub,
    textAlign: 'center',
    marginTop: 8,
  },
});
