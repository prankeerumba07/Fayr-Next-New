// What the design shows the moment a claim resolves — the three outcomes of
// CONFIRM & JOIN, each drawn as the design draws it:
//
//   ClaimedSheet       (fayr-design.browser.jsx:2191)  it worked
//   InsufficientSheet  (:2424)                         not enough tickets
//   EnrollFailed       (:2462)                         it did not go through
//
// They live in one file because they are one decision with three answers, and
// because two of them are three lines of copy each.
//
// Two deliberate differences from the design, both because it states a number the
// backend does not:
//
//  * The claimed sheet's timer. The design counts down from 25m 35s and says the
//    product is yours "for the next 2 hours". The real deadline is the task's own
//    claimExpiresAt (CLAIM_TTL_DAYS, 7 days by default), so the sheet shows the
//    real time remaining in the design's own shape. A ticking clock on a 7-day
//    window would be theatre, so it reads in days and hours and refreshes on
//    focus rather than every second.
//  * "Held in active claims" on the insufficient sheet. There is no held bucket in
//    the ledger — claiming DEDUCTS and an expiry RETURNS — so the figure is
//    derived from the user's own open claims, which are exactly the tickets that
//    would come back. A PURCHASED claim has spent them for good and is excluded.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { PLATFORMS } from './platforms';
import * as campaignStore from './backend/campaignStore';
import { getWallet } from './backend/meApi';
import { getAuthoritative, getTasks } from './taskStore';
import { COLOR, FONT, RADIUS, SPACE, SHADOW } from './ui/theme';
import { Screen, Pill } from './ui/primitives';
import { heldTicketCount, remainingToBuy } from './ui/confirmJoin';

/** The design's TextBtn: a quiet centred secondary action. */
function TextBtn({ children, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.textBtn}>
      <Text style={styles.textBtnLabel}>{children}</Text>
    </TouchableOpacity>
  );
}

function Row({ a, b, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowA}>{a}</Text>
      <Text style={styles.rowB}>{b}</Text>
    </View>
  );
}

// ── Claimed ─────────────────────────────────────────────────────────────────

export function ClaimedScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const [remaining, setRemaining] = useState(() =>
    remainingToBuy(getAuthoritative(campaignId)),
  );

  // Re-read on focus, not on a timer: the window is days long, so a per-second
  // clock would burn battery to redraw the same sentence.
  useEffect(() => {
    const un = navigation.addListener('focus', () => {
      setRemaining(remainingToBuy(getAuthoritative(campaignId)));
    });
    return un;
  }, [navigation, campaignId]);

  const mkt = PLATFORMS[campaign?.marketplace] || {};
  const mktName = mkt.name || 'the marketplace';
  const cost = campaign?.ticketCost ?? 5;

  const buy = useCallback(() => {
    // Straight to the marketplace handoff the app already has, with the campaign
    // attached so the scraper knows what it is looking for.
    if (campaign?.marketplace) {
      navigation.replace(campaign.marketplace, { campaignId });
      return;
    }
    navigation.replace('Task', { campaignId });
  }, [campaign, campaignId, navigation]);

  return (
    <Screen bg={COLOR.homeBg}>
      <View style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.bigTick}>✔️</Text>
          <Text style={styles.claimedTitle}>Product Claimed!</Text>
          <Text style={styles.claimedSub}>
            {remaining
              ? `This product is yours for the next ${remaining.phrase}. Buy it on ${mktName} before the time runs out.`
              : `Buy it on ${mktName} to start your refund.`}
          </Text>
          <View style={styles.ticketChip}>
            <Text style={styles.ticketChipText}>
              🎟 {cost} tickets held · returned if the claim expires
            </Text>
          </View>
          {remaining ? (
            <View style={styles.timerBox}>
              <Text style={styles.timerValue}>{remaining.clock}</Text>
              <Text style={styles.timerLabel}>Remaining</Text>
            </View>
          ) : null}
          <View style={{ marginTop: 18 }}>
            <Pill onPress={buy} color={COLOR.greenDeep}>
              {`Go to ${mktName} →`}
            </Pill>
          </View>
          <TextBtn onPress={() => navigation.replace('Task', { campaignId })}>
            I'll buy in a bit
          </TextBtn>
        </View>
      </View>
    </Screen>
  );
}

// ── Not enough tickets ──────────────────────────────────────────────────────

export function NotEnoughTicketsScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const cost = campaign?.ticketCost ?? 5;
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    let live = true;
    getWallet().then((w) => { if (live && w.ok) setBalance(w.ticketBalance); });
    return () => { live = false; };
  }, []);

  const held = heldTicketCount(authoritativeTasks());
  const need = balance == null ? null : Math.max(0, cost - balance);

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.centre}>
        <Text style={styles.emoji}>🎟</Text>
        <Text style={styles.title}>
          {need == null
            ? 'You need more tickets'
            : `You need ${need} more ticket${need === 1 ? '' : 's'}`}
        </Text>
        <Text style={styles.sub}>
          {balance == null
            ? `This claim needs ${cost} tickets.`
            : `This claim needs ${cost} tickets. You have ${balance} available.`}
        </Text>
        <View style={styles.card}>
          <Row a="Available" b={balance == null ? '—' : `${balance} tickets`} />
          <Row a="Held in active claims" b={`${held} tickets`} last />
        </View>
        <Text style={styles.note}>
          Held tickets return automatically if a claim expires before you buy.
        </Text>
        <View style={styles.greenBanner}>
          <Text style={styles.greenBannerText}>
            Complete a campaign to earn tickets back →
          </Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Pill onPress={() => navigation.navigate('Tabs', { screen: 'MyProducts' })}>
          GO TO MY PRODUCTS
        </Pill>
        <TextBtn onPress={() => navigation.goBack()}>Not now</TextBtn>
      </View>
    </Screen>
  );
}

// ── It did not go through ───────────────────────────────────────────────────

export function JoinFailedScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  const error = route?.params?.error || '';
  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.centre}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.sub}>
          Your claim didn't go through.{' '}
          <Text style={styles.subStrong}>No tickets were used.</Text>
        </Text>
        {/* The server's own words, when it gave any. Inventing a friendlier
            sentence would hide the one fact that explains the failure — e.g.
            "Campaign is full", which no retry will fix. */}
        {error ? <Text style={styles.reason}>{error}</Text> : null}
      </View>
      <View style={styles.footer}>
        <Pill onPress={() => navigation.replace('ConfirmJoin', { campaignId })}>
          TRY AGAIN
        </Pill>
        <TextBtn onPress={() => navigation.replace('Detail', { campaignId })}>
          Back to campaign
        </TextBtn>
      </View>
    </Screen>
  );
}

/** Every task the server has told us about, as authoritative rows. */
function authoritativeTasks() {
  return Object.keys(getTasks())
    .map((cid) => getAuthoritative(cid))
    .filter(Boolean);
}

const styles = StyleSheet.create({
  // claimed sheet
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    marginHorizontal: 14, marginBottom: 26, backgroundColor: '#FFFDF2',
    borderRadius: 22, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24,
    alignItems: 'center', ...SHADOW.card,
  },
  grabber: { width: 44, height: 4, backgroundColor: '#E5DCA6', borderRadius: 4, marginBottom: 16 },
  bigTick: { fontSize: 52 },
  claimedTitle: { fontFamily: FONT.displayXBold, fontSize: 24, color: COLOR.ink, marginTop: 10 },
  claimedSub: {
    fontFamily: FONT.body, fontSize: 13, color: COLOR.sub, marginTop: 8,
    textAlign: 'center', maxWidth: 280, lineHeight: 20,
  },
  ticketChip: {
    marginTop: 12, backgroundColor: '#FFF3D6', borderWidth: 1, borderColor: '#EAD79A',
    borderRadius: 100, paddingVertical: 5, paddingHorizontal: 13,
  },
  ticketChipText: { fontFamily: FONT.displaySemi, fontSize: 12, color: '#8a6d10' },
  timerBox: {
    marginTop: 16, backgroundColor: '#FFE9E6', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', minWidth: 200,
  },
  timerValue: { fontFamily: FONT.displayXBold, fontSize: 26, color: COLOR.red },
  timerLabel: { fontFamily: FONT.bodySemi, fontSize: 11, color: '#8f6a63', marginTop: 2 },

  // the two message screens
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emoji: { fontSize: 56 },
  title: {
    fontFamily: FONT.displayXBold, fontSize: 24, color: COLOR.ink, marginTop: 16,
    textAlign: 'center',
  },
  sub: {
    fontFamily: FONT.body, fontSize: 14, color: COLOR.sub, marginTop: 8,
    textAlign: 'center', maxWidth: 280, lineHeight: 21,
  },
  subStrong: { fontFamily: FONT.bodySemi, color: COLOR.ink2 },
  reason: {
    fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub, marginTop: 14,
    textAlign: 'center', maxWidth: 290, lineHeight: 18,
  },
  card: {
    alignSelf: 'stretch', marginTop: 14, backgroundColor: COLOR.surface,
    borderRadius: RADIUS.lg, padding: 16, ...SHADOW.card,
  },
  note: {
    fontFamily: FONT.body, fontSize: 11.5, color: COLOR.sub, marginTop: 10,
    alignSelf: 'stretch',
  },
  greenBanner: {
    alignSelf: 'stretch', marginTop: 8, backgroundColor: COLOR.greenBg,
    borderWidth: 1, borderColor: '#1FD75D', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  greenBannerText: { fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.greenDeep },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowA: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.sub },
  rowB: { fontFamily: FONT.bodySemi, fontSize: 13, color: COLOR.ink2 },

  footer: { paddingHorizontal: 28, paddingBottom: 28 },
  textBtn: { paddingVertical: 12, alignItems: 'center' },
  textBtnLabel: { fontFamily: FONT.bodySemi, fontSize: 13.5, color: COLOR.sub },
});
