// The terms and the privacy policy, readable in full.
//
// Reached two ways: from the consent line at signup (before agreeing) and from
// Profile (any time afterwards). Both matter — consent to something you cannot
// re-read is not much of a consent, and the clawback right in these terms is what
// makes the fraud model enforceable.
//
// Design language: the gradient header and circular back button from TopBar, the
// oversized display title from My Products, and plain readable body text. No
// cards — this is a document, and boxing each clause would make it harder to read,
// not easier.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { COLOR, FONT, RADIUS, SHADOW, SPACE } from './ui/theme';
import { POLICY_VERSION, PRIVACY, TERMS } from './ui/policy';

/**
 * Works both as a navigator route AND as a modal inside AuthScreen — which is
 * necessary, not clever: AuthScreen renders OUTSIDE the NavigationContainer (the
 * app has no navigator until you are signed in), so at the one moment consent
 * actually matters there is no navigation object to push with. `onClose` is that
 * seam; `doc` lets the caller pick which document opens.
 */
export default function PolicyScreen({ navigation, route, doc: docProp, onClose }) {
  const insets = useSafeAreaInsets();
  const asked = docProp || (route && route.params && route.params.doc);
  const initial = asked === 'privacy' ? 'privacy' : 'terms';
  const [doc, setDoc] = useState(initial);
  const sections = doc === 'privacy' ? PRIVACY : TERMS;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.homeBg]}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => (onClose ? onClose() : navigation.goBack())}
            style={styles.back}
            activeOpacity={0.8}
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>The rules</Text>
        </View>

        {/* Both documents live behind one screen: a person checking "what did I
            agree to" does not know which of the two answers their question. */}
        <View style={styles.switch}>
          {[['terms', 'Terms'], ['privacy', 'Privacy']].map(([k, label]) => (
            <TouchableOpacity
              key={k}
              onPress={() => setDoc(k)}
              style={[styles.switchBtn, doc === k && styles.switchBtnOn]}
              activeOpacity={0.85}
            >
              <Text style={[styles.switchText, doc === k && styles.switchTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.docTitle}>
          {doc === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}
        </Text>
        <Text style={styles.version}>Last updated {POLICY_VERSION}</Text>

        {sections.map((s) => (
          <View key={s.id} style={styles.section}>
            <Text style={styles.heading}>{s.heading}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}

        <Text style={styles.footer}>
          Something here unclear? Ask us from Help — a real person answers.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOR.homeBg },
  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 17, color: COLOR.ink },
  headerTitle: { fontFamily: FONT.display, fontSize: 22, color: COLOR.ink },

  switch: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: RADIUS.pill,
    padding: 3, marginTop: SPACE.lg, ...SHADOW.chip,
  },
  switchBtn: { flex: 1, borderRadius: 20, paddingVertical: 9, alignItems: 'center' },
  switchBtnOn: { backgroundColor: COLOR.ink },
  switchText: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.sub },
  switchTextOn: { color: '#fff' },

  docTitle: { fontFamily: FONT.display, fontSize: 24, color: COLOR.ink },
  version: { fontFamily: FONT.body, fontSize: 11.5, color: '#8b8c80', marginTop: 4, marginBottom: SPACE.lg },
  section: { marginBottom: SPACE.xl },
  heading: { fontFamily: FONT.displaySemi, fontSize: 15.5, color: COLOR.ink, marginBottom: 6 },
  body: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub, lineHeight: 21 },
  footer: {
    fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub,
    textAlign: 'center', marginTop: SPACE.md, lineHeight: 18,
  },
});
