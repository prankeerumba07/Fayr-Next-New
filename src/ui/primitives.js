// Shared UI primitives for the redesigned screens — the fayr. design language
// expressed as reusable RN components, all driven by src/ui/theme.js tokens.
// Kept presentational and data-agnostic: screens pass real data in.
//
// Note: this imports PLATFORMS from ../platforms only to READ each marketplace's
// name/colour. platforms.js is a frozen scraper file — it is never modified,
// only read, so importing it here changes nothing about it.
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { COLOR, FONT, RADIUS, SPACE, SHADOW } from './theme';
import { PLATFORMS } from '../platforms';
import { resolveApiBase } from '../backend/config';
import { useInsideJourney } from '../journey/insideJourney';
import { edgesInsideJourney } from './journeySpacing.js';

// ── Screen ──────────────────────────────────────────────────────────────────
//
// THE ONE PLACE THE EMPTY BAND AT THE TOP OF EVERY JOURNEY SCREEN IS FIXED.
//
// Inside the journey the strip above has already stepped over the notch, so this
// must not step over it again. It asks, and drops its top edge when it is inside.
//
// IT HAS TO BE ASKED HERE AND CANNOT BE HANDED DOWN. SafeAreaView reads no React
// context: in react-native-safe-area-context 5.6.2 it renders NativeSafeAreaView
// and passes only its edges, and the insets are applied natively, per view. An
// earlier attempt handed a zeroed inset down through SafeAreaInsetsContext, which
// everything calling useSafeAreaInsets() honoured and this view ignored — so the
// band stayed. See src/ui/journeySpacing.js for the whole measurement.
export function Screen({ children, bg = COLOR.homeBg, edges = ['top', 'bottom'], style }) {
  const inside = useInsideJourney();
  const stepOver = edgesInsideJourney(edges, inside);
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: bg }, style]} edges={stepOver}>
      {children}
    </SafeAreaView>
  );
}

// ── Wordmark ──────────────────────────────────────────────────────────────
export function Wordmark({ size = 30, color = COLOR.ink }) {
  return (
    <Text style={{ fontFamily: FONT.logo, fontSize: size, color, letterSpacing: -0.5 }}>
      fayr<Text style={{ color: COLOR.goldDeep }}>.</Text>
    </Text>
  );
}

// ── Section title ─────────────────────────────────────────────────────────
export function SectionTitle({ children, style }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

// ── Pill / primary button ───────────────────────────────────────────────────
export function Pill({ children, onPress, disabled, loading, color = COLOR.ink, textColor = '#fff', style }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.pill, { backgroundColor: disabled ? '#C9C9BE' : color }, style]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.pillText, { color: textColor }]}>{children}</Text>
      )}
    </TouchableOpacity>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({ children, style, onPress }) {
  const inner = <View style={[styles.card, style]}>{children}</View>;
  if (!onPress) return inner;
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>{inner}</TouchableOpacity>
  );
}

// ── Refund badge — the italic green "X% Refund" chip ─────────────────────────
export function RefundBadge({ percent, maxRupees, size = 'md' }) {
  const small = size === 'sm';
  return (
    <View style={styles.refundBadge}>
      <Text style={[styles.refundText, small && { fontSize: 10.5 }]}>
        {percent}% Refund{maxRupees != null ? '' : ' 💵'}
      </Text>
      {maxRupees != null ? (
        <Text style={[styles.refundMax, small && { fontSize: 10 }]}>up to ₹{maxRupees}</Text>
      ) : null}
    </View>
  );
}

// ── Marketplace tag — brand chip using the (frozen) platforms colour/name ────
export function MarketplaceTag({ marketplace, style }) {
  const p = PLATFORMS[marketplace];
  const name = p ? p.name : marketplace;
  const color = (p && p.color) || COLOR.ink;
  return (
    <View style={[styles.mktTag, { backgroundColor: color + '1A', borderColor: color + '33' }, style]}>
      <View style={[styles.mktDot, { backgroundColor: color }]} />
      <Text style={[styles.mktText, { color: COLOR.ink2 }]}>{name}</Text>
    </View>
  );
}

// ── Shop mark — the marketplace tile the design puts beside a heading ────────
//
// The design draws a real brand logo here, out of assets/mp/*.png. Fayr does not
// have those files and they are somebody else's trademarks, so this is the same
// tile at the same size with the shop's own colour and its name in it. Nothing is
// invented: the name and the colour both come from the frozen platforms.js, which
// is only ever read.
export function ShopMark({ marketplace, size = 54, style }) {
  const p = PLATFORMS[marketplace];
  const name = p ? p.name : String(marketplace || '');
  const color = (p && p.color) || COLOR.ink;
  return (
    <View
      style={[
        {
          width: size, height: size, borderRadius: size * 0.28,
          backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
          borderWidth: 1.5, borderColor: color + '55',
        },
        SHADOW.chip,
        style,
      ]}
      accessible
      accessibilityLabel={name}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: FONT.displaySemi,
          fontSize: Math.max(9, size * 0.19),
          color,
          paddingHorizontal: 3,
        }}
      >
        {name}
      </Text>
    </View>
  );
}

// ── Product image — real campaign photo, else a themed placeholder ───────────
const PLACEHOLDER_TINTS = [
  [COLOR.purpleBg, '#D9C7F5'],
  [COLOR.blueBg, '#BBD6FB'],
  [COLOR.greenBg, '#CDE6A8'],
  [COLOR.amberBg, '#F7D98C'],
  [COLOR.redBg, '#F3B7B7'],
];
function tintFor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return PLACEHOLDER_TINTS[h % PLACEHOLDER_TINTS.length];
}

export function ProductImage({ imageUrl, seed, radius = RADIUS.md, style }) {
  if (imageUrl) {
    const uri = /^https?:/.test(imageUrl) ? imageUrl : resolveApiBase() + imageUrl;
    return (
      <Image
        source={{ uri }}
        resizeMode="cover"
        style={[{ borderRadius: radius, backgroundColor: COLOR.creamDeep }, style]}
      />
    );
  }
  const [a, b] = tintFor(seed);
  return (
    <LinearGradient
      colors={[a, b]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius: radius, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Text style={{ fontSize: 26, opacity: 0.7 }}>🛍️</Text>
    </LinearGradient>
  );
}

// ── Ticket pill — the 🎟 balance indicator ───────────────────────────────────
export function TicketPill({ count }) {
  return (
    <View style={styles.ticketPill}>
      <Text style={styles.ticketText}>🎟 {count == null ? '—' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontFamily: FONT.display, fontSize: 18, color: COLOR.ink, marginBottom: SPACE.md },
  pill: {
    borderRadius: RADIUS.md, paddingVertical: 15, paddingHorizontal: 22,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  pillText: { fontFamily: FONT.displaySemi, fontSize: 15 },
  card: { backgroundColor: COLOR.surface, borderRadius: RADIUS.xl, ...SHADOW.card },
  refundBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: COLOR.refundBg, borderRadius: RADIUS.sm, paddingVertical: 3, paddingHorizontal: 9,
  },
  refundText: { fontFamily: FONT.displaySemi, fontStyle: 'italic', fontSize: 12.5, color: COLOR.refundInk },
  refundMax: { fontFamily: FONT.bodySemi, fontSize: 11, color: COLOR.refundInk },
  mktTag: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    borderRadius: RADIUS.sm, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 3, paddingHorizontal: 8,
  },
  mktDot: { width: 6, height: 6, borderRadius: 3 },
  mktText: { fontFamily: FONT.bodySemi, fontSize: 11 },
  ticketPill: {
    backgroundColor: '#fff', borderRadius: RADIUS.round, height: 36, paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  ticketText: { fontFamily: FONT.displaySemi, fontSize: 13, color: COLOR.ink },
});
