import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Button, SafeAreaView, Text, View } from 'react-native';
import CaptureScreen from './src/screens/CaptureScreen';
import SignInScreen from './src/screens/SignInScreen';
import DashboardScreen from './src/screens/DashboardScreen';

export type RootStackParamList = {
  SignIn: undefined;
  Scan: undefined;
  Dashboard: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="SignIn">
        <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Sign In' }} />
        <Stack.Screen name="Scan" component={CaptureScreen} options={{ title: 'Scan Receipts' }} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
