// What the user is looking at when the app has just dropped them.
//
// The RN half of the catch-all — see ErrorBoundary.js for why the two are split.
// Everything here is chosen for the worst moment to be reading a screen:
//
//   * ONE control. Someone who has just been thrown out of a screen should not be
//     handed a choice.
//   * No error text, no code, no stack. None of it helps the person holding the
//     phone, and in front of an audience it leaks internals. The error goes to the
//     console instead, which is where it is useful.
//   * Nothing promised about their account. An unknown crash can land either side
//     of a claim, so "nothing has changed" would sometimes be a lie. What IS
//     always true is that tasks and tickets live on the server and are re-read on
//     the next launch — so the copy says they can pick up where they left off, and
//     says nothing else.
//   * No safe-area hook. This renders ABOVE SafeAreaProvider (the boundary wraps
//     the whole app, including the branch that mounts the provider), so insets are
//     unavailable here. A vertically-centred layout with generous padding needs
//     none.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLOR, FONT, RADIUS, SPACE } from './ui/theme';

export default function ErrorFallback({ onReset }) {
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.wordmark}>fayr.</Text>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        This screen stopped working. Start again and you can pick up where you
        left off.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={onReset}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Start again"
      >
        <Text style={styles.buttonText}>Start again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLOR.cream,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xxl,
  },
  wordmark: {
    fontFamily: FONT.logo,
    fontSize: 26,
    color: COLOR.ink,
    marginBottom: SPACE.xxl,
  },
  title: {
    fontFamily: FONT.display,
    fontSize: 22,
    color: COLOR.ink,
    textAlign: 'center',
    marginBottom: SPACE.md,
  },
  body: {
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 22,
    color: COLOR.sub,
    textAlign: 'center',
    marginBottom: SPACE.xxl,
  },
  button: {
    backgroundColor: COLOR.gold,
    paddingVertical: 14,
    paddingHorizontal: SPACE.xxl + SPACE.md,
    borderRadius: RADIUS.round,
  },
  buttonText: {
    fontFamily: FONT.displaySemi,
    fontSize: 16,
    color: COLOR.ink,
  },
});
