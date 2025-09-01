import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Button, SafeAreaView, Text, View } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';

export type RootStackParamList = {
  Home: undefined;
  Dashboard?: undefined;
  Scan?: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'HSA Vault' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
