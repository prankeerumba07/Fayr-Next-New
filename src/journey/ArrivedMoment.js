// "PRODUCT DELIVERED." — THE THREE AND A HALF SECONDS BETWEEN TWO STEPS.
//
// The decision about WHETHER to draw this, and for how long, is in arrived.js
// and is pure. This file is the drawing and the timer, and nothing else.
//
// ── IT ALWAYS ENDS ────────────────────────────────────────────────────────
//
// One timer, cleared on the way out, and the only thing it does is call back.
// Nobody is left looking at a celebration: the same rule the reading screens
// keep, for the same reason — a screen with no way off it is the worst failure
// this journey can have.
//
// THE WORDS COME FROM src/ui/journeyWords.js, which Fayr's plain language rule
// reads off disk. There is no second copy of them in here.
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CELEBRATION_MS } from './arrived';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { PRODUCT_DELIVERED } from '../ui/journeyWords';
import { useMotion } from '../ui/celebration';

export default function ArrivedMoment({ onDone }) {
  const motion = useMotion();

  useEffect(() => {
    const done = setTimeout(() => {
      if (typeof onDone === 'function') onDone();
    }, CELEBRATION_MS);
    return () => clearTimeout(done);
  }, [onDone]);

  return (
    <View style={styles.root}>
      {/* A PHONE THAT ASKED FOR LESS MOVEMENT GETS LESS. The parcel is still
          there and still says the same thing; it simply does not grow. */}
      <Text style={[styles.tick, motion ? styles.tickBig : null]}>📦</Text>
      <Text style={styles.line}>{PRODUCT_DELIVERED}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLOR.cream, padding: SPACE.xl,
  },
  tick: { fontSize: 56 },
  tickBig: { fontSize: 72 },
  line: {
    fontFamily: FONT.displaySemi, fontSize: 22, color: COLOR.ink,
    marginTop: SPACE.lg, textAlign: 'center',
  },
});
