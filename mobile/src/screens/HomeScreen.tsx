import React from 'react';
import { ScrollView, View, Text, Button, useWindowDimensions, Platform } from 'react-native';
import { btn as webBtn } from '../web/ui';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import CaptureScreen from './CaptureScreen';
import DashboardScreen from './DashboardScreen';

export default function HomeScreen() {
  const { accessToken, signIn, signOut } = useGoogleAuth();
  const [showDashboard, setShowDashboard] = React.useState(false);
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= 1024;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: isWide ? 'row' : 'column', gap: 16, marginTop: 16, alignItems: 'stretch' }}>
        <View style={isWide ? { width: '30%', borderWidth: 1, borderRadius: 10, padding: 12 } : { borderWidth: 1, borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>Scan</Text>
          <CaptureScreen embedded />
        </View>
        <View style={isWide ? { width: '70%', borderWidth: 1, borderRadius: 10, padding: 12 } : { borderWidth: 1, borderRadius: 10, padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>Dashboard</Text>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <button style={webBtn('neutral')} onClick={() => setShowDashboard((v) => !v)}>{showDashboard ? 'Hide' : 'Load Dashboard'}</button>
            ) : (
              <Button title={showDashboard ? 'Hide' : 'Load Dashboard'} onPress={() => setShowDashboard((v) => !v)} />
            )}
          </View>
          {showDashboard ? (
            <View style={{ height: isWide ? 600 : undefined }}>
              <DashboardScreen navigation={undefined as any} route={undefined as any} />
            </View>
          ) : (
            <Text style={{ color: '#666', marginTop: 8 }}>Dashboard is not loaded to avoid background API calls. Click "Load Dashboard" to fetch the latest 20 receipts.</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
