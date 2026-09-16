import React from 'react';
import { AppState, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fontMap } from './src/ui/fonts';

import HomeScreen from './src/HomeScreen';
import ConnectScreen from './src/ConnectScreen';
import TaskScreen from './src/TaskScreen';
import DetailScreen from './src/DetailScreen';
import WalletScreen from './src/WalletScreen';
import SupportScreen from './src/SupportScreen';
import ChatScreen from './src/ChatScreen';
import JourneyScreen from './src/journey/JourneyScreen';
import LiveCheckScreen from './src/LiveCheckScreen';
// The automatic look at the shop's own list of orders, after somebody says they
// bought it. Two screens, neither of them a design screen: the design's own
// BuildFeed and OcrConfirm are what each is drawn from, and src/screens is only
// for the design's sixty one.
import LookingForItScreen from './src/order/LookingForItScreen';
import LookingForReviewScreen from './src/order/LookingForReviewScreen';
import IsThisYourOrderScreen from './src/order/IsThisYourOrderScreen';
// Every design screen is looked up by its own key in one place. See
// src/screens/keys.js for which screens have their own file, and
// src/screens/keys.test.mjs, which checks that against the design itself.
import { SCREENS as DESIGN_SCREENS } from './src/screens';
import WalkthroughScreen from './src/walkthrough/WalkthroughScreen';
import WalkthroughOneScreen from './src/walkthrough/OneScreen';
import PolicyScreen from './src/PolicyScreen';
import FirstRunFlow from './src/firstrun/FirstRunFlow';
import SetupFlow from './src/setup/SetupFlow';
import MyProductsScreen from './src/MyProductsScreen';
import EarningsScreen from './src/EarningsScreen';
import ProfileScreen from './src/ProfileScreen';
import ProofUploadScreen from './src/ProofUploadScreen';
import {
  ClaimedScreen, NotEnoughTicketsScreen, JoinFailedScreen,
} from './src/ClaimOutcomeScreens';
import BottomNav from './src/ui/BottomNav';
import ErrorBoundary from './src/ErrorBoundary';
import ErrorFallback from './src/ErrorFallback';
import { PLATFORM_LIST } from './src/platforms';
import { shopHandedToConnectScreen } from './src/signin';
import { goHome } from './src/ui/nav';
import { COLOR, FONT } from './src/ui/theme';
import {
  load as loadTask, applyAuthoritative, configureSync, configureOutbox,
  refreshFromBackend,
} from './src/taskStore';
import { shouldRefreshOnForeground } from './src/foregroundRefresh';
import * as connectedShops from './src/backend/connectedShops';
import * as authSession from './src/backend/authSession';
import * as campaignStore from './src/backend/campaignStore';
import * as evidenceSync from './src/backend/evidenceSync';
import { getProfile } from './src/backend/meApi';
import { isSetupNeeded } from './src/ui/setup';
import { postEvidence } from './src/backend/tasksApi';
import { renewNow } from './src/backend/http';
import { startKeeper } from './src/backend/sessionKeeper';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

// The four tabs from the design's BottomNav, in the design's order. They are the
// app's ROOT: everything else (a task, the wallet, help, a marketplace WebView)
// pushes on top of them, so the bar is present exactly where the design shows it
// and absent on the screens the design draws without it.
function TabsRoot() {
  return (
    <Tabs.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomNav {...props} />}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="MyProducts" component={MyProductsScreen} />
      <Tabs.Screen name="Earnings" component={EarningsScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

// Resolve the campaign for THIS navigation from the backend-loaded store: the
// specific one passed in route params (Task screen → marketplace), else the
// platform's active campaign. A marketplace with no campaign gets undefined and
// therefore fails closed on fetch (no name/id target → no order surfaced) —
// exactly the frozen ConnectScreen's existing behaviour. ConnectScreen still
// only reads the `campaign` prop, so it stays byte-for-byte untouched.
//
// AND WHICH PAGE OF THE SHOP IT OPENS, added 2 September 2026. The owner found
// that tapping "connect my Amazon account" dropped him on Amazon's shopping page
// with no sign in anywhere on it. A visit made to SIGN IN now lands on the shop's
// own sign in; a visit made to READ somebody's orders keeps the page it needs.
// The whole decision is one function, src/signin.js, and the check calls that
// same function, so an address nothing reads cannot pass again.
function makeConnectScreen(platform) {
  return function Screen(props) {
    const params = (props.route && props.route.params) || undefined;
    const campaignId = params && params.campaignId;
    const campaign =
      (campaignId && campaignStore.getById(campaignId)) ||
      campaignStore.forMarketplace(platform.key) ||
      undefined;
    const shop = shopHandedToConnectScreen(platform.key, params) || platform;
    return <ConnectScreen {...props} platform={shop} campaign={campaign} />;
  };
}

// A guaranteed one-tap exit out of a marketplace, in the native header — the
// place a WebView can never cover or swallow.
//
// Reported live: after logging out of Amazon inside Connect Marketplaces there
// was no way back to Home and the app had to be force-quit. Two separate things
// make that possible, and this closes the second:
//   1. the back arrow can only step back ONE screen, and the screen underneath a
//      marketplace is often another marketplace-ish dead end (Home → Amazon →
//      Task → back lands you inside Amazon's website again);
//   2. there was exactly ONE way out, so anything wrong with it left no way out.
// The default back arrow is deliberately KEPT — this sits beside it, so a normal
// step-back still works and there is always a second, unconditional exit.
function MarketplaceHomeButton({ navigation }) {
  return (
    <TouchableOpacity
      onPress={() => goHome(navigation)}
      style={styles.headerExit}
      activeOpacity={0.7}
      // Generous target: this is the control someone reaches for when they feel
      // stuck, which is the worst moment to miss a small tap area.
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel="Back to Fayr home"
    >
      <Text style={styles.headerExitText}>Fayr home</Text>
    </TouchableOpacity>
  );
}

// A Fayr-account session gates the whole app: the marketplace/task screens are
// unreachable until the user has signed in with their mobile number. This is
// the user's identity WITH THE BACKEND — separate from the marketplace logins
// that happen later inside the WebView. `authState`:
//   'loading' — still reading the keychain (brief splash);
//   'out'     — no valid session → the first-run journey;
//   'in'      — signed in → the existing Home/Task/marketplace stack.
function AppInner() {
  const [authState, setAuthState] = React.useState('loading');
  // The setup sequence runs ONCE, between verifying the code and the feed. Before
  // this, verifying dropped the user straight onto the campaign list and the whole
  // journey in the design was never reached.
  //
  // `profile` is null while GET /me is in flight and again after a sign-out.
  // `setupState`: 'unknown' — not asked yet; 'needed' — run it; 'done' — the app.
  const [profile, setProfile] = React.useState(null);
  const [setupState, setSetupState] = React.useState('unknown');
  // Gate first paint on the design fonts too, so no screen flashes in a
  // fallback face before Poppins/Alexandria/Inter resolve.
  const [fontsLoaded] = useFonts(fontMap);

  // Subscribe FIRST (so login/logout/dead-refresh all flip the gate on their
  // own), then hydrate the persisted session once at startup.
  React.useEffect(() => {
    const unsub = authSession.subscribe((s) => {
      const signedIn = !!(s && s.accessToken);
      setAuthState(signedIn ? 'in' : 'out');
      // Forget the profile on sign-out, so the next user is never gated by the
      // previous one's answers.
      if (!signedIn) {
        setProfile(null);
        setSetupState('unknown');
        // AND WHICH SHOPS WERE CONNECTED, for the same reason and a sharper one.
        // That list decides whether the app walks somebody through a shop sign
        // in. Leaving one person's list in place would tell the next person they
        // are already signed in at Amazon, drop them into a shop they have no
        // account on, and skip the one step that could have fixed it.
        connectedShops.forget();
      }
    });
    authSession.hydrate();
    return unsub;
  }, []);

  // KEEP THE SIGN-IN ALIVE, QUIETLY.
  //
  // The tokens already survive the app being closed — they are in the device
  // keychain and are read back above. What this adds is renewing BEFORE anything
  // is refused. Without it, somebody who left the app open over lunch came back,
  // tapped something, and waited through one failed request before it worked.
  //
  // Also on the way back to the foreground: a phone asleep in a pocket does not
  // run timers, so the scheduled renewal may be hours overdue by the time the
  // screen comes on.
  //
  // Only pressing log out ends a session. Nothing here can end one: a renewal
  // that genuinely cannot be done clears the session inside the transport, and
  // the gate above is watching for exactly that.
  React.useEffect(() => {
    if (authState !== 'in') return;
    const keeper = startKeeper({
      getToken: () => authSession.getAccessToken(),
      renew: renewNow,
    });
    // AND ON COMING BACK, ASK OUR OWN SIDE WHAT CHANGED WHILE THEY WERE AWAY.
    //
    // Everything a person does at Amazon happens where Fayr cannot see it. They
    // leave, they buy, they come back — and nothing used to ask, so the screens
    // showed whatever was true when the app last started.
    //
    // WHETHER to act on an "active" is decided in src/foregroundRefresh.js, not
    // here, because iOS says "active" for the notification shade, the app
    // switcher and a dismissed call as readily as for somebody walking back from
    // a shop. That decision is walked under node against all of them.
    //
    // This effect only exists while authState is 'in', so the signed-in test
    // below is the second of two rather than the only one. It is written out
    // anyway: this handler outlives a sign-out by however long the teardown
    // takes, and a fetch with no session is not merely wasted — the transport
    // treats the refusal as a reason to renew, and a renewal with nothing to
    // renew clears the session.
    let askedAt = null;
    const watcher = AppState.addEventListener('change', (next) => {
      if (next === 'active') void keeper.checkNow();
      const now = Date.now();
      if (shouldRefreshOnForeground({
        nextState: next, signedIn: authSession.isAuthed(), lastAt: askedAt, now,
      })) {
        askedAt = now;
        void refreshFromBackend();
        // AND OUR RECORD OF WHICH SHOPS THEY ARE SIGNED IN AT. They may have
        // signed in at one while they were away, on the shop's own app, and this
        // is the moment we can find out without asking the shop anything.
        void connectedShops.load();
      }
    });
    return () => {
      watcher.remove();
      keeper.stop();
    };
  }, [authState]);

  // Once signed in: wire the evidence transport BEFORE anything can dispatch,
  // load the backend campaigns, and restore/refresh tasks from the source of
  // truth so a relaunch resumes mid-flow instead of flashing a fresh task.
  React.useEffect(() => {
    if (authState !== 'in') return;
    evidenceSync.configure({ send: postEvidence, onApplied: applyAuthoritative });
    configureSync(evidenceSync.syncEvidence);
    // AND THE STORE CAN NOW ASK WHAT IS STILL WAITING. Without this the store
    // forgets nothing at all, so a claim the server no longer has would stay
    // believed on the phone for ever. src/forgotten.test.mjs reads this
    // file off disk and checks the wire is here.
    configureOutbox(evidenceSync.pendingTaskIds);
    // AND THE CONNECTED-SHOPS STORE IS HANDED ITS READER, for the same reason the
    // two above are: that store must be walkable under node, so it imports
    // nothing and is given what it needs.
    connectedShops.configure(getProfile);
    evidenceSync.start();
    campaignStore.load();
    loadTask();
    // WHICH SHOPS THEY ARE ALREADY SIGNED IN AT, from our own record.
    //
    // Read here, at the same moment as the campaigns and the tasks, because the
    // journey's gate needs it before it decides whether to walk somebody through
    // a sign in they do not need — and asking a shop for its sign in page when
    // they are already signed in is what gets Fayr taken for a robot.
    connectedShops.load();

    // Ask the SERVER whether setup is needed. Deriving it from the server's
    // setupDoneAt latch — rather than anything on the device — is what stops a
    // returning user ever seeing onboarding again, on any device.
    let alive = true;
    getProfile().then((res) => {
      if (!alive) return;
      if (!res.ok) {
        // Could not ask. Do NOT show setup on a guess: a wrongly-repeated setup is
        // worse than a delayed one, and the next launch will ask again.
        setSetupState('done');
        return;
      }
      setProfile(res.profile);
      setSetupState(isSetupNeeded(res.profile) ? 'needed' : 'done');
    });
    return () => { alive = false; };
  }, [authState]);

  // Before a session exists the app runs the design's first-run journey —
  // Splash → Onboarding → AuthLanding → PhoneEntry → Otp. The splash IS the
  // session-restore wait, so there is no separate grey loading screen any more;
  // `sessionRestoring` keeps it on screen until the keychain read finishes,
  // which stops a signed-in user seeing a flash of sign-in.
  //
  // Fonts still gate the very first paint, because the splash is typography.
  if (authState !== 'in') {
    if (!fontsLoaded) {
      return (
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <View style={styles.splash} />
        </SafeAreaProvider>
      );
    }
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <FirstRunFlow sessionRestoring={authState === 'loading'} />
      </SafeAreaProvider>
    );
  }

  if (!fontsLoaded || setupState === 'unknown') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.splash} />
      </SafeAreaProvider>
    );
  }

  // Setup owns the whole screen while it runs: it is a sequence, not a tab, and the
  // design draws it without the bottom bar. "Do this later" leaves for the app with
  // every answer already saved, so it resumes on the next launch.
  if (setupState === 'needed') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SetupFlow
          profile={profile}
          onFinished={(saved) => { setProfile(saved); setSetupState('done'); }}
          onLater={() => setSetupState('done')}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator>
          <Stack.Screen
            name="Tabs"
            component={TabsRoot}
            options={{ headerShown: false }}
          />
          {/* Campaign detail owns its own hero + back button, so no nav header. */}
          <Stack.Screen
            name="Detail"
            component={DetailScreen}
            options={{ headerShown: false }}
          />
          {/* One of three outcomes after a claim. Each owns its own chrome, exactly
              as the design draws them.

              THE CONFIRMATION PAGE THAT USED TO OPEN BEFORE THESE IS GONE. The
              owner ordered it removed on 2 September 2026: the claim happens on
              the product page now, where the terms tick box is, so a page asking
              somebody to confirm what they had just confirmed was one tap that
              added nothing. The file, the key and this route were all deleted.
              See src/screens/keys.js, where the removal is recorded by name. */}
          <Stack.Screen name="Claimed" component={ClaimedScreen} options={{ headerShown: false }} />
          <Stack.Screen name="NotEnoughTickets" component={NotEnoughTicketsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="JoinFailed" component={JoinFailedScreen} options={{ headerShown: false }} />
          {/* Help and the policy documents own their headers as well. */}
          <Stack.Screen name="Support" component={SupportScreen} options={{ headerShown: false }} />
          {/* The claim journey: one page per step, from joining to the refund.
              Owns its own header, because every page in it does. */}
          <Stack.Screen name="Journey" component={JourneyScreen} options={{ headerShown: false }} />

          {/* "Chat with us" — the fast answer. Owns its header too. */}
          <Stack.Screen name="Chat" component={ChatScreen} options={{ headerShown: false }} />
          {/* The morning job. Staff only, and it asks for a staff sign-in itself. */}
          <Stack.Screen name="LiveCheck" component={LiveCheckScreen} options={{ headerShown: false }} />
          <Stack.Screen name="LookingForIt" component={LookingForItScreen} options={{ headerShown: false }} />
          <Stack.Screen name="LookingForReview" component={LookingForReviewScreen} options={{ headerShown: false }} />
          <Stack.Screen name="IsThisYourOrder" component={IsThisYourOrderScreen} options={{ headerShown: false }} />
          {/* The walk through: every screen in the design, reachable by tapping.
              Beside the offer page check because it is the same audience — the
              team, not shoppers — and both own their own headers. Nothing in it
              writes: see src/backend/showing.js. */}
          {/* The design's own screens, registered under the design's own keys.
              Two so far: the version wall and the planned outage. Neither is on
              a normal path yet, because nothing checks the version and nothing
              tells a planned outage from a dropped connection. They exist,
              under their own names, so the day those checks arrive they have
              somewhere to send people. */}
          <Stack.Screen name="forceupdate" component={DESIGN_SCREENS.forceupdate} options={{ headerShown: false }} />
          <Stack.Screen name="maintenance" component={DESIGN_SCREENS.maintenance} options={{ headerShown: false }} />
          {/* THE CLAIM JOURNEY, SCREEN BY SCREEN. Nine design screens that used to
              be nine pages inside src/journey/JourneyScreen.js. They are normally
              reached by walking a claim, which is what the Journey router above
              does: it works out from the server's record which of these a person is
              on and renders it. They are registered here as well so each can be
              opened directly — by a link, by the walk through, or by another screen
              with a reason to send somebody straight to one. One component, one
              file, one key, two ways in. */}
          <Stack.Screen name="linkaccount" component={DESIGN_SCREENS.linkaccount} options={{ headerShown: false }} />
          <Stack.Screen name="buyinterstitial" component={DESIGN_SCREENS.buyinterstitial} options={{ headerShown: false }} />
          <Stack.Screen name="proofprimer" component={DESIGN_SCREENS.proofprimer} options={{ headerShown: false }} />
          <Stack.Screen name="underreview" component={DESIGN_SCREENS.underreview} options={{ headerShown: false }} />
          <Stack.Screen name="ocrconfirm" component={DESIGN_SCREENS.ocrconfirm} options={{ headerShown: false }} />
          <Stack.Screen name="delivery" component={DESIGN_SCREENS.delivery} options={{ headerShown: false }} />
          <Stack.Screen name="reviewguide" component={DESIGN_SCREENS.reviewguide} options={{ headerShown: false }} />
          <Stack.Screen name="reviewproof" component={DESIGN_SCREENS.reviewproof} options={{ headerShown: false }} />
          <Stack.Screen name="returnwindow" component={DESIGN_SCREENS.returnwindow} options={{ headerShown: false }} />
          {/* THE FIVE THE BUYING JOURNEY WAS MISSING. "Did you buy it?" is a step
              of the journey now. The inbox pair is drawn as the design draws it and
              says on the screen that Fayr has nowhere to connect an inbox to yet.
              The other two are the moments after something lands: the refund being
              tracked, and the pictures arriving. */}
          <Stack.Screen name="returncatch" component={DESIGN_SCREENS.returncatch} options={{ headerShown: false }} />
          <Stack.Screen name="emailconnect" component={DESIGN_SCREENS.emailconnect} options={{ headerShown: false }} />
          <Stack.Screen name="emailcode" component={DESIGN_SCREENS.emailcode} options={{ headerShown: false }} />
          <Stack.Screen name="orderverified" component={DESIGN_SCREENS.orderverified} options={{ headerShown: false }} />
          <Stack.Screen name="imagesuploaded" component={DESIGN_SCREENS.imagesuploaded} options={{ headerShown: false }} />
          <Stack.Screen name="Walkthrough" component={WalkthroughScreen} options={{ headerShown: false }} />
          <Stack.Screen name="OneScreen" component={WalkthroughOneScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Policy" component={PolicyScreen} options={{ headerShown: false }} />
          {/* Screenshot proof — the tier-3 fallback when the scraper can't read. */}
          <Stack.Screen name="ProofUpload" component={ProofUploadScreen} options={{ headerShown: false }} />
          {/* The payoff. Reached only on a CONFIRMED transition to refunded (see
              TaskScreen), never by opening a task that is already paid.
              "reward" is the design's own key for it. */}
          <Stack.Screen name="reward" component={DESIGN_SCREENS.reward} options={{ headerShown: false }} />
          {/* The wallet owns its own gradient header and back button too. */}
          <Stack.Screen
            name="Wallet"
            component={WalletScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Task"
            component={TaskScreen}
            // Task status owns its own gradient header and back button, so the
            // navigator's bar would be a second, competing header.
            options={{ headerShown: false }}
          />
          {PLATFORM_LIST.map((p) => (
            <Stack.Screen
              key={p.key}
              name={p.key}
              component={makeConnectScreen(p)}
              options={({ navigation }) => ({
                title: p.name,
                headerTintColor: p.color,
                // "‹ Fayr", not "‹ Back": inside a marketplace's own website the
                // user needs to know which app the arrow leaves TO.
                headerBackTitle: 'Fayr',
                headerRight: () => <MarketplaceHomeButton navigation={navigation} />,
              })}
            />
          ))}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

// The app, with a floor under it.
//
// This wrapper is the whole of the default export, and that is the point: every
// branch AppInner can take — the splash, the first-run sign-in journey, the setup
// sequence, and the signed-in navigator — is a separate early return, so a
// boundary placed inside the navigator would have guarded only the last of them.
// The sign-in journey is the first thing anyone sees, and it was the part left
// uncovered. Wrapping the component that CHOOSES the branch covers all four.
//
// A caught error therefore rebuilds the app from the top. That costs a moment
// while the keychain session re-hydrates and the campaigns reload, and it buys
// a guarantee: whatever broke, the user lands somewhere the app knows how to be.
export default function App() {
  return (
    <ErrorBoundary
      renderFallback={({ reset }) => <ErrorFallback onReset={reset} />}
    >
      <AppInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  headerExit: { paddingVertical: 6, paddingHorizontal: 4 },
  headerExitText: { fontFamily: FONT.displaySemi, fontSize: 14.5, color: COLOR.ink },
  splash: {
    flex: 1,
    backgroundColor: '#fafafa',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
