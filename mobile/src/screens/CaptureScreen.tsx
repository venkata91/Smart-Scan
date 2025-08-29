import React, { useState } from 'react';
import { Alert, Button, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { extractTextFromImage } from '../ocr/ocr';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { buildDrivePath, buildFileName } from '../../../src/core/naming';
import { generateKey, encryptBytes } from '../../../src/core/crypto';
import { ensureFolder, uploadEncryptedBlob } from '../google/drive';
import { readUriToBytes } from '../utils/bytes';

export default function CaptureScreen() {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [fileExt, setFileExt] = useState<'jpg' | 'jpeg' | 'png' | 'heic' | 'pdf' | null>(null);
  const [ocrText, setOcrText] = useState<string>('');
  const [date, setDate] = useState<string>('2025-01-01');
  const [merchant, setMerchant] = useState<string>('');
  const [amountCents, setAmountCents] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const { accessToken, signIn } = useGoogleAuth();

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      const uri = res.assets[0].uri;
      setFileUri(uri);
      setFileExt('jpg');
      const ocr = await extractTextFromImage(uri);
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
    const fileBytes = await readUriToBytes(fileUri);
    const { ciphertext } = await encryptBytes(dataKey, fileBytes);
    const ext = fileExt === 'pdf' ? 'pdf.enc' : 'img.enc';
    const fileId = await uploadEncryptedBlob({ folderId, name: `${baseName}.${ext}`, bytes: ciphertext, token: accessToken });
    Alert.alert('Uploaded', `File ID: ${fileId}`);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Button title="Pick Image" onPress={pickImage} />
      <View style={{ height: 8 }} />
      <Button title="Pick PDF" onPress={pickPdf} />
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
