import React, { useState } from 'react';
import { Alert, Button, ScrollView, Text, TextInput, View, Platform, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { extractTextFromImage } from '../ocr/ocr';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { buildDrivePath, buildFileName } from '../../../src/core/naming';
import { generateKey, encryptBytes } from '../../../src/core/crypto';
import { ensureFolder, uploadEncryptedBlob } from '../google/drive';
import { readUriToBytes } from '../utils/bytes';
import { cleanupImage } from '../utils/imageCleanup';

export default function CaptureScreen() {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [fileExt, setFileExt] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string>('');
  const [cleanUri, setCleanUri] = useState<string | null>(null);
  const [date, setDate] = useState<string>('2025-01-01');
  const [merchant, setMerchant] = useState<string>('');
  const [amountCents, setAmountCents] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const { accessToken, signIn } = useGoogleAuth();

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 1 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      const asset = res.assets[0];
      const uri = asset.uri;
      setFileUri(uri);
      const ext = (asset.fileName?.split('.').pop() || uri.split('?')[0].split('.').pop() || '').toLowerCase();
      setFileExt(ext || 'jpg');
      // Clean up image (web only for now)
      if (Platform.OS === 'web') {
        try {
          const cleaned = await cleanupImage(uri);
          setCleanUri(cleaned.uri);
        } catch {}
      }
      const ocrSource = cleanUri || uri;
      setOcrText('Extracting text…');
      const ocr = await extractTextFromImage(ocrSource);
      setOcrText(ocr.text);
    }
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
    if (!res.canceled) {
      const asset = (res as any).assets?.[0] ?? res;
      const uri = asset.uri as string;
      setFileUri(uri);
      setFileExt('pdf');
      setOcrText('(OCR for PDF not extracted — uploading encrypted PDF)');
    }
  };

  const upload = async () => {
    if (!accessToken) {
      await signIn();
      return;
    }
    if (!fileUri) { Alert.alert('Pick an image or PDF first'); return; }
    const amount = parseInt(amountCents || '0', 10);
    const receipt = { id: crypto.randomUUID(), date, merchant, amount, currency };
    const baseName = buildFileName(receipt as any);
    const path = buildDrivePath(receipt as any);

    const folderId = await ensureFolder(path.split('/'), accessToken);

    // Encrypt the selected file (image/PDF) bytes
    const dataKey = await generateKey();
    const fileBytes = await readUriToBytes(cleanUri || fileUri);
    const { ciphertext } = await encryptBytes(dataKey, fileBytes);
    const encryptedName = `${baseName}.${fileExt === 'pdf' ? 'pdf' : (fileExt || 'bin')}.enc`;
    const fileId = await uploadEncryptedBlob({ folderId, name: encryptedName, bytes: ciphertext, token: accessToken, originalExt: fileExt || undefined });
    Alert.alert('Uploaded', `File ID: ${fileId}`);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Button title="Pick Image" onPress={pickImage} />
      <View style={{ height: 8 }} />
      <Button title="Pick PDF" onPress={pickPdf} />
      {cleanUri && (
        <>
          <View style={{ height: 12 }} />
          <Text style={{ fontWeight: '600' }}>Cleaned preview</Text>
          {/* RN Image renders data URLs on web; native path can be added later */}
          <Image source={{ uri: cleanUri }} style={{ width: '100%', height: 200, resizeMode: 'contain', backgroundColor: '#fafafa' }} />
        </>
      )}
      <View style={{ height: 12 }} />
      <Text>Date (YYYY-MM-DD)</Text>
      <TextInput value={date} onChangeText={setDate} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>Merchant</Text>
      <TextInput value={merchant} onChangeText={setMerchant} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>Amount (cents)</Text>
      <TextInput value={amountCents} keyboardType="number-pad" onChangeText={setAmountCents} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>Currency</Text>
      <TextInput value={currency} onChangeText={setCurrency} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 12 }} />
      <Button title={accessToken ? 'Encrypt + Upload' : 'Sign in with Google'} onPress={upload} />
      <View style={{ height: 12 }} />
      <Text selectable style={{ color: '#666' }}>{ocrText || 'OCR text will appear here.'}</Text>
    </ScrollView>
  );
}
