// ONE SCREEN OF THE WALK THROUGH, WITH AN ARROW EITHER SIDE.
//
// The real screen, not a picture of it. Every screen in this app takes `navigation`
// and `route` as plain props and uses no navigation hooks, so a real screen can be
// rendered here with a `navigation` of our own and it is the same component the app
// itself mounts, running the same requests against the same practice data.
//
// The `navigation` given to it swallows every move. That is not the safety net —
// showing.js is, and it refuses every write at the transport whatever a screen
// does. This is so a tap inside a screen cannot walk out of the walk through and
// leave somebody lost in the middle of a demonstration.
//
// Where nothing is built, the design's own words are shown as the design's words,
// under a plain statement that Fayr has no screen for it. Never a mock dressed up
// as working software.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, FONT, RADIUS, SPACE } from '../ui/theme';
import { showTheApp } from '../backend/showing';
import * as campaignStore from '../backend/campaignStore';
import { getTaskId, getTasks, refreshFromBackend } from '../taskStore';
import { PLATFORMS } from '../platforms';
import { WHAT_THIS_IS, pageFor } from './catalogue';

import SplashScreen from '../firstrun/SplashScreen';
import OnboardingScreen from '../firstrun/OnboardingScreen';
import AuthLandingScreen from '../firstrun/AuthLandingScreen';
import PhoneEntryScreen from '../firstrun/PhoneEntryScreen';
import OtpScreen from '../firstrun/OtpScreen';
import SetupFlow from '../setup/SetupFlow';
import HomeScreen from '../HomeScreen';
import DetailScreen from '../DetailScreen';
import {
  ClaimedScreen, JoinFailedScreen, NotEnoughTicketsScreen,
} from '../ClaimOutcomeScreens';
import ProofUploadScreen from '../ProofUploadScreen';
import TaskScreen from '../TaskScreen';
import MyProductsScreen from '../MyProductsScreen';
import EarningsScreen from '../EarningsScreen';
import WalletScreen from '../WalletScreen';
import ProfileScreen from '../ProfileScreen';
import ConnectScreen from '../ConnectScreen';
// The design's own screens, each in its own file under its own key. See
// src/screens/keys.js.
import ForceUpdateScreen from '../screens/forceupdate';
import MaintenanceScreen from '../screens/maintenance';
import TruecallerScreen from '../screens/truecaller';
import NewDeviceScreen from '../screens/newdevice';
import OtpLockedScreen from '../screens/otplocked';
import BlockedScreen from '../screens/blocked';
// The claim journey, eleven screens since 1 September 2026. Before that they were
// eleven pages inside one file, addressed here by the journey's own page names.
// Each is its own component now, so each is its own entry.
import ConfirmScreen from '../screens/confirm';
import LinkAccountScreen from '../screens/linkaccount';
import BuyInterstitialScreen from '../screens/buyinterstitial';
import ProofPrimerScreen from '../screens/proofprimer';
import UnderReviewScreen from '../screens/underreview';
import OcrConfirmScreen from '../screens/ocrconfirm';
import DeliveryScreen from '../screens/delivery';
import ReviewGuideScreen from '../screens/reviewguide';
import ReviewProofScreen from '../screens/reviewproof';
import ReturnWindowScreen from '../screens/returnwindow';
import RewardScreen from '../screens/reward';

/** A sample name for the sign-in screens, which have nobody signed in to read. */
const SAMPLE_NAME = 'Practice account';

/**
 * EVERY REAL SCREEN THE WALK THROUGH CAN OPEN.
 *
 * One key per screen, and catalogue.test.mjs checks this list against the
 * catalogue in both directions: a screen named there and missing here fails, and
 * so does a screen here that nothing opens.
 *
 * Each entry is given `nav` (a navigation that goes nowhere), `at` (the variant
 * the catalogue asked for) and `sample` (a campaign id and a task id from the
 * practice data, or nulls if the practice data is empty).
 */
const KNOWN = {
  Splash: ({ nav }) => <SplashScreen onDone={nav.nowhere} />,
  Onboarding: ({ nav }) => <OnboardingScreen onDone={nav.nowhere} />,
  AuthLanding: ({ nav }) => (
    <AuthLandingScreen onContinue={nav.nowhere} onOpenPolicy={nav.nowhere} />
  ),
  PhoneEntry: ({ nav }) => (
    <PhoneEntryScreen initial="" onBack={nav.nowhere} onSent={nav.nowhere} />
  ),
  Otp: ({ nav }) => (
    <OtpScreen
      mobile="+919000000001"
      resendIn={30}
      onBack={nav.nowhere}
      onVerified={nav.nowhere}
      onSupport={nav.nowhere}
      onLocked={nav.nowhere}
      onBlocked={nav.nowhere}
    />
  ),
  // Five wrong codes, and an account the server has restricted. Screens of their
  // own now, rather than two states hidden inside the code screen.
  OtpLocked: ({ nav }) => (
    <OtpLockedScreen navigation={nav} route={{ params: { secondsLeft: 872 } }} />
  ),
  Blocked: ({ nav }) => <BlockedScreen navigation={nav} route={{ params: {} }} />,
  // Neither of these is on a normal path: nothing checks the app version, and
  // nothing tells a planned outage from a dropped connection.
  ForceUpdate: ({ nav }) => <ForceUpdateScreen navigation={nav} route={{ params: {} }} />,
  Maintenance: ({ nav }) => (
    <MaintenanceScreen navigation={nav} route={{ params: { backBy: '6:00 PM' } }} />
  ),
  NewDevice: ({ nav }) => <NewDeviceScreen navigation={nav} route={{ params: {} }} />,
  // Deliberately given NO name and NO number. The design writes a real person's
  // into this screen; the walk through shows the shape it takes with nobody in it.
  Truecaller: ({ nav }) => <TruecallerScreen navigation={nav} route={{ params: {} }} />,
  // A profile that stops short of the step being shown, so the real screen decides
  // to show it for its own reasons rather than being forced. `startAt` is only
  // needed for building the feed, which the sequence never lands on directly.
  Setup: ({ nav, at }) => (
    <SetupFlow
      startAt={at}
      profile={SETUP_PROFILE[at] || {}}
      onFinished={nav.nowhere}
      onLater={nav.nowhere}
    />
  ),
  Home: ({ nav }) => <HomeScreen navigation={nav} />,
  Detail: ({ nav, sample }) => (
    <DetailScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  Confirm: ({ nav, sample }) => (
    <ConfirmScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  Claimed: ({ nav, sample }) => (
    <ClaimedScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  // The design draws the lost seat and the failed claim as two screens. Fayr has
  // one, and it prints whatever reason the server gave — "Campaign is full" among
  // them — so the two are the same screen with different words in it.
  JoinFailed: ({ nav, sample, at }) => (
    <JoinFailedScreen
      navigation={nav}
      route={{
        params: {
          campaignId: sample.campaignId,
          error: at === 'seat-lost' ? 'Campaign is full' : 'Could not reach Fayr',
        },
      }}
    />
  ),
  NotEnoughTickets: ({ nav, sample }) => (
    <NotEnoughTicketsScreen
      navigation={nav}
      route={{ params: { campaignId: sample.campaignId } }}
    />
  ),
  // THE CLAIM JOURNEY, ONE ENTRY EACH. Until the split these were one entry that
  // asked the journey for a page by name, because eleven design screens shared one
  // component and the walk through had no other way to reach nine of them. Each is
  // its own file now, so each is opened directly — which is also the only way to
  // look at a screen for a step no practice claim happens to be at.
  LinkAccount: ({ nav, sample }) => (
    <LinkAccountScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  BuyInterstitial: ({ nav, sample }) => (
    <BuyInterstitialScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  ProofPrimer: ({ nav, sample }) => (
    <ProofPrimerScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  UnderReview: ({ nav, sample }) => (
    <UnderReviewScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  OcrConfirm: ({ nav, sample }) => (
    <OcrConfirmScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  Delivery: ({ nav, sample }) => (
    <DeliveryScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  ReviewGuide: ({ nav, sample }) => (
    <ReviewGuideScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  ReviewProof: ({ nav, sample }) => (
    <ReviewProofScreen
      navigation={nav}
      route={{ params: { campaignId: sample.campaignId, taskId: sample.taskId } }}
    />
  ),
  ReturnWindow: ({ nav, sample }) => (
    <ReturnWindowScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  ProofUpload: ({ nav, sample, at }) => (
    <ProofUploadScreen
      navigation={nav}
      route={{ params: { taskId: sample.taskId, campaignId: sample.campaignId, kind: at } }}
    />
  ),
  Task: ({ nav, sample }) => (
    <TaskScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  Reward: ({ nav, sample }) => (
    <RewardScreen navigation={nav} route={{ params: { campaignId: sample.campaignId } }} />
  ),
  MyProducts: ({ nav }) => <MyProductsScreen navigation={nav} />,
  Earnings: ({ nav }) => <EarningsScreen navigation={nav} />,
  Wallet: ({ nav }) => <WalletScreen navigation={nav} />,
  Profile: ({ nav }) => <ProfileScreen navigation={nav} />,
  // The on-device reader, on Amazon, which is the marketplace it was built for.
  Connect: ({ nav, sample }) => (
    <ConnectScreen
      navigation={nav}
      platform={PLATFORMS.amazon}
      campaign={sample.campaignId ? campaignStore.getById(sample.campaignId) : undefined}
    />
  ),
};

/**
 * A profile that lands the setting up sequence on each of its screens.
 *
 * Built by leaving out exactly what that screen asks for, so the real screen
 * chooses to show itself. Building the feed is the exception and needs `startAt`,
 * because the sequence only ever arrives there from the name step.
 */
const SETUP_PROFILE = {
  setupintro: {},
  setup: { ageBand: '25-34' },
  namelast: {
    ageBand: '25-34', gender: 'male', categories: ['Footwear', 'Home & Kitchen', 'Electronics & Mobile'], platforms: ['amazon'],
  },
  buildfeed: {
    ageBand: '25-34', gender: 'male', categories: ['Footwear', 'Home & Kitchen', 'Electronics & Mobile'], platforms: ['amazon'], name: SAMPLE_NAME,
  },
  howfayr: {
    ageBand: '25-34', gender: 'male', categories: ['Footwear', 'Home & Kitchen', 'Electronics & Mobile'], platforms: ['amazon'], name: SAMPLE_NAME,
  },
};

export default function OneScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const key = (route && route.params && route.params.key) || null;
  const page = pageFor(key);

  const [sample, setSample] = useState(null);

  // The block stays on for as long as any part of the walk through is on screen.
  // Turned on here as well as on the list, because a screen can be opened straight
  // from a link and the list may never have been mounted.
  useEffect(() => {
    showTheApp(true);
    return () => showTheApp(false);
  }, []);

  // One campaign and one task from the practice data, so the screens that need an
  // id get a real one. Two reads, both GETs, done once for the whole walk.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!campaignStore.isLoaded()) await campaignStore.load();
        await refreshFromBackend();
      } catch (e) { /* an empty practice database is a state, not a failure */ }
      if (!alive) return;
      const campaigns = campaignStore.getAll() || [];
      const withATask = campaigns.find((c) => getTaskId(c.id) != null);
      const chosen = withATask || campaigns[0] || null;
      setSample({
        campaignId: chosen ? chosen.id : null,
        taskId: chosen ? getTaskId(chosen.id) : null,
        howManyTasks: Object.keys(getTasks() || {}).length,
      });
    })();
    return () => { alive = false; };
  }, []);

  // Stable, so a screen with an effect that depends on `navigation` does not loop.
  const nav = useMemo(() => stageNavigation(), []);

  if (page == null) {
    return (
      <Missing
        insets={insets}
        text={`There is no screen called "${String(key)}" in the design.`}
        onBack={() => navigation.goBack()}
      />
    );
  }

  const step = (
    <Chrome
      insets={insets}
      page={page}
      onList={() => navigation.navigate('Walkthrough')}
      onGo={(to) => navigation.setParams({ key: to })}
    />
  );

  if (!page.built) {
    return (
      <View style={styles.screen}>
        {step}
        <NotBuilt key={page.key} page={page} />
      </View>
    );
  }

  const build = KNOWN[page.opens.screen];
  return (
    <View style={styles.screen}>
      {step}
      {/* THE KEY IS LOAD-BEARING, and it fixes a real bug rather than tidying.
          Several design screens share one Fayr screen with a different variant:
          the two code failures are both OtpScreen, the five setting up screens are
          all SetupFlow, the order and delivery pictures are both ProofUpload, and
          six journey pages are one JourneyScreen. Every one of those reads its
          variant into state ONCE, when it mounts. Without a key that changes,
          React sees the same component type either side of a step and keeps the
          instance, so pressing next from "too many wrong codes" to "account
          restricted" would leave the first screen on display with a new label
          above it. Keying on the design's screen key forces a real remount, which
          is what stepping to another screen is. */}
      <View style={styles.stage} key={page.key}>
        {sample == null
          ? <Waiting />
          : build({ nav, at: page.opens.at || null, sample })}
      </View>
    </View>
  );
}

/**
 * A navigation that goes nowhere.
 *
 * Every method a screen in this app calls, answered so that nothing moves and
 * nothing throws. `addListener` calls a focus listener once and then never again,
 * which is what arriving on a screen looks like to the screen — several screens
 * load their data that way and would otherwise sit empty.
 */
function stageNavigation() {
  const nowhere = () => {};
  return {
    nowhere,
    navigate: nowhere,
    push: nowhere,
    replace: nowhere,
    goBack: nowhere,
    popToTop: nowhere,
    pop: nowhere,
    dispatch: nowhere,
    reset: nowhere,
    setOptions: nowhere,
    setParams: nowhere,
    isFocused: () => true,
    canGoBack: () => false,
    getParent: () => undefined,
    getState: () => ({ index: 0, routes: [] }),
    addListener: (event, cb) => {
      if (event === 'focus' && typeof cb === 'function') cb();
      return nowhere;
    },
    removeListener: nowhere,
  };
}

/** The slim bar above the screen: where you are, and the two arrows. */
function Chrome({ insets, page, onList, onGo }) {
  return (
    <View style={[styles.chrome, { paddingTop: insets.top + 6 }]}>
      <View style={styles.chromeTop}>
        <TouchableOpacity
          onPress={() => page.back && onGo(page.back)}
          disabled={!page.back}
          style={[styles.arrow, !page.back && styles.arrowOff]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="The screen before this one"
        >
          <Text style={[styles.arrowText, !page.back && styles.arrowTextOff]}>‹</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.flex} onPress={onList} activeOpacity={0.7}>
          <Text style={styles.chromeTitle} numberOfLines={1}>{page.title}</Text>
          <Text style={styles.chromeWhere} numberOfLines={1}>{page.where}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => page.next && onGo(page.next)}
          disabled={!page.next}
          style={[styles.arrow, !page.next && styles.arrowOff]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="The next screen"
        >
          <Text style={[styles.arrowText, !page.next && styles.arrowTextOff]}>›</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.chromeNote} numberOfLines={2}>{WHAT_THIS_IS}</Text>
    </View>
  );
}

/** A screen the design has and Fayr does not. The design's words, and why not. */
function NotBuilt({ page }) {
  const words = page.designWords;
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.notBuiltBody}>
      <View style={styles.stamp}>
        <Text style={styles.stampText}>NOT BUILT YET</Text>
      </View>
      <Text style={styles.notBuiltLead}>
        The design has this screen. Fayr has nothing behind it, so what follows is
        the design's own wording and not a working screen.
      </Text>

      <View style={styles.quote}>
        <Text style={styles.quoteFrom}>THE DESIGN'S OWN WORDS</Text>
        <Text style={styles.quoteHead}>{words.heading}</Text>
        <Text style={styles.quoteBody}>{words.body}</Text>
        {words.buttons.length > 0 ? (
          <View style={styles.quoteButtons}>
            {words.buttons.map((b) => (
              <View key={b} style={styles.deadButton}>
                <Text style={styles.deadButtonText}>{b}</Text>
              </View>
            ))}
            <Text style={styles.deadNote}>
              Drawn as the design draws them, and they do nothing.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.why}>
        <Text style={styles.whyTitle}>Why there is nothing here</Text>
        <Text style={styles.whyBody}>{page.whyNot}</Text>
      </View>
    </ScrollView>
  );
}

function Waiting() {
  return (
    <View style={styles.waiting}>
      <ActivityIndicator color={COLOR.ink} />
      <Text style={styles.waitingText}>Reading the practice information…</Text>
    </View>
  );
}

function Missing({ insets, text, onBack }) {
  return (
    <View style={[styles.screen, styles.waiting, { paddingTop: insets.top + 20 }]}>
      <Text style={styles.waitingText}>{text}</Text>
      <TouchableOpacity onPress={onBack} style={styles.missingBack}>
        <Text style={styles.missingBackText}>Back to the list</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLOR.homeBg },
  flex: { flex: 1 },
  stage: { flex: 1, overflow: 'hidden' },

  chrome: {
    backgroundColor: COLOR.ink,
    paddingHorizontal: SPACE.sm,
    paddingBottom: SPACE.sm,
  },
  chromeTop: { flexDirection: 'row', alignItems: 'center' },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  arrowOff: { opacity: 0.28 },
  arrowText: { fontFamily: FONT.display, fontSize: 28, color: '#fff', lineHeight: 32 },
  arrowTextOff: { color: '#fff' },
  chromeTitle: { fontFamily: FONT.displaySemi, fontSize: 14, color: '#fff', textAlign: 'center' },
  chromeWhere: {
    fontFamily: FONT.body,
    fontSize: 10.5,
    color: 'rgba(255,255,255,.72)',
    textAlign: 'center',
    marginTop: 1,
  },
  chromeNote: {
    fontFamily: FONT.body,
    fontSize: 9.5,
    lineHeight: 13,
    color: 'rgba(255,255,255,.6)',
    paddingHorizontal: SPACE.sm,
    marginTop: 4,
  },

  notBuiltBody: { padding: SPACE.lg, paddingBottom: 40 },
  stamp: {
    alignSelf: 'flex-start',
    backgroundColor: COLOR.amberBg,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: COLOR.amberLine,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  stampText: { fontFamily: FONT.bodyBold, fontSize: 10.5, letterSpacing: 1, color: '#8A5A00' },
  notBuiltLead: {
    fontFamily: FONT.bodyMed,
    fontSize: 13,
    lineHeight: 20,
    color: COLOR.ink2,
    marginTop: SPACE.md,
  },

  quote: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.lg,
    borderLeftWidth: 4,
    borderLeftColor: COLOR.goldDeep,
    padding: SPACE.lg,
    marginTop: SPACE.lg,
  },
  quoteFrom: {
    fontFamily: FONT.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1,
    color: COLOR.sub,
    marginBottom: SPACE.sm,
  },
  quoteHead: { fontFamily: FONT.display, fontSize: 19, color: COLOR.ink, lineHeight: 26 },
  quoteBody: {
    fontFamily: FONT.body,
    fontSize: 13,
    lineHeight: 21,
    color: COLOR.sub,
    marginTop: SPACE.sm,
  },
  quoteButtons: { marginTop: SPACE.lg },
  deadButton: {
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLOR.line,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  deadButtonText: { fontFamily: FONT.displaySemi, fontSize: 12.5, color: '#A5A597' },
  deadNote: { fontFamily: FONT.body, fontSize: 11, color: COLOR.sub, marginTop: 2 },

  why: {
    backgroundColor: COLOR.creamDeep,
    borderRadius: RADIUS.lg,
    padding: SPACE.lg,
    marginTop: SPACE.lg,
  },
  whyTitle: { fontFamily: FONT.displaySemi, fontSize: 13.5, color: COLOR.ink },
  whyBody: {
    fontFamily: FONT.body,
    fontSize: 12.5,
    lineHeight: 20,
    color: COLOR.ink2,
    marginTop: 6,
  },

  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },
  waitingText: {
    fontFamily: FONT.bodyMed,
    fontSize: 13,
    color: COLOR.sub,
    marginTop: SPACE.md,
    textAlign: 'center',
  },
  missingBack: { marginTop: SPACE.lg },
  missingBackText: { fontFamily: FONT.bodySemi, fontSize: 13.5, color: COLOR.ink },
});
