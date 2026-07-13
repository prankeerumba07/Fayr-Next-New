import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/HomeScreen';
import ConnectScreen from './src/ConnectScreen';
import { PLATFORM_LIST } from './src/platforms';

const Stack = createNativeStackNavigator();

function makeConnectScreen(platform) {
  return function Screen() {
    return <ConnectScreen platform={platform} />;
  };
}

export default function App() {
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
