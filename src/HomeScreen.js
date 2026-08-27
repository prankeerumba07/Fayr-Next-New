import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORM_LIST, PLATFORMS } from './platforms';
import * as campaignStore from './backend/campaignStore';
import { getWallet } from './backend/meApi';
import { hasTask } from './taskStore';
import { COLOR, FONT, RADIUS, SPACE, SHADOW, rupeesFromPaise, estMaxRefundRupees } from './ui/theme';
import { seatsLine, joinedLine, isFullCampaign } from './ui/seats';
import { cardState } from './livecheck.js';
import {
  Wordmark, SectionTitle, Card, RefundBadge, MarketplaceTag, ProductImage, TicketPill,
} from './ui/primitives';

const BANNERS = [
  { a: 'Buy it. Review it.', b: 'Get refunded.' },
  { a: 'Your honest review,', b: 'your money back.' },
  { a: 'Real products.', b: 'Real refunds.' },
];

// A single campaign as the redesigned product card: photo, refund badge,
// marketplace tag, name, and a claim/continue affordance. Tapping opens the
// campaign — Task for now; switches to the dedicated Detail screen in Step B.
function CampaignRow({ c, claimed, onOpen }) {
  // Both of these are null whenever the server did not state a figure, and the
  // card simply omits the line — see src/ui/seats.js for why silence rather than
  // a zero.
  const seats = seatsLine(c);
  const joined = joinedLine(c);
  const full = isFullCampaign(c);
  // Whether the shop's own page still works, and whether the places are gone.
  // Both decided server-side; this only draws the answer. An offer that cannot be
  // used is GREYED OUT AND STILL THERE — somebody who saw it yesterday has to be
  // able to find it, with a reason, or they conclude the app lost it.
  const live = cardState(c);
  const off = live.greyedOut;
  return (
    <Card onPress={onOpen} style={[styles.campaignCard, off && styles.campaignCardOff]}>
      {live.label ? (
        <View style={styles.offBanner}>
          <Text style={styles.offBannerText}>{live.label}</Text>
        </View>
      ) : null}
      <View style={[styles.campaignBody, off && styles.dimmed]}>
        <ProductImage imageUrl={c.imageUrl} seed={c.id} radius={RADIUS.md} style={styles.thumb} />
        <View style={styles.campaignInfo}>
          <RefundBadge percent={c.percent} maxRupees={estMaxRefundRupees(c)} />
          <Text numberOfLines={2} style={styles.campaignName}>{c.productName || c.title}</Text>
          <MarketplaceTag marketplace={c.marketplace} style={{ marginTop: 6 }} />
          {joined ? <Text style={styles.joined}>{joined}</Text> : null}
        </View>
      </View>
      <View style={styles.campaignFooter}>
        <Text style={styles.footerHint}>
          {/* How full the offer is, when the server said — else the ticket cost.
              Never both: the footer is one line and the scarcer fact wins. */}
          {seats || (claimed ? 'In progress' : `Claim · ${c.ticketCost} tickets`)}
        </Text>
        <Text style={[styles.footerCta, (full || off) && styles.footerCtaOff]}>
          {off ? live.cta : full ? 'Full' : claimed ? 'Continue ›' : 'Claim →'}
        </Text>
      </View>
    </Card>
  );
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [campaigns, setCampaigns] = useState(campaignStore.getAll());
  const [loaded, setLoaded] = useState(campaignStore.isLoaded());
  const [wallet, setWallet] = useState(null); // { ticketBalance, walletBalancePaise }
  const [bi, setBi] = useState(0);

  const refreshWallet = useCallback(async () => {
    const w = await getWallet();
    if (w.ok) setWallet(w);
  }, []);

  useEffect(() => {
    const un = campaignStore.subscribe((list) => {
      setCampaigns(list);
      setLoaded(campaignStore.isLoaded());
    });
    const unfocus = navigation.addListener('focus', () => {
      setCampaigns(campaignStore.getAll());
      setLoaded(campaignStore.isLoaded());
      refreshWallet();
    });
    refreshWallet();
    return () => { un(); unfocus(); };
  }, [navigation, refreshWallet]);

  // Rotating banner (cosmetic).
  useEffect(() => {
    const t = setInterval(() => setBi((x) => (x + 1) % BANNERS.length), 3500);
    return () => clearInterval(t);
  }, []);
  const banner = BANNERS[bi];

  return (
    <View style={styles.root}>
      {/* gold gradient header — wordmark · wallet + tickets · log out */}
      <LinearGradient
        colors={[COLOR.headYellow, COLOR.headYellow2, COLOR.homeBg]}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.headerRow}>
          <Wordmark size={30} />
          <View style={styles.headerRight}>
            {/* Tappable: this number was the only place a refund was visible,
                with nowhere to go. It now opens the wallet. */}
            <TouchableOpacity
              style={styles.walletChip}
              onPress={() => navigation.navigate('Wallet')}
              activeOpacity={0.8}
            >
              <Text style={styles.walletText}>
                👛 ₹{wallet ? rupeesFromPaise(wallet.walletBalancePaise) : '—'}
              </Text>
            </TouchableOpacity>
            <TicketPill count={wallet ? wallet.ticketBalance : null} />
          </View>
        </View>
        <View style={styles.bannerWrap}>
          <Text style={styles.bannerA}>{banner.a}</Text>
          <Text style={styles.bannerB}>{banner.b}</Text>
          <View style={styles.dots}>
            {BANNERS.map((_, k) => (
              <View key={k} style={[styles.dot, k === bi && styles.dotActive]} />
            ))}
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        // The tab bar now sits over the bottom of this screen; its own safe-area
        // padding is already applied there, so the list only needs to clear it.
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: SPACE.xxl }}
      >
        <SectionTitle>Products for you</SectionTitle>
        {!loaded ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={COLOR.ink} />
            <Text style={styles.loadingText}>Loading campaigns…</Text>
          </View>
        ) : campaigns.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🛍️</Text>
            <Text style={styles.emptyTitle}>No offers right now</Text>
            <Text style={styles.empty}>
              New products are added regularly. Check back soon.
            </Text>
          </View>
        ) : (
          campaigns.map((c) => (
            <CampaignRow
              key={c.id}
              c={c}
              claimed={hasTask(c.id)}
              onOpen={() => navigation.navigate(
                hasTask(c.id) ? 'Task' : 'Detail',
                { campaignId: c.id },
              )}
            />
          ))
        )}

        {/* The raw "Connect an account" tiles are DEV-ONLY now. They opened a
            marketplace WebView with no campaign attached, so the scraper failed
            closed and the user landed on "Fetch failed" with nothing to do — a
            testing shortcut shipped to users. Connecting belongs inside a task,
            where there is a product to look for. */}
        {__DEV__ ? (
          <>
            <SectionTitle style={{ marginTop: SPACE.xl }}>Connect an account (dev)</SectionTitle>
            {PLATFORM_LIST.map((p) => {
              const c = campaignStore.forMarketplace(p.key);
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.connectTile, { borderColor: (PLATFORMS[p.key] || {}).color + '55' }]}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate(p.key, { campaignId: c ? c.id : null })}
                >
                  <View style={[styles.connectDot, { backgroundColor: p.color }]} />
                  <Text style={styles.connectName}>{p.name}</Text>
                  <Text style={styles.connectCta}>Connect ›</Text>
                </TouchableOpacity>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.homeBg },
  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.md, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  walletChip: {
    backgroundColor: '#fff', borderRadius: RADIUS.round, height: 36, paddingHorizontal: 14,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.chip,
  },
  walletText: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.ink },
  bannerWrap: { alignItems: 'center', paddingVertical: 14 },
  bannerA: { fontFamily: FONT.displayXBold, fontSize: 23, color: COLOR.ink, transform: [{ rotate: '-1.5deg' }] },
  bannerB: { fontFamily: FONT.displayXBold, fontSize: 27, color: COLOR.goldDeep, transform: [{ rotate: '-1.5deg' }], marginTop: 2 },
  dots: { flexDirection: 'row', gap: 5, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(25,25,25,0.25)' },
  dotActive: { width: 16, backgroundColor: COLOR.ink },

  scroll: { flex: 1 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  loadingText: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub, marginLeft: 10 },
  emptyBox: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: SPACE.xl },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontFamily: FONT.display, fontSize: 17, color: COLOR.ink, marginTop: 10, marginBottom: 6 },
  empty: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub, lineHeight: 20 },

  campaignCard: { marginBottom: 14, overflow: 'hidden' },
  // Greyed out, not hidden. The card stays on the feed and stays tappable, so the
  // detail screen can explain; it just stops looking like something to buy.
  campaignCardOff: { opacity: 0.72 },
  dimmed: { opacity: 0.55 },
  offBanner: {
    backgroundColor: COLOR.amberBg,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.amberLine,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  offBannerText: { fontFamily: FONT.bodySemi, fontSize: 12, color: '#8A5A00' },
  campaignBody: { flexDirection: 'row', gap: 12, padding: 14 },
  thumb: { width: 96, height: 108 },
  campaignInfo: { flex: 1, minWidth: 0, paddingTop: 2 },
  campaignName: { fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink, marginTop: 7, lineHeight: 20 },
  campaignFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLOR.line, paddingVertical: 10, paddingHorizontal: 14,
  },
  footerHint: { fontFamily: FONT.bodySemi, fontSize: 12, color: COLOR.sub },
  footerCta: { fontFamily: FONT.displaySemi, fontSize: 13, color: COLOR.ink },
  // A full offer's control is greyed but still tappable — the detail screen is
  // where the offer explains itself, and a dead card teaches nothing.
  footerCtaOff: { color: COLOR.sub },
  joined: { fontFamily: FONT.body, fontSize: 11, color: COLOR.sub, marginTop: 5 },

  connectTile: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff',
    borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10,
  },
  connectDot: { width: 10, height: 10, borderRadius: 5 },
  connectName: { fontFamily: FONT.displaySemi, fontSize: 14, color: COLOR.ink, flex: 1 },
  connectCta: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.sub },
});
