import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from '../utils/secureStore';
import * as AuthSession from 'expo-auth-session';
import { useAuthRequest, DiscoveryDocument } from 'expo-auth-session';
import { useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Choose the proper client per platform
  const clientId = Platform.OS === 'web'
    ? EXTRA.GOOGLE_WEB_CLIENT_ID
    : (EXTRA.GOOGLE_EXPO_CLIENT_ID || EXTRA.GOOGLE_IOS_CLIENT_ID || EXTRA.GOOGLE_ANDROID_CLIENT_ID);

  // Web: use implicit flow (token) without proxy; Native: use code + proxy
  const isWeb = Platform.OS === 'web';
  const useProxy = !isWeb;
  const redirectUri = AuthSession.makeRedirectUri({ useProxy });
  const responseType = isWeb ? (AuthSession as any).ResponseType?.Token ?? 'token' : (AuthSession as any).ResponseType?.Code ?? 'code';

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId,
      scopes: SCOPES,
      redirectUri,
      usePKCE: !isWeb, // disable PKCE on web when using implicit flow
      responseType: responseType as any,
      extraParams: isWeb
        ? {
            // Web implicit flow: do NOT include access_type
            prompt: 'consent select_account',
          }
        : {
            // Native code flow: allow offline for refresh tokens
            prompt: 'consent select_account',
            access_type: 'offline',
          },
    },
    discovery
  );

  useEffect(() => {
    (async () => {
      const stored = await SecureStore.getItemAsync('google_token');
      if (stored) {
        const { accessToken: at, refreshToken: rt, email } = JSON.parse(stored);
        setAccessToken(at);
        setRefreshToken(rt);
        setUserEmail(email ?? null);
      }
    })();
  }, []);

  // Handle token exchange if needed (PKCE code flow)
  useEffect(() => {
    (async () => {
      if (response?.type === 'success') {
        // Expo sometimes provides authentication directly (proxy/native). If not, exchange the code.
        const code = (response as any)?.params?.code;
        const auth = (response as any)?.authentication;
        // When using the proxy, authentication should be populated directly.
        if (auth?.accessToken) {
          setAccessToken(auth.accessToken);
          // Fetch userinfo for email display
          try {
            const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${auth.accessToken}` } });
            const json: any = await info.json();
            setUserEmail(json.email ?? null);
            await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: auth.accessToken, refreshToken: auth.refreshToken, email: json.email ?? null }));
          } catch {
            await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }));
          }
          return;
        }
        // Native: exchange the code via proxy. Web uses implicit flow and returns authentication directly.
        if (!isWeb && code && request?.codeVerifier) {
          try {
            const token = await AuthSession.exchangeCodeAsync(
              {
                clientId,
                code,
                redirectUri,
                extraParams: { code_verifier: request.codeVerifier },
              },
              discovery
            );
            if ((token as any)?.accessToken || (token as any)?.access_token) {
              const at = (token as any).accessToken ?? (token as any).access_token;
              const rt = (token as any).refreshToken ?? (token as any).refresh_token;
              setAccessToken(at);
              setRefreshToken(rt ?? null);
              // Fetch userinfo for email
              try {
                const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${at}` } });
                const json: any = await info.json();
                setUserEmail(json.email ?? null);
                await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: at, refreshToken: rt ?? null, email: json.email ?? null }));
              } catch {
                await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: at, refreshToken: rt ?? null }));
              }
            }
          } catch (e) {
            console.warn('Token exchange failed', e);
          }
        }
      }
    })();
  }, [response, request, clientId, redirectUri]);

  const signIn = async (): Promise<string | null> => {
    const res = await promptAsync({ useProxy });
    if (res?.type === 'success') {
      const auth = (res as any).authentication;
      if (auth?.accessToken) {
        setAccessToken(auth.accessToken);
        try {
          const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${auth.accessToken}` } });
          const json: any = await info.json();
          setUserEmail(json.email ?? null);
          await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: auth.accessToken, refreshToken: auth.refreshToken, email: json.email ?? null }));
        } catch {
          await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }));
        }
        return auth.accessToken as string;
      }
      const code = (res as any)?.params?.code;
      if (!isWeb && code && request?.codeVerifier) {
        try {
          const token = await AuthSession.exchangeCodeAsync(
            {
              clientId,
              code,
              redirectUri,
              extraParams: { code_verifier: request.codeVerifier },
            },
            discovery
          );
          const at = (token as any).accessToken ?? (token as any).access_token;
          const rt = (token as any).refreshToken ?? (token as any).refresh_token;
          if (at) {
            setAccessToken(at);
            setRefreshToken(rt ?? null);
            try {
              const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${at}` } });
              const json: any = await info.json();
              setUserEmail(json.email ?? null);
              await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: at, refreshToken: rt ?? null, email: json.email ?? null }));
            } catch {
              await SecureStore.setItemAsync('google_token', JSON.stringify({ accessToken: at, refreshToken: rt ?? null }));
            }
            return at as string;
          }
        } catch (e) {
          console.warn('Token exchange failed', e);
        }
      }
    }
    return null;
  };

  const signOut = async () => {
    setAccessToken(null);
    setRefreshToken(null);
    setUserEmail(null);
    await SecureStore.deleteItemAsync('google_token');
  };

  return { request, accessToken, refreshToken, userEmail, signIn, signOut };
}
