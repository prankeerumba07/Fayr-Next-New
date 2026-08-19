import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
import PolicyScreen from './src/PolicyScreen';
import FirstRunFlow from './src/firstrun/FirstRunFlow';
import SetupFlow from './src/setup/SetupFlow';
import MyProductsScreen from './src/MyProductsScreen';
import EarningsScreen from './src/EarningsScreen';
import ProfileScreen from './src/ProfileScreen';
import ProofUploadScreen from './src/ProofUploadScreen';
import BottomNav from './src/ui/BottomNav';
import { PLATFORM_LIST } from './src/platforms';
import { goHome } from './src/ui/nav';
import { COLOR, FONT } from './src/ui/theme';
import { load as loadTask, applyAuthoritative, configureSync } from './src/taskStore';
import * as authSession from './src/backend/authSession';
import * as campaignStore from './src/backend/campaignStore';
import * as evidenceSync from './src/backend/evidenceSync';
import { getProfile } from './src/backend/meApi';
import { isSetupNeeded } from './src/ui/setup';
import { postEvidence } from './src/backend/tasksApi';

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
function makeConnectScreen(platform) {
  return function Screen(props) {
    const campaignId =
      props.route && props.route.params && props.route.params.campaignId;
    const campaign =
      (campaignId && campaignStore.getById(campaignId)) ||
      campaignStore.forMarketplace(platform.key) ||
      undefined;
    return <ConnectScreen {...props} platform={platform} campaign={campaign} />;
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
export default function App() {
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
      }
    });
    authSession.hydrate();
    return unsub;
  }, []);

  // Once signed in: wire the evidence transport BEFORE anything can dispatch,
  // load the backend campaigns, and restore/refresh tasks from the source of
  // truth so a relaunch resumes mid-flow instead of flashing a fresh task.
  React.useEffect(() => {
    if (authState !== 'in') return;
    evidenceSync.configure({ send: postEvidence, onApplied: applyAuthoritative });
    configureSync(evidenceSync.syncEvidence);
    evidenceSync.start();
    campaignStore.load();
    loadTask();

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
          {/* Help and the policy documents own their headers as well. */}
          <Stack.Screen name="Support" component={SupportScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Policy" component={PolicyScreen} options={{ headerShown: false }} />
          {/* Screenshot proof — the tier-3 fallback when the scraper can't read. */}
          <Stack.Screen name="ProofUpload" component={ProofUploadScreen} options={{ headerShown: false }} />
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
