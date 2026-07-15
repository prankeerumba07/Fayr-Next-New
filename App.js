import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/HomeScreen';
import ConnectScreen from './src/ConnectScreen';
import TaskScreen from './src/TaskScreen';
import { PLATFORM_LIST } from './src/platforms';
import { CAMPAIGN } from './src/campaign';
import { load as loadTask } from './src/taskStore';

const Stack = createNativeStackNavigator();

// The campaign is passed ONLY to the marketplace it belongs to. Every other
// platform gets no campaign and therefore fails closed on fetch
// (error:"no_campaign_target") rather than dumping the account's orders - see
// platforms.js. That is deliberate: the demo campaign is Amazon-only.
function makeConnectScreen(platform) {
  const campaign = platform.key === CAMPAIGN.marketplace ? CAMPAIGN : undefined;
  // Forward navigation/route through: ConnectScreen returns to the Task screen
  // once evidence is dispatched, so the fetch result is never a dead end.
  return function Screen(props) {
    return <ConnectScreen {...props} platform={platform} campaign={campaign} />;
  };
}

export default function App() {
  // Restore the persisted task before anything renders, so a relaunch resumes
  // mid-flow instead of flashing a fresh CLAIMED task.
  React.useEffect(() => { loadTask(); }, []);

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
