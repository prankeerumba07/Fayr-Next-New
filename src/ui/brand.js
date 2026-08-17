// The brand atoms from the top of fayr-design.browser.jsx, ported to RN.
//
// LogoMark (:310) and GridFloor (:303) are real SVG in the design, so they are
// real SVG here too — the mark is the brand and an approximation built out of
// Views would show. Pill (:362), Ghost (:369), TextBtn (:372) and ProgressDots
// (:403) are the buttons every first-run screen is built from.
//
// Existing screens already use src/ui/primitives.js; this file adds only what
// the first-run journey needs and does not replace it.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { COLOR, FONT, RADIUS } from './theme';

/** The stacked-tile "f" mark. Geometry copied exactly from the design. */
export function LogoMark({ size = 64 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="fayr">
      <Rect x="2" y="6" width="60" height="58" rx="18" fill={COLOR.goldDeep} />
      <Rect x="2" y="2" width="60" height="58" rx="18" fill={COLOR.gold} />
      <Path
        d="M38 20c-1.2-3-4-4.5-7.2-4.5-5 0-8.3 3.4-8.3 9.2V27h-3.2v6.3h3.2V49h6.6V33.3h5.1V27h-5.1v-2.2c0-2.1 1-3.1 2.8-3.1 1 0 1.8.3 2.4 1.1L38 20Z"
        fill={COLOR.ink}
      />
      <Circle cx="33.5" cy="46.5" r="3.4" fill={COLOR.ink} />
      <Path d="M46 16l1.4 3.6L51 21l-3.6 1.4L46 26l-1.4-3.6L41 21l3.6-1.4L46 16Z" fill={COLOR.ink} />
    </Svg>
  );
}

/**
 * The perspective grid that anchors every full-bleed screen in the design. Same
 * generated geometry: 15 vanishing verticals and 9 horizontals eased by a power
 * curve so the lines bunch toward the horizon.
 */
export function GridFloor({ style, opacity = 1 }) {
  const stroke = 'rgba(120,130,90,0.20)';
  const lines = [];
  for (let i = -7; i <= 7; i += 1) {
    lines.push(
      <Line key={`v${i}`} x1={180 + i * 4} y1="0" x2={180 + i * 26} y2="240" stroke={stroke} strokeWidth="1" />,
    );
  }
  for (let j = 1; j <= 9; j += 1) {
    const y = 240 - (j / 9) ** 1.9 * 240;
    lines.push(
      <Line key={`h${j}`} x1="-40" y1={y} x2="400" y2={y} stroke={stroke} strokeWidth="1" />,
    );
  }
  return (
    <Svg viewBox="0 0 360 240" preserveAspectRatio="none" style={[style, { opacity }]} pointerEvents="none">
      {lines}
    </Svg>
  );
}

/** The `fayr.` wordmark. */
export function Wordmark({ size = 44, color = COLOR.ink, dot = COLOR.goldDeep }) {
  return (
    <Text style={{ fontFamily: FONT.logo, fontSize: size, letterSpacing: -size * 0.04, color }}>
      fayr<Text style={{ color: dot }}>.</Text>
    </Text>
  );
}

/** The primary full-width action. */
export function Pill({ children, onPress, color = COLOR.ink, textColor = '#fff', disabled, style, textStyle }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.9}
      style={[styles.pill, { backgroundColor: disabled ? '#cfcfcf' : color }, style]}
    >
      <Text style={[styles.pillText, { color: textColor }, textStyle]}>{children}</Text>
    </TouchableOpacity>
  );
}

/** The secondary outlined action. */
export function Ghost({ children, onPress, disabled, style }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.8} style={[styles.ghost, style]}>
      <Text style={styles.ghostText}>{children}</Text>
    </TouchableOpacity>
  );
}

/** A quiet tertiary action. */
export function TextBtn({ children, onPress, style }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.textBtn, style]}>
      <Text style={styles.textBtnText}>{children}</Text>
    </TouchableOpacity>
  );
}

/** Slide position: the current dot stretches into a bar. */
export function ProgressDots({ n, i, style }) {
  return (
    <View style={[styles.dots, style]}>
      {Array.from({ length: n }, (_, k) => (
        <View
          key={k}
          style={[
            styles.dot,
            k === i ? { width: 22, backgroundColor: COLOR.ink } : null,
          ]}
        />
      ))}
    </View>
  );
}

/** The design's shared heading + subheading type. */
export const hTitle = {
  fontFamily: FONT.displayXBold, fontSize: 27, color: COLOR.ink2,
  letterSpacing: -0.8, lineHeight: 30,
};
export const hSub = {
  fontFamily: FONT.bodyMed, fontSize: 14, color: COLOR.sub,
  marginTop: 8, lineHeight: 21,
};

const styles = StyleSheet.create({
  pill: {
    width: '100%', borderRadius: 26, paddingVertical: 15, paddingHorizontal: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  pillText: { fontFamily: FONT.bodyBold, fontSize: 15, letterSpacing: 0.3 },
  ghost: {
    width: '100%', backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLOR.line,
    borderRadius: 26, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center',
  },
  ghostText: { fontFamily: FONT.bodyBold, fontSize: 14, color: COLOR.ink2 },
  textBtn: { width: '100%', paddingVertical: 10, alignItems: 'center' },
  textBtnText: { fontFamily: FONT.bodyBold, fontSize: 13.5, color: COLOR.sub },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 6, backgroundColor: 'rgba(25,25,25,0.22)' },
  radius: { borderRadius: RADIUS.md },
});
