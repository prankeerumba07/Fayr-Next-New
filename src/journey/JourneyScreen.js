// THE CLAIM JOURNEY — THE ROUTER, AND NOTHING ELSE.
//
// This file used to BE the journey: one component drawing eleven of the design's
// screens as interior pages, with every heading, button and card in it. On
// 1 September 2026 those eleven moved out, one file each, under the design's own
// keys, in src/screens/. What is left here is the part that could not move: the
// piece that works out WHICH of them a person is on.
//
// WHY THERE IS A ROUTER AT ALL, rather than eleven destinations somebody navigates
// between. Because coming back from the shop must land on the right screen, and the
// only way to guarantee that is to work it out from the server's record every single
// time — never from a pointer on the phone, which can be lost, and never from
// wherever the person happened to be when they left. There is no local state to go
// stale here: the record decides, on every arrival.
//
//   the server's record  →  ui/journey.js: journeyStepFor  →  a design key
//                        →  src/screens/index.js           →  that screen
//
// EVERY ONE OF THE ELEVEN IS ALSO A DESTINATION IN ITS OWN RIGHT, registered in
// App.js under its own design key. That is not a second route to the same thing: it
// is one component, in one file, reachable either by walking the journey or by being
// sent straight to it. The design does exactly this — its own screens map is keyed
// the same way.
//
// THE STRIP ABOVE THE SCREEN IS OURS, NOT THE DESIGN'S, and it is the only thing
// this file draws. No journey screen in the design tells anybody where they are in
// the journey, and ui/journey.js says so out loud. Ten steps with no sense of
// progress is worse, so the strip stays — above the design's screen, never inside
// it, so that a screen opened on its own is exactly what the design draws.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { InsideJourneyContext } from './insideJourney';

import * as campaignStore from '../backend/campaignStore';
import { listScreenshots } from '../backend/screenshotsApi';
import { getTask } from '../backend/tasksApi';
import { getAuthoritative, getTaskId, isPending, getActionError, subscribe } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { COLOR, FONT, SPACE } from '../ui/theme';
import { StageChip, StepTracker } from '../ui/stagebits';
import { journeyView } from '../ui/journey';
import { goBackOrHome } from '../ui/nav';
import { screenFor } from '../screens';
import {
  SAID_THEY_BOUGHT, SIGNED_IN, WENT_TO_BUY, hasVisitedShop,
} from './shopVisits';
import { isConnected as isShopConnected } from '../backend/connectedShops';

/** The tone each step is drawn in, from the design's own palette. */
const TONE = {
  join: 'amber', connect: 'amber', buy: 'amber',
  'purchase-shot': 'blue', checking: 'blue', 'order-details': 'blue',
  delivered: 'blue',
  review: 'purple', 'review-shot': 'purple',
  window: 'green', refund: 'green',
};

export default function JourneyScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const params = (route && route.params) || {};
  const campaignId = params.campaignId || null;

  const [, setTick] = useState(0);
  const [purchaseShots, setPurchaseShots] = useState(0);

  const campaign = campaignId ? campaignStore.getById(campaignId) : null;
  const authoritative = campaignId ? getAuthoritative(campaignId) : null;
  const taskId = campaignId ? getTaskId(campaignId) : null;

  // Redraw whenever the server's record changes: that record is what decides which
  // screen this is, so the router has to follow it rather than its own state.
  useEffect(() => {
    if (!campaignId) return undefined;
    return subscribe(() => setTick((n) => n + 1));
  }, [campaignId]);

  const loadShots = useCallback(async () => {
    if (!taskId) { setPurchaseShots(0); return; }
    const res = await listScreenshots(taskId);
    const shots = res.ok ? res.uploads.filter((u) => u.kind === 'PURCHASE') : [];
    setPurchaseShots(shots.length);
  }, [taskId]);

  // ON EVERY ARRIVAL, NOT ONLY THE FIRST. Coming back from the shop, or from the
  // marketplace sign in, has to re-read the record — that is the whole mechanism
  // behind landing on the right screen.
  useEffect(() => {
    const unfocus = navigation.addListener('focus', () => {
      void loadShots();
      if (taskId) getTask(taskId).catch(() => {});
    });
    void loadShots();
    return unfocus;
  }, [navigation, loadShots, taskId]);

  const marketplace = campaign ? campaign.marketplace : null;
  const shopName = marketplace && PLATFORMS[marketplace]
    ? PLATFORMS[marketplace].name
    : null;

  const facts = {
    task: authoritative,
    // ── ARE THEY SIGNED IN AT THIS SHOP? FOUR ANSWERS, AND THE FIRST IS NEW ──
    //
    // OUR OWN RECORD COMES FIRST, and adding it is the fix for the thing that
    // stopped the owner dead. Measured from his log on 9 September 2026: Amazon
    // connect succeeded at 19:06, the app asked Amazon for its sign in page again
    // at 19:10 for a second campaign, and Amazon answered with a body reading
    // only "Click the button below to continue shopping", then 503, then its
    // robot puzzle. Every extra visit to a shop's sign in page brings that block
    // closer, and it was an entirely unnecessary visit.
    //
    // The three below it are all DEVICE-LOCAL and all narrower than the question:
    // the first is about THIS TASK, the second about THIS CAMPAIGN, and the third
    // is a note in a file keyed by campaign and sign-in. Keyed BY CAMPAIGN — so a
    // second campaign at the same shop read as a shop nobody had ever signed in
    // to, and a reinstall lost all three.
    //
    // They are KEPT, not replaced. Each is still a true reason to believe
    // somebody is signed in, and our side's record can be a moment behind on a
    // first launch. Any one of the four is enough.
    connected:
      isShopConnected(marketplace)
      || !!(authoritative && authoritative.order)
      || purchaseShots > 0
      || hasVisitedShop(campaignId, SIGNED_IN),
    // The two steps that happen entirely on the phone, before the shop has told
    // Fayr anything. Everything from "we can see an order" onwards ignores these
    // completely — see journey.js, where the server's record is read first.
    wentToBuy: hasVisitedShop(campaignId, WENT_TO_BUY),
    saidTheyBought: hasVisitedShop(campaignId, SAID_THEY_BOUGHT),
    // Whether a screenshot is needed at all is the SERVER'S business, read off the
    // task's own blocker by journey.js. Not passed here, so there is one place that
    // decides it and no chance of this file disagreeing.
    purchaseShotSent: purchaseShots > 0,
    productName: campaign ? campaign.productName || campaign.title : null,
    shopName,
    busy: campaignId ? isPending(campaignId) : false,
    error: campaignId ? getActionError(campaignId) : null,
  };

  // `showPage` exists for the walk through and for nothing else. Which screen this
  // is, is normally the SERVER'S decision, worked out from the claim's own record —
  // which is what makes coming back from the shop land in the right place. That also
  // means most of the eleven cannot be looked at unless a claim happens to be at
  // that exact point, so the walk through asks for one by name. Unset, nothing
  // changes: the record decides, as it must.
  // ONE DERIVATION, NOT TWO. journeyView answers both "which step" and "where is
  // that in the journey", so the router asks once and reads both off the answer.
  // Working the step out here as well would be a second copy of the decision, and
  // two copies of one decision is the defect class this project keeps finding.
  const view = journeyView({ ...facts, forcedStep: params.showPage || null });
  const stepKey = view.key;
  const designKey = view.designKey;
  const Screen = designKey ? screenFor(designKey) : null;

  if (!campaign) {
    return (
      <View style={styles.root}>
        <Text style={styles.missing}>That offer is not here any more.</Text>
        <TouchableOpacity
          onPress={() => goBackOrHome(navigation)}
          style={styles.back}
          activeOpacity={0.8}
        >
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!Screen) {
    // A step with no screen behind it. It cannot happen — keys.test.mjs checks
    // every design key named by the journey really has a file — so this says what
    // went wrong rather than showing a blank.
    return (
      <View style={styles.root}>
        <Text style={styles.missing}>
          There is no screen for step &quot;{String(stepKey)}&quot; yet.
        </Text>
        <TouchableOpacity
          onPress={() => goBackOrHome(navigation)}
          style={styles.back}
          activeOpacity={0.8}
        >
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tone = TONE[stepKey] || 'blue';

  return (
    <View style={styles.root}>
      <Where insets={insets} view={view} tone={tone} />
      {/* THE STRIP HAS ALREADY EATEN THE TOP OF THE PHONE, so the screen below it
          must not step around the notch a second time.

          Every one of the twelve screens is built to be opened on its own as well
          as inside the journey, so each keeps clear of the notch by itself. Under
          the strip that is the wrong thing to do: the strip is already below the
          notch, so the screen leaves a second notch-sized band of empty colour
          under it. That is the gap the owner saw on 1 September 2026 above
          "Confirm participation" and above "Connect your account".

          Rather than passing a flag down into twelve screens and hoping each one
          honours it, the router simply tells everything inside it that there is no
          notch left to avoid. Nothing in the screens changes, nothing can forget
          to check a flag, and the very same screen opened on its own still keeps
          clear of the notch exactly as before, because then nobody is telling it
          otherwise.

          THE KEY IS LOAD-BEARING. Two adjacent steps can be drawn by two different
          components, and React keeps a component instance when the type is the
          same. Keying on the design key forces a real remount when the step
          changes, which is what moving to another screen is. */}
      {/* TWO THINGS SAID ONCE TO EVERYTHING INSIDE, for the same reason.
          The notch has already been stepped around by the strip, and the space
          above a screen's body is already owned by the strip too. Rather than
          passing two flags down into a dozen screens and hoping each one honours
          them, the router says both here. A screen opened on its own hears neither
          and behaves exactly as it did before.

          THE EMPTY BAND THE OWNER REPORTED was three lots of padding stacked: the
          strip's own 8 points below "Next:", the screen's title bar adding the
          design's 6, and the screen's body adding the design's 4. Eighteen points
          of empty colour, and not one of the three wrong on its own. See
          src/ui/journeySpacing.js for the measurements and where they came from. */}
      <InsideJourneyContext.Provider value>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.stage} key={designKey}>
          <Screen
            navigation={navigation}
            route={{
              params: {
                ...params,
                campaignId,
                journeyStep: stepKey,
                // THE ONE CALLBACK THE ELEVEN GET, and it is not a way to move the
                // journey. The first few steps happen entirely on the phone, before
                // the shop has told Fayr anything, and a screen that writes one of
                // those notes has to be able to say "look again". The router then
                // re-derives the step from the record and the notes, exactly as it
                // does on every other arrival. A screen still cannot choose a step.
                onJourneyMoved: () => setTick((n) => n + 1),
              },
            }}
          />
        </View>
      </SafeAreaInsetsContext.Provider>
      </InsideJourneyContext.Provider>
    </View>
  );
}

/**
 * WHERE YOU ARE IN THE CLAIM. Ours, not the design's, drawn above the design's
 * screen and never inside it.
 *
 * The chip and the tracker are ui/stagebits.js, already ported from the design's
 * own progress row, so the parts are the design's even though the strip is not.
 */
function Where({ insets, view, tone }) {
  return (
    <View style={[styles.strip, { paddingTop: insets.top + SPACE.sm }]}>
      <View style={styles.stripTop}>
        <StageChip label={view.where} tone={tone} />
        <Text style={styles.stripShort} numberOfLines={1}>{view.short}</Text>
      </View>
      <StepTracker
        step={view.stepNumber}
        total={view.of}
        tone={tone}
        style={styles.track}
      />
      <Text style={styles.next} numberOfLines={2}>Next: {view.next}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.cream },
  stage: { flex: 1, overflow: 'hidden' },

  strip: {
    backgroundColor: COLOR.creamDeep,
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.sm,
  },
  stripTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  stripShort: {
    flex: 1, fontFamily: FONT.bodySemi, fontSize: 12, color: COLOR.sub,
    textAlign: 'right',
  },
  track: { marginTop: SPACE.sm },
  next: {
    fontFamily: FONT.body, fontSize: 10.5, lineHeight: 15, color: COLOR.sub,
    marginTop: 5,
  },

  missing: {
    fontFamily: FONT.body, fontSize: 15, color: COLOR.sub,
    textAlign: 'center', marginTop: SPACE.xxl, marginHorizontal: SPACE.xl,
  },
  back: {
    marginTop: SPACE.lg, alignSelf: 'center', paddingHorizontal: SPACE.xl,
    paddingVertical: SPACE.md,
  },
  backText: { fontFamily: FONT.bodySemi, fontSize: 14, color: COLOR.ink },
});
