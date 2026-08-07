// Campaign detail — the pre-claim product reveal, split out of TaskScreen so
// "should I take this?" and "how is my task going?" are two distinct screens
// (matching the prototype's detail → claim → task-status flow).
//
// Everything on this screen is REAL campaign data from the backend
// (campaignStore) plus the authoritative task snapshot (taskStore). The
// prototype's cosmetic metadata — slots remaining, days left, ribbon, rating,
// variant — is deliberately NOT shown: the backend has no such fields and we
// chose not to invent them.
//
// The prototype's 3D <model-viewer> hero is a web-only technology; here the hero
// is the campaign's real product photo on a soft gradient stage.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORMS } from './platforms';
import * as campaignStore from './backend/campaignStore';
import {
  claim as claimTask, getAuthoritative, hasTask, subscribe,
} from './taskStore';
import { formatPaise } from './money';
import { COLOR, FONT, RADIUS, SPACE, SHADOW, estMaxRefundRupees } from './ui/theme';
import { Card, RefundBadge, MarketplaceTag, ProductImage } from './ui/primitives';

// Soft per-campaign hero tint (deterministic from the id) — the fayr palette's
// pastels, standing in for the prototype's per-product theme colours.
const HERO_TINTS = [
  ['#F3E9FF', '#FBF3D9'],
  ['#E7F1FF', '#F1F5DB'],
  ['#FFE9F0', '#FBF3D9'],
  ['#E9F7E4', '#EAF2FF'],
  ['#FFF3E0', '#F9FAE9'],
];
function heroTint(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return HERO_TINTS[h % HERO_TINTS.length];
}

// "2d 5h remaining" / "4h remaining" / null once past. Minute-level precision is
// enough for a multi-day reservation, so this needs no 1-second ticker.
function remaining(untilMs, now) {
  if (untilMs == null) return null;
  const ms = untilMs - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function Section({ title, children, style }) {
  return (
    <View style={[{ marginTop: SPACE.xxl }, style]}>
      <Text style={styles.sectionHead}>{title}</Text>
      {children}
    </View>
  );
}

function Step({ icon, title, sub, tint, last }) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepIcon, { backgroundColor: tint }]}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1, paddingTop: 3, paddingBottom: last ? 0 : 16 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

function Bullet({ children }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function Faq({ q, a, open, onToggle }) {
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onToggle} style={styles.faq}>
      <View style={styles.faqHead}>
        <Text style={styles.faqQ}>{q}</Text>
        <Text style={styles.faqChevron}>{open ? '⌃' : '⌄'}</Text>
      </View>
      {open ? <Text style={styles.faqA}>{a}</Text> : null}
    </TouchableOpacity>
  );
}

export default function DetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const campaignId = (route && route.params && route.params.campaignId) || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;

  const [claimed, setClaimed] = useState(campaignId ? hasTask(campaignId) : false);
  const [authoritative, setAuthoritative] = useState(
    campaignId ? getAuthoritative(campaignId) : null,
  );
  const [claiming, setClaiming] = useState(false);
  const [faqOpen, setFaqOpen] = useState(-1);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!campaignId) return undefined;
    const un = subscribe((id) => {
      if (id !== campaignId) return;
      setClaimed(hasTask(campaignId));
      setAuthoritative(getAuthoritative(campaignId));
    });
    setClaimed(hasTask(campaignId));
    setAuthoritative(getAuthoritative(campaignId));
    return un;
  }, [campaignId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const doClaim = useCallback(async () => {
    setClaiming(true);
    const res = await claimTask(campaignId);
    setClaiming(false);
    if (!res.ok) {
      Alert.alert('Could not claim', res.error || 'Please try again.');
    }
    // On success the store notifies and `claimed` flips — the CTA becomes
    // "Buy on <marketplace>". No navigation: the user stays on the product.
  }, [campaignId]);

  if (!campaign) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.muted}>Loading campaign…</Text>
      </View>
    );
  }

  const platform = PLATFORMS[campaign.marketplace];
  const mktName = platform ? platform.name : campaign.marketplace;
  const [tintA, tintB] = heroTint(campaign.id);
  const maxRefund = estMaxRefundRupees(campaign);
  const priceLabel =
    campaign.productPricePaise != null ? `₹${formatPaise(campaign.productPricePaise)}` : null;

  // The real reservation deadline from the backend task (CLAIM_TTL_DAYS server
  // side — never a hardcoded "48 hours" here).
  const expiresAt = authoritative && authoritative.claimExpiresAt
    ? Date.parse(authoritative.claimExpiresAt)
    : null;
  const reserveLeft = remaining(Number.isNaN(expiresAt) ? null : expiresAt, now);

  const terms = campaign.terms
    ? campaign.terms.split('\n').map((l) => l.trim()).filter(Boolean)
    : [
        `Buy this exact product on ${mktName}, from your own account.`,
        'Your review must be publicly visible on the product page to be verified.',
        'Your refund releases after the marketplace return window closes.',
        'Your rating never affects your refund — only that the review is genuine and public.',
        `Claiming spends ${campaign.ticketCost} tickets; they return if the claim expires before you buy.`,
      ];

  const FAQS = [
    ['When do I get my refund?',
      'Once your review is publicly live on the product page and the marketplace return window has closed. The refund is credited to your fayr Wallet.'],
    ['Does my rating affect my refund?',
      'No. Any rating pays the same — we only verify that the review is genuine and publicly visible.'],
    ['What if I don’t end up buying it?',
      `If the claim expires before you purchase, your ${campaign.ticketCost} tickets are returned to you.`],
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 150 }}
        showsVerticalScrollIndicator={false}
      >
        {/* hero — real product photo on a soft gradient stage */}
        <LinearGradient
          colors={[tintA, tintB, COLOR.homeBg]}
          style={[styles.hero, { paddingTop: insets.top + 8 }]}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.back}
            activeOpacity={0.8}
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <ProductImage
            imageUrl={campaign.imageUrl}
            seed={campaign.id}
            radius={RADIUS.lg}
            style={styles.heroImage}
          />
        </LinearGradient>

        <View style={styles.body}>
          <RefundBadge percent={campaign.percent} maxRupees={maxRefund} />
          <Text style={styles.title}>{campaign.productName || campaign.title}</Text>
          <View style={styles.metaRow}>
            <MarketplaceTag marketplace={campaign.marketplace} />
            {priceLabel ? <Text style={styles.price}>≈ {priceLabel}</Text> : null}
          </View>

          <Section title="Campaign overview">
            <Text style={styles.para}>
              Buy the {campaign.productName || campaign.title} on {mktName} as you normally
              would, and get {campaign.percent}% back
              {maxRefund != null ? ` — up to ₹${maxRefund}` : ''} credited to your fayr
              Wallet once your review is live and the return window closes.
            </Text>
          </Section>

          <Section title="How it works">
            <Step
              icon="🛍️" tint="#FDEBF0"
              title="Claim this product"
              sub={`Reserves it for you and spends ${campaign.ticketCost} tickets.`}
            />
            <Step
              icon="📦" tint="#EAF2FF"
              title={`Buy on ${mktName}`}
              sub="From your own account, exactly as you normally would."
            />
            <Step
              icon="🧾" tint="#EAE7FD"
              title="We verify your order"
              sub={`Fayr reads the order from your ${mktName} account — no screenshots needed.`}
            />
            <Step
              icon="⭐" tint="#F2E9FD"
              title="Write your honest review"
              sub="Once you've actually used it. Any rating pays the same."
            />
            <Step
              icon="💸" tint="#E9F7E4"
              title="Get your refund"
              sub="After the return window closes — straight to your fayr Wallet."
              last
            />
            <View style={styles.walletNote}>
              <Text style={styles.walletNoteText}>
                Your refund is credited to your <Text style={styles.bold}>fayr Wallet</Text>.
              </Text>
            </View>
          </Section>

          <Section title="What to buy">
            <Card style={styles.specCard}>
              {[
                ['Product', campaign.productName || campaign.title],
                ['Marketplace', mktName],
                priceLabel ? ['Expected price', priceLabel] : null,
                campaign.category ? ['Category', campaign.category] : null,
                campaign.asin ? ['ASIN', campaign.asin] : null,
              ]
                .filter(Boolean)
                .map(([k, v], i, arr) => (
                  <View
                    key={k}
                    style={[styles.specRow, i < arr.length - 1 && styles.specDivider]}
                  >
                    <Text style={styles.specKey}>{k}</Text>
                    <Text style={styles.specVal}>{v}</Text>
                  </View>
                ))}
            </Card>
            <View style={styles.warnRow}>
              <Text style={styles.warnIcon}>⚠️</Text>
              <Text style={styles.warnText}>
                Buy only this exact product. A different product, variant or seller can’t be
                matched to this campaign.
              </Text>
            </View>
          </Section>

          <Section title="Terms & conditions">
            {terms.map((t) => <Bullet key={t}>{t}</Bullet>)}
          </Section>

          <Section title="Frequently asked">
            {FAQS.map(([q, a], i) => (
              <Faq
                key={q}
                q={q}
                a={a}
                open={faqOpen === i}
                onToggle={() => setFaqOpen(faqOpen === i ? -1 : i)}
              />
            ))}
          </Section>

          <View style={styles.trustRow}>
            {[['🔒', 'Password never seen'], ['🧾', 'Order verified for you'], ['⭐', 'Any rating pays same']].map(
              ([ic, label]) => (
                <View key={label} style={styles.trustChip}>
                  <Text style={{ fontSize: 17 }}>{ic}</Text>
                  <Text style={styles.trustText}>{label}</Text>
                </View>
              ),
            )}
          </View>
        </View>
      </ScrollView>

      {/* sticky CTA */}
      <LinearGradient
        colors={['rgba(251,251,239,0)', COLOR.homeBg]}
        style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}
      >
        {claimed ? (
          <View style={styles.reservedRow}>
            <View style={styles.reservedTag}>
              <Text style={styles.reservedTagText}>Slot reserved</Text>
            </View>
            {reserveLeft ? <Text style={styles.reservedTime}>{reserveLeft}</Text> : null}
          </View>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.88}
          disabled={claiming}
          onPress={
            claimed
              ? () => navigation.navigate(campaign.marketplace, { campaignId: campaign.id })
              : doClaim
          }
          style={[styles.cta, claimed && styles.ctaClaimed]}
        >
          {claiming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {claimed ? `Buy on ${mktName} →` : `Claim campaign · ${campaign.ticketCost} tickets →`}
            </Text>
          )}
        </TouchableOpacity>

        {claimed ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('Task', { campaignId: campaign.id })}
            style={styles.secondary}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryText}>View task status ›</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.ctaHint}>Claiming reserves this product for you</Text>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.homeBg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub },

  hero: { paddingBottom: SPACE.xl, alignItems: 'center' },
  back: {
    position: 'absolute', left: SPACE.lg, zIndex: 3,
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  backIcon: { fontSize: 18, color: COLOR.ink },
  heroImage: { width: 210, height: 210, marginTop: 44 },

  body: { paddingHorizontal: SPACE.lg, marginTop: -SPACE.sm },
  title: { fontFamily: FONT.display, fontSize: 22, color: COLOR.ink, marginTop: 10, lineHeight: 29 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginTop: 10 },
  price: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.sub },

  sectionHead: { fontFamily: FONT.display, fontSize: 18, color: COLOR.ink, marginBottom: 10 },
  para: { fontFamily: FONT.body, fontSize: 13.5, lineHeight: 21, color: '#6b6555' },

  stepRow: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  stepIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontFamily: FONT.displaySemi, fontSize: 14.5, color: COLOR.ink },
  stepSub: { fontFamily: FONT.body, fontSize: 12.5, color: '#7b7565', marginTop: 2, lineHeight: 18 },
  walletNote: {
    marginTop: 6, backgroundColor: '#FFF7DF', borderWidth: 1, borderColor: '#F2E6BD',
    borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: 14,
  },
  walletNoteText: { fontFamily: FONT.bodyMed, fontSize: 13, color: '#4a463c' },
  bold: { fontFamily: FONT.bodyBold, color: COLOR.ink },

  specCard: { paddingHorizontal: 14 },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 12 },
  specDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line },
  specKey: { fontFamily: FONT.bodyMed, fontSize: 13, color: '#7b7565' },
  specVal: { fontFamily: FONT.bodyBold, fontSize: 13, color: COLOR.ink, textAlign: 'right', flex: 1 },
  warnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  warnIcon: { fontSize: 14 },
  warnText: { fontFamily: FONT.bodySemi, fontSize: 12.5, lineHeight: 18, color: '#d0422e', flex: 1 },

  bulletRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', marginBottom: 10 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#c7bfa9', marginTop: 8 },
  bulletText: { fontFamily: FONT.body, fontSize: 13.5, lineHeight: 20, color: '#6b6555', flex: 1 },

  faq: {
    backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)', padding: 14, marginBottom: 9,
  },
  faqHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  faqQ: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink, flex: 1 },
  faqChevron: { fontSize: 14, color: '#a8a08e' },
  faqA: { fontFamily: FONT.body, fontSize: 13, color: '#6b6555', marginTop: 10, lineHeight: 20 },

  trustRow: { flexDirection: 'row', gap: 10, marginTop: SPACE.xxl },
  trustChip: {
    flex: 1, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)', paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center',
  },
  trustText: { fontFamily: FONT.bodySemi, fontSize: 11.5, color: '#6b6555', marginTop: 6, textAlign: 'center', lineHeight: 15 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SPACE.lg, paddingTop: SPACE.xl },
  reservedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  reservedTag: { backgroundColor: COLOR.ink, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 8 },
  reservedTagText: { fontFamily: FONT.displaySemi, fontSize: 12, color: '#fff' },
  reservedTime: { fontFamily: FONT.bodyBold, fontSize: 12.5, color: COLOR.red },
  cta: {
    backgroundColor: COLOR.ink, borderRadius: RADIUS.pill, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.card,
  },
  ctaClaimed: { backgroundColor: '#2E9E00' },
  ctaText: { fontFamily: FONT.displaySemi, fontSize: 15.5, color: '#fff' },
  ctaHint: { fontFamily: FONT.bodySemi, fontSize: 11, color: '#a8a08e', textAlign: 'center', marginTop: 9 },
  secondary: { alignItems: 'center', marginTop: 10 },
  secondaryText: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.ink },
});
