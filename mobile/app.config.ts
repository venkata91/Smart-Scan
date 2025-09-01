import 'dotenv/config';

export default () => ({
  expo: {
    name: 'Smart Scan',
    slug: 'smart-scan',
    scheme: 'smartscan',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: { image: './assets/splash.png', resizeMode: 'contain', backgroundColor: '#ffffff' },
    ios: { supportsTablet: true },
    android: { adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#ffffff' } },
    // Use Metro for web on SDK 53; no @expo/webpack-config needed
    web: { bundler: 'metro', favicon: './assets/favicon.png' },
    extra: {
      GOOGLE_EXPO_CLIENT_ID: process.env.GOOGLE_EXPO_CLIENT_ID,
      GOOGLE_IOS_CLIENT_ID: process.env.GOOGLE_IOS_CLIENT_ID,
      GOOGLE_ANDROID_CLIENT_ID: process.env.GOOGLE_ANDROID_CLIENT_ID,
      GOOGLE_WEB_CLIENT_ID: process.env.GOOGLE_WEB_CLIENT_ID,
    },
  },
});
