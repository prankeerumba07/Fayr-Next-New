import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORM_LIST, PLATFORMS } from './platforms';
import * as campaignStore from './backend/campaignStore';
import { getWallet } from './backend/meApi';
import { hasTask, isDone } from './taskStore';
import WaitingBox from './ui/WaitingBox';
import { COLOR, FONT, RADIUS, SPACE, SHADOW, rupeesFromPaise, estMaxRefundRupees } from './ui/theme';
import {
  LOCKED_BANNER, LOCKED_CTA, seatsLine, joinedLine, isFullCampaign, lockedLine,
} from './ui/seats';
import { DONE_BANNER, DONE_CTA, DONE_LINE } from './ui/tasklist';
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
function CampaignRow({ c, claimed, done, onOpen }) {
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
  // THE PERSON, NOT ONLY THE OFFER. A full offer is not greyed out to somebody
  // holding one of its seats — see cardState for the reason and for why only the
  // seats reason is overridden.
  const live = cardState(c, claimed);
  const off = live.greyedOut;
  // ── LOCKED, WHICH IS NOT THE SAME AS "NOT RIGHT NOW" ──────────────────────
  //
  // THE SHOP'S OWN PAGE OUTRANKS THIS, and the order below is the whole of that
  // rule. A dead shop page is a problem a freed slot would not fix, so when both
  // are true the person is told the one that matters. See src/ui/seats.js for
  // the three facts and why they must not collide.
  //
  // ── AND IT IS NEVER LOCKED TO SOMEBODY WHO HOLDS ONE OF THE SEATS ───────
  //
  // 21 September 2026. The owner made a one-slot offer, claimed it, and his own
  // home screen told him "Come back when a slot opens" — about the seat he was
  // sitting in. He found his claim only by going to My Products, where the card
  // was correct, so one offer was saying two different things in two places.
  //
  // `claimed` was already handed to this row and simply never consulted. A full
  // offer is full FOR PEOPLE WHO HAVE NO SEAT; to the person holding one the
  // true word is Continue, which is exactly what the card draws when it is not
  // locked. seats.js is untouched — the server's count is right, and so is
  // "All seats taken" as a count. What was wrong was reading a count about
  // everybody as a sentence about this one person.
  const locked = full && !off && !claimed;
  // ── AND THE THIRD THING A CARD CAN BE: FINISHED — 22 SEPTEMBER 2026 ───────
  //
  // The owner completed the Cadbury journey end to end and his card still read
  // "Continue", which reopened the journey on "You have been paid ₹96": "Once
  // the campaign is completed, the user should not be able to continue the same
  // campaign again. The campaign card should remain visible in the feed for
  // information, but it should be locked."
  //
  // IT OUTRANKS EVERY OTHER STATE, and that order is the point. A finished
  // journey is finished whether or not the offer's seats are full and whether or
  // not the shop's page still opens — those are facts about the OFFER, and this
  // is a fact about this person's journey through it. Drawn first below for the
  // same reason.
  return (
    <Card
      // NOT TAPPABLE WHEN IT IS OVER. The owner asked for this in so many words,
      // and it is the one card state that opens nothing: there is nowhere left to
      // go on this offer. The history is not lost — My Products keeps every
      // finished journey, and the refund is in Earnings, which the footer says.
      onPress={done ? undefined : onOpen}
      style={[styles.campaignCard, (off || done) && styles.campaignCardOff]}
    >
      {live.label ? (
        <View style={styles.offBanner}>
          <Text style={styles.offBannerText}>{live.label}</Text>
        </View>
      ) : null}
      {/* AND THE CARD IS STILL DRAWN, STILL TAPPABLE, AND STILL IN THE LIST.
          The owner's words: "I don't want the campaign to go away or vanish from
          the app once the slot is full." Nothing filters it — see seats.js — and
          somebody who wants to know what it was may open it and read. */}
      {done ? (
        <View style={styles.lockedBanner}>
          <Text style={styles.lockedBannerText}>{DONE_BANNER}</Text>
        </View>
      ) : null}
      {locked && !done ? (
        <View style={styles.lockedBanner}>
          <Text style={styles.lockedBannerText}>{LOCKED_BANNER}</Text>
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
              Never both: the footer is one line and the scarcer fact wins.

              A LOCKED OFFER SAYS WHAT HAPPENS NEXT INSTEAD OF HOW FULL IT IS.
              The banner above already carries "every slot is taken", so
              repeating it here would spend the one line this footer has on the
              thing the person can already see. */}
          {/* AND NEVER "comes back when a slot opens" TO THE PERSON IN THE
              SEAT — 21 September 2026. The owner, holding the only seat on a
              one-slot offer with a live claim: "It's showing Continue, but it
              is still showing that it comes back when a slot opens." Two
              sentences about one offer, one of them about somebody else. What
              is true for him is that his claim is in progress, which is what
              this line already says when it is allowed to. */}
          {done ? DONE_LINE : (claimed ? null : lockedLine(c)) || seats
            || (claimed ? 'In progress' : `Claim · ${c.ticketCost} tickets`)}
        </Text>
        <Text style={[styles.footerCta, (full || off || done) && styles.footerCtaOff]}>
          {/* "Locked" AND NOT "Claim", because it is not an invitation. What is
              ALLOWED is untouched — the server owns that refusal and answers in
              its own words; this is only what is drawn. */}
          {done ? DONE_CTA
            : off ? live.cta : locked ? LOCKED_CTA : claimed ? 'Continue ›' : 'Claim →'}
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
  // How much empty room the end of the list needs so the floating reminder card
  // never buries the last campaign. The card itself says how much, because only
  // it knows whether it is drawn. See src/ui/waitingPlace.js.
  const [roomForCard, setRoomForCard] = useState(0);

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
        contentContainerStyle={{
          padding: SPACE.lg,
          paddingBottom: SPACE.xxl + roomForCard,
        }}
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
              done={isDone(c.id)}
              // A claimed offer opens its JOURNEY, at whatever page it is on.
              // That is the resume: the page comes from the server's record, so
              // tapping the card can never land somebody back at the beginning.
              onOpen={() => navigation.navigate(
                hasTask(c.id) ? 'Journey' : 'Detail',
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

      {/* THE WAITING BOX — fayr-design.browser.jsx:1699, where the design puts it.
          Outside the ScrollView on purpose: the design pins it just above the tab
          bar so it cannot be scrolled away, which is the whole point of it being
          on Home rather than in My Products.
          It tells this screen how much room to leave at the end of the list, so
          that the last campaign is never buried under it for good. */}
      <WaitingBox navigation={navigation} onRoomNeeded={setRoomForCard} />
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
  // ── LOCKED IS BLUE, AND "NOT RIGHT NOW" IS AMBER ─────────────────────────
  //
  // Deliberately a different colour from the banner above it. Amber is the app's
  // warning tone and it is right for a shop page that has died; a full offer is
  // not a warning and nothing has gone wrong with it. Blue is the tone this app
  // already uses for "this is how things stand", and the two never appear
  // together — see the `locked` line in CampaignRow.
  lockedBanner: {
    backgroundColor: COLOR.blueBg,
    borderBottomWidth: 1,
    borderBottomColor: '#CBE0FF',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  lockedBannerText: { fontFamily: FONT.bodySemi, fontSize: 12, color: '#2F6FD0' },
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
