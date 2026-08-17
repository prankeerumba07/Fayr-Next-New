// Splash — fayr-design.browser.jsx:504.
//
// The mark floats, the wordmark sits under it, the perspective grid anchors the
// bottom, and after 1.8s it moves on. The design's timeout is kept exactly.
//
// It does one real job as well as looking right: while it is on screen the app is
// restoring the keychain session, so the splash IS the loading state. Before
// this, that moment was a bare grey "fayr" + spinner.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { COLOR } from '../ui/theme';
import { GridFloor, LogoMark, Wordmark } from '../ui/brand';

const HOLD_MS = 1800;

export default function SplashScreen({ onDone }) {
  const float = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // fayr-pop on entry, then fayr-float forever — both from the design.
    Animated.timing(pop, { toValue: 1, duration: 700, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
  }, [float, pop]);

  useEffect(() => {
    const t = setTimeout(() => onDone && onDone(), HOLD_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <View style={styles.root}>
      <Animated.View
        style={{
          alignItems: 'center',
          opacity: pop,
          transform: [
            { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
            { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
          ],
        }}
      >
        <LogoMark size={76} />
        <View style={{ marginTop: 20 }}><Wordmark size={44} /></View>
      </Animated.View>
      <GridFloor style={styles.grid} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream, alignItems: 'center', justifyContent: 'center' },
  grid: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 220 },
});
