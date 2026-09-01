// confirm — fayr-design.browser.jsx:2369 (ConfirmJoin)
//
// MOVED HERE ON 1 SEPTEMBER 2026, from src/ConfirmJoinScreen.js, as part of
// giving every design screen its own file under its own key. It is the SAME
// screen: nothing about what it draws changed in the move.
//
// IT IS ALSO THE SURVIVOR OF A DOUBLE BUILD. The claim journey drew its own
// "join the offer" page as well, so one design screen had two implementations.
// This one won: it reads the real ticket balance, the real refund figures and
// the real claim window from the backend, it handles all three refusals the
// server can give, and it carries the honesty acknowledgement the journey's
// version left out. The journey's page is gone, and the journey now sends
// somebody here instead of drawing a second version of it.
//
// It sits between the campaign detail and the claim, and it exists because the
// claim is the moment 5 tickets are actually committed: the user should see what
// they get, what it costs, and by when, on one screen, before that happens.
// Until now the detail screen's button claimed straight away.
//
// Copy and layout are the design's. Three things about it are different, all
// because the design states a number the backend does not have:
//
//  * THE DEADLINE. The design says "within 48 hours of joining — by 6 Jul, 6:00
//    PM"; its own claimed sheet says 2 hours and counts down from 25 minutes; the
//    backend expires a claim after CLAIM_TTL_MINUTES (thirty by default, on the
//    owner's instruction of 1 September 2026) and is the only one of the three
//    that does anything. The server sends its own window with the campaign, the
//    card is omitted entirely if it did not — and it states the LENGTH with no
//    clock time, because the exact instant does not exist until the claim creates
//    it. See ui/confirmJoin.js.
//  * "exact variant: {variant}". Campaigns carry no variant or size — see the
//    report; the line is dropped rather than filled with the product name.
//  * "This claim uses 5 tickets" uses the campaign's real ticketCost.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { PLATFORMS } from '../platforms';
import * as campaignStore from '../backend/campaignStore';
import { getCampaign } from '../backend/campaignsApi';
import { getWallet } from '../backend/meApi';
import { claim as claimTask } from '../taskStore';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Screen, Pill, ProductImage } from '../ui/primitives';
import { CardBox, Row, TopBar } from '../ui/brand';
import { goBackOrHome } from '../ui/nav';
import { claimDeadline, ticketPlan, refundLines } from '../ui/confirmJoin';
import { acceptedTerms, needsTermsLine } from '../ui/terms';

export default function ConfirmJoinScreen({ route, navigation }) {
  const campaignId = route?.params?.campaignId ?? null;
  // THE TICK BOX IS ON THE PRODUCT PAGE, and the acceptance travels here with the
  // person. If it did not arrive, they reached this page some other way — from the
  // staff walk through, for instance — and the claim cannot be made from here,
  // because the server refuses a claim that does not carry it. Saying so plainly
  // beats a button that fails with the server's own wording.
  const cameWithTerms = acceptedTerms(route?.params?.acceptedTerms);
  const [campaign, setCampaign] = useState(
    campaignId ? campaignStore.getById(campaignId) : null,
  );
  const [wallet, setWallet] = useState(null);
  const [ack, setAck] = useState(false);
  const [joining, setJoining] = useState(false);

  // The campaign may not be in the cache (paused, or a cold start), so fall back
  // to the any-status endpoint rather than rendering an empty screen.
  useEffect(() => {
    let live = true;
    if (!campaign && campaignId) {
      getCampaign(campaignId).then((r) => {
        if (live && r.ok) setCampaign(r.campaign);
      });
    }
    getWallet().then((w) => { if (live && w.ok) setWallet(w); });
    return () => { live = false; };
  }, [campaign, campaignId]);

  const tickets = ticketPlan({
    balance: wallet ? wallet.ticketBalance : null,
    cost: campaign ? campaign.ticketCost : null,
  });
  const refund = refundLines(campaign || {});
  const deadline = claimDeadline({
    windowMinutes: campaign ? campaign.claimWindowMinutes : null,
  });

  const join = useCallback(async () => {
    if (!ack || !campaignId || !cameWithTerms) return;
    setJoining(true);
    // The value that ARRIVED, not a literal yes. Writing `true` here would keep
    // working if the guard above were ever removed, and would then send an
    // acceptance nobody gave.
    const res = await claimTask(campaignId, cameWithTerms);
    setJoining(false);
    if (!res.ok) {
      // The two refusals the backend really has, told apart by its own message,
      // each go to the screen the design drew for them.
      const msg = String(res.error || '');
      if (/not enough tickets/i.test(msg)) {
        navigation.replace('NotEnoughTickets', { campaignId });
        return;
      }
      navigation.replace('JoinFailed', { campaignId, error: msg });
      return;
    }
    navigation.replace('Claimed', { campaignId });
  }, [ack, campaignId, cameWithTerms, navigation]);

  if (!campaign) {
    return (
      <Screen bg={COLOR.cream}>
        <TopBar title="Confirm participation" onBack={() => goBackOrHome(navigation)} />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading this campaign…</Text>
        </View>
      </Screen>
    );
  }

  const mkt = PLATFORMS[campaign.marketplace] || {};
  // Not enough tickets is knowable before the button is pressed, so say so here
  // rather than letting the server refuse a commitment the user already made.
  const blocked = tickets.enough === false;

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Confirm participation" onBack={() => goBackOrHome(navigation)} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: SPACE.lg, paddingTop: 4, paddingBottom: SPACE.xl }}
      >
        <CardBox style={styles.productCard}>
          <ProductImage
            imageUrl={campaign.imageUrl}
            seed={campaign.id}
            radius={12}
            style={styles.thumb}
          />
          <View style={styles.productInfo}>
            <Text style={styles.productName} numberOfLines={2}>
              Review {campaign.productName || campaign.title}
            </Text>
            <Text style={styles.productMeta}>{mkt.name || campaign.marketplace}</Text>
            {refund.maxLine ? (
              <Text style={styles.productMax}>{refund.maxLine} max</Text>
            ) : null}
          </View>
        </CardBox>

        <CardBox style={{ marginTop: 12 }}>
          <Text style={styles.boxTitle}>Your refund</Text>
          <Row a="Refund" b={refund.percentLine} last={!refund.maxLine} />
          {refund.maxLine ? <Row a="Maximum" b={refund.maxLine} last /> : null}
        </CardBox>

        <CardBox style={{ marginTop: 12 }}>
          <Text style={styles.boxTitle}>Tickets</Text>
          <Row a="This claim uses" b={`${tickets.cost} tickets`} />
          <Row
            a="Your balance after"
            b={tickets.after == null ? '—' : `${tickets.after} tickets`}
            last
          />
          <Text style={styles.note}>
            {tickets.cost} tickets are deducted now. They return if your claim
            expires before you buy.
          </Text>
        </CardBox>

        {deadline ? (
          <CardBox style={{ marginTop: 12 }}>
            <Text style={styles.boxTitle}>Deadline</Text>
            <Text style={styles.deadline}>
              Buy the product within{' '}
              <Text style={styles.deadlineStrong}>{deadline.within}</Text> of
              joining.
            </Text>
          </CardBox>
        ) : null}

        {blocked ? (
          <View style={styles.shortBox}>
            <Text style={styles.shortTitle}>
              You need {tickets.shortBy} more ticket
              {tickets.shortBy > 1 ? 's' : ''}
            </Text>
            <Text style={styles.shortSub}>
              This claim needs {tickets.cost} tickets. You have {tickets.balance}{' '}
              available.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.ackRow}
          onPress={() => setAck((v) => !v)}
        >
          <View style={[styles.box, ack && styles.boxOn]}>
            {ack ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <Text style={styles.ackText}>
            I'll write an honest review. I understand my rating never affects my
            refund.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        {needsTermsLine(cameWithTerms) ? (
          <Text style={styles.needsTerms}>{needsTermsLine(cameWithTerms)}</Text>
        ) : null}
        <Pill
          onPress={join}
          disabled={!ack || blocked || !cameWithTerms}
          loading={joining}
          color={ack && !blocked && cameWithTerms ? COLOR.ink : '#cfcfcf'}
        >
          CONFIRM &amp; JOIN
        </Pill>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: FONT.body, fontSize: 14, color: COLOR.sub },

  productCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 56, height: 56 },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.ink2, lineHeight: 19 },
  productMeta: { fontFamily: FONT.bodySemi, fontSize: 11.5, color: COLOR.sub, marginTop: 2 },
  productMax: { fontFamily: FONT.bodySemi, fontSize: 11, color: COLOR.greenDeep, marginTop: 5 },

  boxTitle: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.ink2, marginBottom: 8 },
  note: { fontFamily: FONT.body, fontSize: 11, color: COLOR.sub, marginTop: 8, lineHeight: 16 },
  deadline: { fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub, lineHeight: 19 },
  deadlineStrong: { fontFamily: FONT.bodySemi, color: COLOR.ink2 },

  shortBox: {
    marginTop: 12, backgroundColor: COLOR.redBg, borderRadius: RADIUS.md, padding: 14,
  },
  shortTitle: { fontFamily: FONT.displaySemi, fontSize: 15, color: COLOR.ink },
  shortSub: { fontFamily: FONT.body, fontSize: 12.5, color: COLOR.sub, marginTop: 4, lineHeight: 18 },

  needsTerms: {
    fontFamily: FONT.body, fontSize: 12.5, lineHeight: 18, color: COLOR.sub,
    textAlign: 'center', marginBottom: 10,
  },

  ackRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14 },
  box: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#B9BAA9',
    marginTop: 2, alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: COLOR.green, borderColor: COLOR.green },
  tick: { color: '#fff', fontSize: 13, fontFamily: FONT.displaySemi, marginTop: -1 },
  ackText: {
    flex: 1, fontFamily: FONT.bodySemi, fontSize: 12.5, color: COLOR.ink2, lineHeight: 19,
  },

  footer: { paddingHorizontal: SPACE.lg, paddingTop: 10, paddingBottom: SPACE.lg },
});
