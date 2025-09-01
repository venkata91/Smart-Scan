import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Button, Text, View, Platform } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import { useGoogleAuth } from './src/hooks/useGoogleAuth';
import { btn as webBtn } from './src/web/ui';

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
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: 'Smart Scan',
            headerRight: () => <HeaderAuthButtons />,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function HeaderAuthButtons() {
  const { accessToken, userEmail, signIn, signOut } = useGoogleAuth();
  if (Platform.OS === 'web') {
    // @ts-ignore web buttons
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {accessToken ? (
          <>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              {userEmail ? `Signed in as ${userEmail}` : 'Signed in'}
            </span>
            <button style={webBtn('neutral','sm')} onClick={() => signOut()}>Sign out</button>
          </>
        ) : (
          <button style={webBtn('primary','sm')} onClick={() => signIn()}>Sign in</button>
        )}
      </div>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {accessToken ? (
        <>
          <Text style={{ fontSize: 12, opacity: 0.8 }}>
            {userEmail ? `Signed in as ${userEmail}` : 'Signed in'}
          </Text>
          <Button title="Sign out" onPress={() => signOut()} />
        </>
      ) : (
        <Button title="Sign in" onPress={() => signIn()} />
      )}
    </View>
  );
}
