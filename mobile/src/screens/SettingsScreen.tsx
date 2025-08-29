import React from 'react';
import { Button, View, Text } from 'react-native';
import { useGoogleAuth } from '../hooks/useGoogleAuth';

export default function SettingsScreen() {
  const { accessToken, signIn, signOut } = useGoogleAuth();

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ marginBottom: 12 }}>Google Account</Text>
      {!accessToken ? (
        <Button title="Sign in" onPress={signIn} />
      ) : (
        <>
          <Text selectable style={{ marginBottom: 12 }}>Signed in. Token present.</Text>
          <Button title="Sign out" onPress={signOut} />
        </>
      )}
    </View>
  );
}

