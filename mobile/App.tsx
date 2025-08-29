import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Button, SafeAreaView, Text, View } from 'react-native';
import CaptureScreen from './src/screens/CaptureScreen';
import ReceiptsScreen from './src/screens/ReceiptsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

export type RootStackParamList = {
  Capture: undefined;
  Receipts: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Capture" component={CaptureScreen} />
        <Stack.Screen name="Receipts" component={ReceiptsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

