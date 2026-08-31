// THE LIST: every screen in the design, grouped and in order, one tap each.
//
// It holds no copy of the screens. Everything on it comes out of catalogue.js,
// which is checked against the design file itself, so this list cannot say
// something the design does not.
//
// It sits beside the offer page check in the profile, and for the same reason: it
// is for the team, it is useless to a shopper, and hiding it would mean the app
// guessing from the device who works here, which it has no way to know.
import React, { useLayoutEffect, useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { goBackOrHome } from '../ui/nav';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { showTheApp } from '../backend/showing';
import {
  GROUPS, HOW_MANY, NOT_BUILT, SCREENS, WALK, WHAT_THIS_IS, isBuilt,
} from './catalogue';

export const SCREEN_TITLE = 'Walk through every screen';

export default function WalkthroughScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [onlyUnbuilt, setOnlyUnbuilt] = useState(false);

  // The block goes on the moment this opens and off when it closes, rather than
  // when a screen is opened from it: somebody handed the phone here will press
  // things on this page too, and the back arrow out of a screen lands here.
  useLayoutEffect(() => {
    showTheApp(true);
    return () => showTheApp(false);
  }, []);

  const shown = useMemo(
    () => GROUPS.map((g) => ({
      name: g.name,
      keys: onlyUnbuilt ? g.keys.filter((k) => !isBuilt(k)) : g.keys,
    })).filter((g) => g.keys.length > 0),
    [onlyUnbuilt],
  );

  const built = HOW_MANY - NOT_BUILT.length;

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2]}
        style={[styles.head, { paddingTop: insets.top + 10 }]}
      >
        <TouchableOpacity
          onPress={() => goBackOrHome(navigation)}
          style={styles.back}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{SCREEN_TITLE}</Text>
        <Text style={styles.sub}>
          {`${HOW_MANY} screens · ${built} built · ${NOT_BUILT.length} not built yet`}
        </Text>
      </LinearGradient>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: insets.bottom + 40 }}
      >
        {/* The notice, on the page a person is looking at rather than in a file. */}
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{WHAT_THIS_IS}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.startBtn}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('OneScreen', { key: WALK[0] })}
          >
            <Text style={styles.startText}>Start at the first screen →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filter, onlyUnbuilt && styles.filterOn]}
            activeOpacity={0.85}
            onPress={() => setOnlyUnbuilt((v) => !v)}
            accessibilityRole="button"
          >
            <Text style={[styles.filterText, onlyUnbuilt && styles.filterTextOn]}>
              {onlyUnbuilt ? 'Showing only what is missing' : 'Show only what is missing'}
            </Text>
          </TouchableOpacity>
        </View>

        {shown.map((group) => (
          <View key={group.name} style={styles.group}>
            <Text style={styles.groupName}>{group.name.toUpperCase()}</Text>
            {group.keys.map((key) => (
              <Row
                key={key}
                screenKey={key}
                onPress={() => navigation.navigate('OneScreen', { key })}
              />
            ))}
          </View>
        ))}

        <Text style={styles.foot}>
          The order and the groups are the design's own. A test reads them back out
          of the design file, so this list cannot fall behind it.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ screenKey, onPress }) {
  const screen = SCREENS[screenKey];
  const real = isBuilt(screenKey);
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.75} onPress={onPress}>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{screen.title}</Text>
        <Text style={styles.rowKey}>{screenKey}</Text>
      </View>
      <View style={[styles.tag, real ? styles.tagBuilt : styles.tagMissing]}>
        <Text style={[styles.tagText, real ? styles.tagTextBuilt : styles.tagTextMissing]}>
          {real ? 'real screen' : 'not built yet'}
        </Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLOR.homeBg },
  flex: { flex: 1 },

  head: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg },
  back: { width: 34, height: 34, justifyContent: 'center' },
  backText: { fontFamily: FONT.display, fontSize: 30, color: COLOR.ink, lineHeight: 34 },
  title: { fontFamily: FONT.display, fontSize: 22, color: COLOR.ink, marginTop: 2 },
  sub: { fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.ink2, marginTop: 4 },

  notice: {
    backgroundColor: COLOR.blueBg,
    borderRadius: RADIUS.md,
    padding: SPACE.md,
    marginBottom: SPACE.md,
  },
  noticeText: { fontFamily: FONT.bodyMed, fontSize: 12.5, color: COLOR.ink2, lineHeight: 19 },

  actions: { marginBottom: SPACE.lg },
  startBtn: {
    backgroundColor: COLOR.ink,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startText: { fontFamily: FONT.displaySemi, fontSize: 14, color: '#fff' },
  filter: {
    marginTop: SPACE.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
    paddingVertical: 11,
    alignItems: 'center',
  },
  filterOn: { backgroundColor: COLOR.creamDeep, borderColor: COLOR.goldDeep },
  filterText: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.sub },
  filterTextOn: { color: COLOR.ink },

  group: { marginBottom: SPACE.lg },
  groupName: {
    fontFamily: FONT.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.1,
    color: COLOR.sub,
    marginBottom: SPACE.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    paddingHorizontal: SPACE.md,
    marginBottom: 8,
  },
  rowTitle: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.ink2 },
  rowKey: { fontFamily: FONT.body, fontSize: 11, color: COLOR.sub, marginTop: 2 },
  tag: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginRight: 6 },
  tagBuilt: { backgroundColor: COLOR.greenBg },
  tagMissing: { backgroundColor: COLOR.amberBg },
  tagText: { fontFamily: FONT.bodyBold, fontSize: 9.5, letterSpacing: 0.3 },
  tagTextBuilt: { color: COLOR.refundInk },
  tagTextMissing: { color: '#8A5A00' },
  chev: { fontFamily: FONT.display, fontSize: 20, color: COLOR.sub },

  foot: {
    fontFamily: FONT.body,
    fontSize: 11.5,
    color: COLOR.sub,
    lineHeight: 18,
    marginTop: SPACE.sm,
  },
});
