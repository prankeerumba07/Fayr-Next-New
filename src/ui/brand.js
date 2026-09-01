// The brand atoms from the top of fayr-design.browser.jsx, ported to RN.
//
// LogoMark (:310) and GridFloor (:303) are real SVG in the design, so they are
// real SVG here too — the mark is the brand and an approximation built out of
// Views would show. Pill (:362), Ghost (:369), TextBtn (:372) and ProgressDots
// (:403) are the buttons every first-run screen is built from. TopBar (:395),
// CardBox (:412) and Row (:2418) are the three pieces almost every other screen
// in the design is assembled out of, and they live here for the same reason: they
// are at the top of the design file, above any one screen, because the design
// treats them as shared.
//
// Existing screens already use src/ui/primitives.js; this file adds only what
// the design's own screens need and does not replace it.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { COLOR, FONT, RADIUS, SHADOW } from './theme';

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

/**
 * The bar at the top of almost every screen the design draws: a round white back
 * button, then the title beside it.
 *
 * The design's own arrow is "←" in a white circle with a soft shadow, and the
 * title sits NEXT to it rather than centred. Several screens in the app grew a
 * local copy of this with a "‹" and a centred title; this is the design's, and it
 * is one file so they cannot drift apart again.
 *
 * `onBack` is optional, exactly as in the design: a screen with no way back draws
 * no button. Pass goBackOrHome from src/ui/nav.js rather than goBack, so the
 * arrow can never be a control that does nothing.
 */
export function TopBar({ title, onBack, style }) {
  return (
    <View style={[styles.topBar, style]}>
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.8}
          style={styles.topBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.topBackIcon}>←</Text>
        </TouchableOpacity>
      ) : null}
      {title ? <Text style={styles.topTitle} numberOfLines={1}>{title}</Text> : null}
    </View>
  );
}

/** The white rounded card the design puts nearly every group of facts inside. */
export function CardBox({ children, style }) {
  return <View style={[styles.cardBox, style]}>{children}</View>;
}

/**
 * One line inside a CardBox: what it is on the left, what it is on the right, a
 * hairline under it unless it is the last one.
 */
export function Row({ a, b, last, style }) {
  return (
    <View style={[styles.row, last && styles.rowLast, style]}>
      <Text style={styles.rowA}>{a}</Text>
      <Text style={styles.rowB}>{b}</Text>
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

  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8,
  },
  topBack: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  topBackIcon: { fontFamily: FONT.bodyBold, fontSize: 17, color: COLOR.ink2 },
  topTitle: { flex: 1, fontFamily: FONT.bodyBold, fontSize: 16, color: COLOR.ink2 },

  cardBox: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, ...SHADOW.card,
  },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: 12, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowA: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.sub },
  rowB: {
    fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink2,
    textAlign: 'right', flexShrink: 1,
  },
});
