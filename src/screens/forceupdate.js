// forceupdate — fayr-design.browser.jsx:518
//
// This version of the app can no longer be used. The design's own screen: the
// icon, the heading, the sentence and the one button, in that order.
//
// NOTHING DECIDES TO SHOW THIS YET. There is no version check anywhere in Fayr,
// so nothing can work out that a version has been retired. The screen is built
// and registered so that the day the check arrives it has somewhere to send
// people, and so it can be looked at now. Until then it is reached only from the
// walk through.
import React from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, SPACE } from '../ui/theme';
import { Pill, hSub, hTitle } from '../ui/brand';

/** Where the button goes. The store listing, on whichever phone this is. */
const STORE = Platform.select({
  ios: 'itms-apps://apps.apple.com/app/id0000000000',
  android: 'market://details?id=com.fayr.app',
  default: 'https://fayr.app',
});

export default function ForceUpdateScreen({ route }) {
  const insets = useSafeAreaInsets();
  // The store address can be handed in, so the day there is a real listing this
  // screen does not have to change to point at it.
  const where = (route && route.params && route.params.storeUrl) || STORE;

  return (
    <View style={styles.root}>
      <View style={[styles.body, { paddingTop: insets.top + 30 }]}>
        <Text style={styles.icon}>🔄</Text>
        <Text style={[hTitle, styles.title]}>A new version is required</Text>
        <Text style={[hSub, styles.sub]}>
          This version of fayr is no longer supported. Update to keep earning
          securely.
        </Text>
      </View>
      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Pill onPress={() => Linking.openURL(where).catch(() => {})}>UPDATE NOW</Pill>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  // No back and no way out, on purpose. The design draws none, and an app that
  // cannot be used is not one somebody should be able to step around.
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  icon: { fontSize: 60 },
  title: { marginTop: 18, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 270 },
  foot: { paddingHorizontal: 28 },
});
