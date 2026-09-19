// shop — the shop inside Fayr, as a step of the journey. Figma 74:60107.
//
// ── A DOOR, AND SINCE PHASE 8A THE WAIT BEHIND IT ───────────────────────────
//
// The journey's router draws one design screen per step, and for the three
// quick-commerce shops the step after claiming is "you are buying". The shop
// itself is src/shop/ShopScreen.js — a full-screen web view with Fayr's bar
// across the top — and it cannot be drawn inside the journey's strip. So this
// screen does the one thing the step has to do when nothing has been bought:
// it records the consent our side needs and hands over to the Shop route,
// through the same door the claim uses. See src/shop/enterTheShop.js.
//
// ── AND ONCE AN ORDER HAS BEEN WATCHED, IT IS THE PLACE FAYR READS IT FROM ──
//
// 19 September 2026. The owner: "Once the payment is done and they come back
// to the Zepto app [inside Fayr], I want the app to redirect me to the Fayr
// campaign page." The shop screen sees the confirmation, tells our side the key
// in its address, and hands over HERE. What this screen then does is start the
// read of THAT ONE order's page — LookingForItScreen, the same read as always,
// pointed at one page instead of the list — and, between looks, say so.
//
// WHICH OF THE FIVE FACES is decided next door in src/journey/shopStep.js and
// is pure; WHEN a look may start is src/journey/deliveryCadence.js, the same
// floor the delivery step keeps for the same page. This file draws and does.
// It never reads a page, never judges one, and moves no task: the server does
// all three from the text the read hands it.
//
// WHAT IT DRAWS on the door face is a moment's wait, and — only if our side
// refused to record the visit — the refusal in our side's own words and a way
// to try again. It never draws the shop and never decides anything about it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import * as campaignStore from '../backend/campaignStore';
import { pendingTaskIds } from '../backend/evidenceSync';
import { PLATFORMS } from '../platforms';
import { enterTheShop } from '../shop/enterTheShop';
import { getAuthoritative, getTaskId, subscribe } from '../taskStore';
import { theWatchedOrderKey } from '../order/whichRead';
import { shopStepFace } from '../journey/shopStep';
import {
  mayLookForDeliveryNow, rememberTheDeliveryLook, untilTheNextLook,
} from '../journey/deliveryCadence';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { Ghost, Pill, TopBar, hSub, hTitle } from '../ui/brand';
import { Screen } from '../ui/primitives';
import { goBackOrHome } from '../ui/nav';
import {
  ORDER_PLACED_WE_SAW_IT, TELLING_OUR_SIDE, TRY_AGAIN, WE_CANNOT_COUNT_THIS_ORDER,
  notWrittenUpYet, openTheShopAgain, readingYourOrder, weLookAgainIn,
} from '../ui/journeyWords';

/** How often an open screen asks the cadence again. Half a minute, like the shop's bar. */
const ASK_AGAIN_EVERY_MS = 30000;

export default function ShopStepScreen({ navigation, route }) {
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;
  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const marketplace = campaign ? campaign.marketplace : params.marketplace || null;
  const shop = marketplace && PLATFORMS[marketplace] ? PLATFORMS[marketplace].name : 'the shop';

  const [refusal, setRefusal] = useState(null);
  const opening = useRef(false);

  // ── THE RECORD, WATCHED, AND A CLOCK THAT ASKS AGAIN ────────────────────
  const [, setTick] = useState(0);
  const [now, setNow] = useState(Date.now());
  const task = campaignId ? getAuthoritative(campaignId) : null;
  const taskId = campaignId ? getTaskId(campaignId) : null;
  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ASK_AGAIN_EVERY_MS);
    return () => clearInterval(t);
  }, []);

  // ── WHICH FACE, DECIDED NEXT DOOR ────────────────────────────────────────
  //
  // The key is the RECORD's. `waitingForOurSide` is the one thing the record
  // cannot say: the phone told our side a key and the body is still parked in
  // the outbox, so the order WAS watched and nothing can be read yet.
  const watchedOrderKey = theWatchedOrderKey(task);
  const waitingForOurSide = !!(taskId && pendingTaskIds().indexOf(taskId) !== -1);
  const face = shopStepFace({
    watchedOrderKey,
    waitingForOurSide,
    blocker: task ? task.blocker : null,
    mayLookNow: taskId ? mayLookForDeliveryNow(taskId, now) : false,
  });

  const open = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    setRefusal(null);
    const went = await enterTheShop({ campaignId, marketplace, navigation });
    opening.current = false;
    if (!went.ok) setRefusal(went.refusal);
  }, [campaignId, marketplace, navigation]);

  // ONCE, WHEN THE STEP IS REACHED AS A DOOR, AND NOT ON EVERY RE-RENDER. The
  // router redraws on every change to the record; the door must not open twice
  // for it — and it must not open at all once an order has been watched.
  useEffect(() => {
    if (face !== 'enter') return;
    void open();
  }, [face, open]);

  // ── THE READ, STARTED BY THE SCREEN, ON THE CADENCE, WITH NO TAP ────────
  //
  // The note that a look started is written BEFORE the move, for the reason
  // the delivery step gives: a screen that comes straight back has no note and
  // starts again. And it goes to LookingForIt exactly as the delivery step
  // does; which page that read opens is decided there, from the record.
  const started = useRef(false);
  useEffect(() => {
    if (face !== 'read-now' || !taskId || started.current) return;
    started.current = true;
    rememberTheDeliveryLook(taskId, Date.now());
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('LookingForIt', { campaignId });
    }
  }, [face, taskId, campaignId, navigation]);

  const minutesToTheNextLook = taskId ? untilTheNextLook(taskId, now) / 60000 : 0;

  // ── THE FACES ────────────────────────────────────────────────────────────
  if (face === 'telling' || face === 'read-now' || face === 'waiting') {
    return (
      <Screen bg={COLOR.cream}>
        <TopBar title="Your order" onBack={() => goBackOrHome(navigation)} />
        <View style={styles.middle}>
          <Text style={styles.parcel}>🧾</Text>
          <Text style={[hTitle, styles.title]}>{ORDER_PLACED_WE_SAW_IT}</Text>
          {/* WHAT FAYR IS DOING, and never a claim that the purchase counted.
              The server decides that, from the page the read hands it. */}
          <Text style={[hSub, styles.sub]}>
            {face === 'telling'
              ? TELLING_OUR_SIDE
              : face === 'read-now'
                ? readingYourOrder(shop)
                : `${notWrittenUpYet(shop)} ${weLookAgainIn(minutesToTheNextLook)}`}
          </Text>
          {face === 'waiting' ? null : (
            <ActivityIndicator size="large" color={COLOR.greenDeep} style={styles.spinner} />
          )}
        </View>
        {face === 'waiting' ? (
          <View style={styles.foot}>
            {/* THE ONE QUIET DOOR LEFT: the shop, again, through the same door
                the claim uses. Browsing is fine; our side keeps the first key
                it heard, so a second purchase cannot move where it looks. */}
            <Ghost onPress={open}>{openTheShopAgain(shop)}</Ghost>
          </View>
        ) : null}
      </Screen>
    );
  }

  if (face === 'refused') {
    return (
      <Screen bg={COLOR.cream}>
        <TopBar title="Your order" onBack={() => goBackOrHome(navigation)} />
        <View style={styles.middle}>
          <Text style={styles.parcel}>🧾</Text>
          <Text style={[hTitle, styles.title]}>{WE_CANNOT_COUNT_THIS_ORDER}</Text>
          {/* OUR SIDE'S OWN WORDS, when it gave some. It knows why it refused
              and this screen does not, so nothing is invented here. */}
          {task && task.blockerReason ? (
            <Text style={[hSub, styles.sub]}>{task.blockerReason}</Text>
          ) : null}
        </View>
        <View style={styles.foot}>
          <Ghost onPress={open}>{openTheShopAgain(shop)}</Ghost>
        </View>
      </Screen>
    );
  }

  return (
    <Screen bg={COLOR.cream}>
      <TopBar title="Opening the shop" onBack={() => goBackOrHome(navigation)} />
      <View style={styles.middle}>
        {refusal ? (
          <>
            <Text style={[hTitle, styles.title]}>We could not open the shop</Text>
            <Text style={[hSub, styles.sub]}>{refusal}</Text>
            <Pill onPress={open} color={COLOR.ink}>{TRY_AGAIN.toUpperCase()}</Pill>
          </>
        ) : (
          <ActivityIndicator size="large" color={COLOR.greenDeep} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  middle: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACE.xl, gap: SPACE.md,
  },
  parcel: { fontSize: 52 },
  title: { textAlign: 'center' },
  sub: { textAlign: 'center', maxWidth: 300, fontFamily: FONT.bodyMed },
  spinner: { marginTop: SPACE.md },
  foot: { paddingHorizontal: SPACE.xl, paddingBottom: SPACE.xl, gap: 8 },
});
