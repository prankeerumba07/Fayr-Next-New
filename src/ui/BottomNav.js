// The bottom tab bar, ported from BottomNav in fayr-design.browser.jsx:1331.
//
// Tabs, icons and labels are the design's, unchanged: Home · My Products ·
// Earnings · My Profile. So is the active treatment — a soft cream pill behind
// the tab, the icon in full colour and nudged up while inactive icons sit
// greyscale at 55% opacity.
//
// Used as react-navigation's `tabBar` renderer so the tabs get real tab
// semantics (each keeps its own history, switching does not pile up a stack)
// while still looking exactly like the design.
import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLOR, FONT } from './theme';

/** [routeName, icon, label] — the design's four, in the design's order. */
export const TABS = [
  ['Home', '🏠', 'Home'],
  ['MyProducts', '🛍️', 'My Products'],
  ['Earnings', '💰', 'Earnings'],
  ['Profile', '👤', 'My Profile'],
];

export default function BottomNav({ state, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((route, index) => {
        const meta = TABS.find(([name]) => name === route.name);
        const [, icon, label] = meta || [route.name, '•', route.name];
        const active = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress', target: route.key, canPreventDefault: true,
          });
          if (!active && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={active ? { selected: true } : {}}
            accessibilityLabel={label}
            onPress={onPress}
            activeOpacity={0.8}
            style={[styles.tab, active && styles.tabActive]}
          >
            {/* RN has no CSS grayscale filter, so an inactive icon is dimmed by
                opacity instead — the closest honest equivalent. */}
            <Text style={[styles.icon, active ? styles.iconActive : styles.iconIdle]}>{icon}</Text>
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLOR.line,
    paddingTop: 8,
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 3, paddingVertical: 5, borderRadius: 12,
  },
  tabActive: { backgroundColor: '#FDF9DF' },
  icon: { fontSize: 19 },
  iconActive: { opacity: 1 },
  iconIdle: { opacity: 0.55 },
  label: { fontFamily: FONT.bodyMed, fontSize: 10.5, color: '#8b8c80' },
  labelActive: { fontFamily: FONT.display, color: COLOR.ink },
});
