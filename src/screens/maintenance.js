// maintenance — fayr-design.browser.jsx:530
//
// Fayr is down on purpose, and the person's money is safe. The design's own
// screen: the icon, the heading, the sentence, the white card with the time it
// is expected back, and the one quiet button.
//
// THE TIME IS NOT INVENTED. The design draws the card with "Expected back by
// 6:00 PM" written into it. A time written into the app would be wrong every
// time it was shown, so the time is handed in, and when nothing hands one in the
// card says plainly that there is no time yet. That is the only departure from
// the design on this screen, and it is a departure from a placeholder.
//
// NOTHING DECIDES TO SHOW THIS YET. The backend has a readiness route the app
// has never asked, and a server that is down cannot answer anyway, so telling a
// planned outage apart from a broken connection needs work that does not exist.
// Today an outage reads to somebody as their own phone being at fault.
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, FONT, RADIUS } from '../ui/theme';
import { Ghost, hSub, hTitle } from '../ui/brand';

export default function MaintenanceScreen({ route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const backBy = typeof params.backBy === 'string' ? params.backBy.trim() : '';
  const statusPage = params.statusUrl || 'https://fayr.app/status';

  return (
    <View style={styles.root}>
      <View style={[styles.body, { paddingTop: insets.top + 30 }]}>
        <Text style={styles.icon}>🛠️</Text>
        <Text style={[hTitle, styles.title]}>We&apos;ll be right back</Text>
        <Text style={[hSub, styles.sub]}>
          fayr is under scheduled maintenance. Your campaigns and earnings are
          safe.
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardText}>
            {backBy ? `Expected back by ${backBy}` : 'We do not have a time yet'}
          </Text>
        </View>
      </View>
      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Ghost onPress={() => Linking.openURL(statusPage).catch(() => {})}>
          Check status page
        </Ghost>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  icon: { fontSize: 60 },
  title: { marginTop: 18, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 280 },
  card: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  cardText: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink2 },
  foot: { paddingHorizontal: 28 },
});
