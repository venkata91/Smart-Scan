import React from 'react';
import { ScrollView, View, Text, Button, useWindowDimensions, Platform } from 'react-native';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import CaptureScreen from './CaptureScreen';
import DashboardScreen from './DashboardScreen';

export default function HomeScreen() {
  const { accessToken, signIn, signOut } = useGoogleAuth();
  const [showDashboard, setShowDashboard] = React.useState(false);
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= 1024;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} stickyHeaderIndices={[0]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', paddingBottom: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Smart HSA Receipt Vault</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!accessToken ? (
            <Button title="Sign in" onPress={() => signIn()} />
          ) : (
            <>
              <Text style={{ marginRight: 8 }}>Signed in</Text>
              <Button title="Sign out" onPress={() => signOut()} />
            </>
          )}
        </View>
      </View>
      <View style={{ flexDirection: isWide ? 'row' : 'column', gap: 16, marginTop: 16 }}>
        <View style={{ flex: 1, borderWidth: 1, borderRadius: 8, padding: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>Scan Receipt</Text>
          <CaptureScreen embedded />
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderRadius: 8, padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>Dashboard</Text>
            <Button title={showDashboard ? 'Hide' : 'Load Dashboard'} onPress={() => setShowDashboard((v) => !v)} />
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
