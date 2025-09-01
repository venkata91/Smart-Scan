import React, { useEffect } from 'react';
import { Button, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation }: Props) {
  const { accessToken, signIn } = useGoogleAuth();

  useEffect(() => {
    if (accessToken) {
      navigation.replace('Scan');
    }
  }, [accessToken, navigation]);

  return (
    <View style={{ flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 18, marginBottom: 16 }}>Sign in to your Google account</Text>
      <Button title="Sign in with Google" onPress={async () => {
        const token = await signIn();
        if (token) navigation.replace('Scan');
      }} />
    </View>
  );
}

