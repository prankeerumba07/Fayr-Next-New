import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fontMap } from './src/ui/fonts';

import HomeScreen from './src/HomeScreen';
import ConnectScreen from './src/ConnectScreen';
import TaskScreen from './src/TaskScreen';
import DetailScreen from './src/DetailScreen';
import AuthScreen from './src/AuthScreen';
import { PLATFORM_LIST } from './src/platforms';
import { load as loadTask, applyAuthoritative, configureSync } from './src/taskStore';
import * as authSession from './src/backend/authSession';
import * as campaignStore from './src/backend/campaignStore';
import * as evidenceSync from './src/backend/evidenceSync';
import { postEvidence } from './src/backend/tasksApi';

const Stack = createNativeStackNavigator();

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

// A Fayr-account session gates the whole app: the marketplace/task screens are
// unreachable until the user has signed in with their mobile number. This is
// the user's identity WITH THE BACKEND — separate from the marketplace logins
// that happen later inside the WebView. `authState`:
//   'loading' — still reading the keychain (brief splash);
//   'out'     — no valid session → AuthScreen;
//   'in'      — signed in → the existing Home/Task/marketplace stack.
export default function App() {
  const [authState, setAuthState] = React.useState('loading');
  // Gate first paint on the design fonts too, so no screen flashes in a
  // fallback face before Poppins/Alexandria/Inter resolve.
  const [fontsLoaded] = useFonts(fontMap);

  // Subscribe FIRST (so login/logout/dead-refresh all flip the gate on their
  // own), then hydrate the persisted session once at startup.
  React.useEffect(() => {
    const unsub = authSession.subscribe((s) =>
      setAuthState(s && s.accessToken ? 'in' : 'out'),
    );
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
  }, [authState]);

  if (authState === 'loading' || !fontsLoaded) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.splash}>
          <Text style={styles.splashBrand}>fayr</Text>
          <ActivityIndicator size="large" color="#111" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (authState === 'out') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false }}
          />
          {/* Campaign detail owns its own hero + back button, so no nav header. */}
          <Stack.Screen
            name="Detail"
            component={DetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Task"
            component={TaskScreen}
            options={{ title: 'Your task', headerTintColor: '#FF9900' }}
          />
          {PLATFORM_LIST.map((p) => (
            <Stack.Screen
              key={p.key}
              name={p.key}
              component={makeConnectScreen(p)}
              options={{ title: p.name, headerTintColor: p.color }}
            />
          ))}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#fafafa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashBrand: {
    fontSize: 40,
    fontWeight: '800',
    color: '#111',
    letterSpacing: -1,
    marginBottom: 20,
  },
});
