import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from '../utils/secureStore';
import * as AuthSession from 'expo-auth-session';
import { useAuthRequest, DiscoveryDocument } from 'expo-auth-session';
import { useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';

WebBrowser.maybeCompleteAuthSession();

const discovery: DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const EXTRA = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

export function useGoogleAuth() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);

  const clientId = EXTRA.GOOGLE_EXPO_CLIENT_ID || EXTRA.GOOGLE_WEB_CLIENT_ID;

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId,
      scopes: SCOPES,
      redirectUri: AuthSession.makeRedirectUri({ useProxy: true }),
    },
    discovery
  );

  useEffect(() => {
    (async () => {
      const stored = await SecureStore.getItemAsync('google_token');
      if (stored) {
        const { accessToken: at, refreshToken: rt } = JSON.parse(stored);
        setAccessToken(at);
        setRefreshToken(rt);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (response?.type === 'success') {
        const { authentication } = response;
        if (authentication?.accessToken) {
          setAccessToken(authentication.accessToken);
          await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: authentication.accessToken, refreshToken: authentication.refreshToken }));
        }
      }
    })();
  }, [response]);

  const signIn = async () => {
    await promptAsync({ useProxy: true });
  };

  const signOut = async () => {
    setAccessToken(null);
    setRefreshToken(null);
    await SecureStore.deleteItemAsync('google_token');
  };

  return { request, accessToken, refreshToken, signIn, signOut };
}
