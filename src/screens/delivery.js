// delivery — fayr-design.browser.jsx:2963 (DeliveryConfirm)
//
// "Delivered?" — the screen that opens the review step. Split out of
// src/journey/JourneyScreen.js on 1 September 2026, where it was one page of ten
// inside one file.
//
// ── IT NO LONGER ASKS. IT READS. ──────────────────────────────────────────
//
// THE CLAIM THE WHOLE PRODUCT IS MAKING is that Fayr finds your purchase and
// confirms the delivery by itself. This screen was the last place that was not
// true: it drew a green "YES — IT IS DELIVERED" button and waited to be tapped.
//
// A TAP CANNOT SETTLE A DELIVERY, and never could. A refund that moved because
// somebody said "it came" is a refund anybody could have, which is the whole
// reason the shop's own page is the evidence and not the person's word. So the
// button asked Fayr to look anyway — meaning the read already had to exist, and
// the tap in front of it was doing nothing except delaying it.
//
// SO IT LOOKS ON ITS OWN, the moment it opens, and nobody is asked anything.
//
// ── THE SAME READ, NOT A SECOND ONE ───────────────────────────────────────
//
// It starts src/order/LookingForItScreen.js, which is the read the purchase step
// already runs: the shop's own list of recent orders opened from inside the web
// view the person is signed in to, each order's own page read as words, and the
// text handed to the server. Writing a second reader here would be two copies of
// one thing, in one language, both deciding things about somebody's refund.
//
// THE SERVER DOES THE REST WITHOUT BEING TOLD TO. A later look at an order
// somebody has already said is theirs now fills in the delivery it did not have
// — see deliveryFromALaterLook in backend/src/tasks/order-candidates.service.ts —
// and a delivery fragment moves the task to DELIVERED through the ordinary
// funnel. The journey then works its own step out from the record and lands on
// the review step by itself. Nothing on this screen chooses that.
//
// ── WHAT WAS REMOVED, AND WHY EACH ONE HAD TO GO ──────────────────────────
//
// "YES — IT IS DELIVERED" is gone. It was a question whose answer Fayr does not
// accept, dressed as a decision.
//
// "Open <shop> so we can read it" is gone, and it was a bug. It called
// navigation.navigate(key) — the marketplace's own web view, which is the screen
// for READING A REVIEW — and landed the person on the shop's home page with no
// reason to be there and nothing to do. Nobody has to open their shop for Fayr:
// the read above opens it.
//
// "It is late, or there is a problem" stays. The design's own deliverydelayed
// screen has not been built, so it says so plainly and opens help.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { getTask as getTaskFromServer } from '../backend/tasksApi';
import { getAuthoritative, getTaskId, subscribe } from '../taskStore';
import { PLATFORMS } from '../platforms';
import {
  alreadyLookedForDelivery, rememberWeLookedForDelivery,
} from '../order/deliveryLook';
import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { Ghost, TextBtn, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';

/**
 * HOW LONG THE READ IS GIVEN TO TAKE THIS SCREEN AWAY.
 *
 * Starting the read means leaving for it, so in the ordinary case this screen is
 * gone within a frame and this timer never fires. It is here for the case where
 * it is not gone: a navigator that refused the move, or this screen opened
 * somewhere that has no navigator at all, like the walk through.
 *
 * NOBODY IS LEFT ON A SPINNER. That is the same rule the read itself keeps — see
 * MOST_TIME_MS in LookingForItScreen — and it is worth keeping twice, because
 * the failure it guards against is a screen with no way off it.
 */
export const READ_SHOULD_HAVE_LEFT_MS = 4000;

export default function DeliveryScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const product = campaign ? campaign.productName || campaign.title : null;
  const key = campaign ? campaign.marketplace : null;
  const shop = key && PLATFORMS[key] ? PLATFORMS[key].name : 'the shop';

  const [, setTick] = useState(0);
  const taskId = campaignId ? getTaskId(campaignId) : null;

  // ── WHERE THIS SCREEN IS, IN ONE WORD ────────────────────────────────────
  //
  //   'reading'  the shop is being read, right now
  //   'nothing'  it was read, and the shop's page does not say it arrived
  //
  // There is no third value for "delivered": that is not a state of this screen,
  // it is a state of the RECORD, and when the record says so the journey has
  // already moved somebody past here. Keeping a copy of it on this side is how
  // two places end up disagreeing about where somebody is.
  const looked = alreadyLookedForDelivery(taskId);
  const [where, setWhere] = useState(looked ? 'nothing' : 'reading');
  const started = useRef(false);

  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);

  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return undefined;
    const reread = () => {
      const id = campaignId ? getTaskId(campaignId) : null;
      if (id) getTaskFromServer(id).catch(() => {});
    };
    const unfocus = navigation.addListener('focus', reread);
    reread();
    return unfocus;
  }, [navigation, campaignId]);

  // ── THE READ, STARTED BY THIS SCREEN OPENING AND BY NOTHING ELSE ─────────
  useEffect(() => {
    if (started.current) return undefined;
    started.current = true;
    // NO TASK IS NOTHING TO READ. The read is of one person's orders against one
    // claim, and without a task there is no claim to read them against.
    if (taskId == null || alreadyLookedForDelivery(taskId)) {
      setWhere('nothing');
      return undefined;
    }
    // THE NOTE IS WRITTEN BEFORE THE MOVE, not after it. Written after, a screen
    // that comes straight back has no note and starts again.
    rememberWeLookedForDelivery(taskId);
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('LookingForIt', { campaignId });
    }
    const giveUp = setTimeout(() => setWhere('nothing'), READ_SHOULD_HAVE_LEFT_MS);
    return () => clearTimeout(giveUp);
  }, [navigation, campaignId, taskId]);

  const problem = useCallback(() => {
    Alert.alert(
      'Tell us what happened',
      'There is no screen for a late, wrong or lost parcel yet. Open Help and '
      + 'support and tell us in your own words, and a person at Fayr will sort it '
      + 'out. Nothing about your claim is lost while we do.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open help', onPress: () => navigation.navigate('Support') },
      ],
    );
  }, [navigation]);

  const task = campaignId ? getAuthoritative(campaignId) : null;
  const delivered = !!(task && task.delivery);
  const reading = where === 'reading' && !delivered;

  return (
    <Screen bg={COLOR.cream}>
      <View style={styles.body}>
        <Text style={styles.parcel}>📦</Text>
        <Text style={[hTitle, styles.title]}>
          {delivered ? 'It arrived' : reading ? 'Checking' : 'Not yet'}
        </Text>
        <Text style={[hSub, styles.sub]}>
          {delivered
            ? `${shop} has told us it arrived. The review step is open.`
            : reading
              ? `Checking your ${shop} orders…`
              : product
                ? `We checked your ${shop} orders. ${shop} has not said your `
                  + `${product} arrived yet.`
                : `We checked your ${shop} orders. ${shop} has not said it `
                  + 'arrived yet.'}
        </Text>

        {!reading && !delivered ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nothing to do</Text>
            <Text style={styles.cardBody}>
              We read the delivery from your own orders on {shop}, so there is
              nothing to tap and nothing to tell us. We look again next time you
              open this. If it has arrived and {shop} is slow to say so, send us a
              picture and a person will take it from there.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        {/* THE ONE THING THERE IS TO OFFER, and only once the read has run.
            Offering it while the shop is still being read would be asking for a
            photograph of something Fayr is in the middle of reading for itself. */}
        {!reading && !delivered ? (
          <Ghost
            onPress={() => navigation.navigate('ProofUpload', {
              campaignId, kind: 'DELIVERY',
            })}
          >
            Send a picture of the delivery
          </Ghost>
        ) : null}
        <TextBtn onPress={problem}>It is late, or there is a problem</TextBtn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  parcel: { fontSize: 56 },
  title: { marginTop: 16, textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 285 },
  card: {
    marginTop: SPACE.xl, backgroundColor: COLOR.amberBg, borderWidth: 1,
    borderColor: COLOR.amberLine, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, maxWidth: 305,
  },
  cardTitle: { fontFamily: FONT.displaySemi, fontSize: 13, color: '#8A5A00' },
  cardBody: {
    fontFamily: FONT.bodyMed, fontSize: 12, lineHeight: 18, color: '#7A5A10',
    marginTop: 4,
  },
  foot: { paddingHorizontal: 28, paddingBottom: 28, gap: 8 },
});
