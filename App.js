import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/HomeScreen';
import ConnectScreen from './src/ConnectScreen';
import { PLATFORMS } from './src/platforms';

const Stack = createNativeStackNavigator();

function makeConnectScreen(platformKey) {
  return function Screen() {
    return <ConnectScreen platform={PLATFORMS[platformKey]} />;
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
          <Stack.Screen
            name="flipkart"
            component={makeConnectScreen('flipkart')}
            options={{ title: 'Flipkart', headerTintColor: '#2874F0' }}
          />
          <Stack.Screen
            name="amazon"
            component={makeConnectScreen('amazon')}
            options={{ title: 'Amazon', headerTintColor: '#FF9900' }}
          />
          <Stack.Screen
            name="myntra"
            component={makeConnectScreen('myntra')}
            options={{ title: 'Myntra', headerTintColor: '#FF3F6C' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
