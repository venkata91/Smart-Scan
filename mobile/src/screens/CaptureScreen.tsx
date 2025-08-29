import React, { useState } from 'react';
import { Alert, Button, ScrollView, Text, TextInput, View, Platform, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { extractTextFromImage } from '../ocr/ocr';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { buildDrivePath, buildFileName } from '../../../src/core/naming';
import { ensureFolder, uploadEncryptedBlob } from '../google/drive';
import { readUriToBytes } from '../utils/bytes';
import { cleanupImage } from '../utils/imageCleanup';
import { parseReceiptFields } from '../utils/receiptParse';

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
      let ocrSource = uri;
      if (Platform.OS === 'web') {
        try {
          const cleaned = await cleanupImage(uri);
          setCleanUri(cleaned.uri);
          ocrSource = cleaned.uri;
        } catch {}
      }
      setOcrText('Extracting text…');
      const ocr = await extractTextFromImage(ocrSource);
      setOcrText(ocr.text);
      const parsed = parseReceiptFields(ocr.text || '');
      if (parsed.date) setDate(parsed.date);
      if (parsed.merchant) setMerchant(parsed.merchant);
      if (parsed.amountCents) setAmountCents(parsed.amountCents);
      if (parsed.currency) setCurrency(parsed.currency);
    }
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
    if (!res.canceled) {
      const asset = (res as any).assets?.[0] ?? res;
      const uri = asset.uri as string;
      setFileUri(uri);
      setFileExt('pdf');
      setOcrText('(OCR for PDF not extracted — will upload PDF)');
    }
  };

  const upload = async () => {
    try {
      let token = accessToken;
      if (!token) {
        token = await signIn();
        if (!token) return; // user cancelled or failed auth
      }
      if (!fileUri) { Alert.alert('Pick an image or PDF first'); return; }
      const amount = parseInt(amountCents || '0', 10);
      const receipt = { id: crypto.randomUUID(), date, merchant, amount, currency };
      const baseName = buildFileName(receipt as any);
      const path = buildDrivePath(receipt as any);

      const folderId = await ensureFolder(path.split('/'), token);

      // PDFs: upload original only
      if (fileExt === 'pdf') {
        const pdfBytes = await readUriToBytes(fileUri);
        const pdfName = `${baseName}.pdf`;
        const pdfId = await uploadEncryptedBlob({ folderId, name: pdfName, bytes: pdfBytes, token, originalExt: 'pdf', contentType: 'application/pdf' });
        Alert.alert('Uploaded', `PDF File ID: ${pdfId}`);
        return;
      }

      // Images: upload both original and cleaned (if available)
      const uploads: string[] = [];
      const originalExt = (fileExt || 'jpg').toLowerCase();
      const originalName = `${baseName}.orig.${originalExt}`;
      const originalType = originalExt === 'png' ? 'image/png' : originalExt === 'jpg' || originalExt === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
      const originalBytes = await readUriToBytes(fileUri);
      const originalId = await uploadEncryptedBlob({ folderId, name: originalName, bytes: originalBytes, token, originalExt, contentType: originalType });
      uploads.push(`orig: ${originalId}`);

      if (cleanUri) {
        const cleanName = `${baseName}.clean.png`;
        const cleanBytes = await readUriToBytes(cleanUri);
        const cleanId = await uploadEncryptedBlob({ folderId, name: cleanName, bytes: cleanBytes, token, originalExt: 'png', contentType: 'image/png' });
        uploads.push(`clean: ${cleanId}`);
      }

      Alert.alert('Uploaded', uploads.join('\n'));
    } catch (e: any) {
      console.error('Upload failed', e);
      Alert.alert('Upload failed', e?.message || 'Unknown error');
    }
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
          <Image
            source={{ uri: cleanUri }}
            resizeMode="contain"
            style={{ width: '100%', height: 200, backgroundColor: '#fafafa' }}
          />
        </>
      )}
      <View style={{ height: 12 }} />
      {!accessToken && (
        <>
          <Button title="Sign in with Google" onPress={signIn as any} />
          <View style={{ height: 12 }} />
        </>
      )}
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
      <Button title="Upload to Drive" onPress={upload} />
      <Text style={{ color: '#666', marginTop: 6 }}>{accessToken ? 'Signed in' : 'Not signed in — will prompt on upload'}</Text>
      <View style={{ height: 12 }} />
      <Text selectable style={{ color: '#666' }}>{ocrText || 'OCR text will appear here.'}</Text>
    </ScrollView>
  );
}
