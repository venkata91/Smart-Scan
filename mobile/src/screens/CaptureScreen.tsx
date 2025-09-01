import React, { useState } from 'react';
import { Alert, Button, ScrollView, Text, TextInput, View, Platform, Image, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { extractTextFromImage } from '../ocr/ocr';
import { extractTextFromPdf } from '../ocr/pdf';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { buildDrivePath, buildFileName } from '../../../src/core/naming';
import { ensureFolder, uploadEncryptedBlob } from '../google/drive';
import { readUriToBytes } from '../utils/bytes';
import { cleanupImage } from '../utils/imageCleanup';
import { parseReceiptFields } from '../utils/receiptParse';

export default function CaptureScreen() {
  const navigation = useNavigation<any>();
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [fileExt, setFileExt] = useState<string | null>(null);
  const [cleanUri, setCleanUri] = useState<string | null>(null);
  // No standalone Date field; use Start/End dates (End optional)
  const [provider, setProvider] = useState<string>('');
  const [patientName, setPatientName] = useState<string>('');
  const [amount, setAmount] = useState<string>(''); // dollars.cents
  const [currency, setCurrency] = useState<string>('USD');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [reimbursed, setReimbursed] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const { accessToken, signIn } = useGoogleAuth();

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 1 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      const asset = res.assets[0];
      const uri = asset.uri;
      setFileUri(uri);
      const ext = (asset.fileName?.split('.').pop() || uri.split('?')[0].split('.').pop() || '').toLowerCase();
      setFileExt(ext || 'jpg');

      // Clean on web for better OCR and preview
      let ocrSource = uri;
      if (Platform.OS === 'web') {
        try {
          const cleaned = await cleanupImage(uri);
          setCleanUri(cleaned.uri);
          ocrSource = cleaned.uri;
        } catch {}
      }

      // OCR and auto-fill
      setStatus('Extracting text…');
      const ocr = await extractTextFromImage(ocrSource);
      const parsed = parseReceiptFields(ocr.text || '');
      if (parsed.startDate) setStartDate(parsed.startDate);
      if (parsed.endDate) setEndDate(parsed.endDate);
      if (parsed.merchant) setProvider(parsed.merchant);
      if (parsed.patientName) setPatientName(parsed.patientName);
      if (parsed.amountCents) setAmount(centsToDollars(parsed.amountCents));
      if (parsed.currency) setCurrency(parsed.currency);
      if (typeof parsed.reimbursed === 'boolean') setReimbursed(parsed.reimbursed);
      setStatus('Ready to upload');
    }
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
    if (!res.canceled) {
      const asset = (res as any).assets?.[0] ?? res;
      const uri = asset.uri as string;
      setFileUri(uri);
      setFileExt('pdf');
      setCleanUri(null);
      setStatus('Extracting text from PDF…');
      try {
        const ocr = await extractTextFromPdf(uri);
        const parsed = parseReceiptFields(ocr.text || '');
        if (parsed.startDate) setStartDate(parsed.startDate);
        if (parsed.endDate) setEndDate(parsed.endDate);
        if (parsed.merchant) setProvider(parsed.merchant);
        if (parsed.patientName) setPatientName(parsed.patientName);
        if (parsed.amountCents) setAmount(centsToDollars(parsed.amountCents));
        if (parsed.currency) setCurrency(parsed.currency);
        if (typeof parsed.reimbursed === 'boolean') setReimbursed(parsed.reimbursed);
        setStatus('PDF text extracted — review and upload');
      } catch (e) {
        console.warn('PDF OCR failed', e);
        setStatus('PDF selected — ready to upload');
      }
    }
  };

  const upload = async () => {
    try {
      setUploading(true);
      setStatus('Preparing upload…');
      let token = accessToken;
      if (!token) {
        token = await signIn();
        if (!token) return;
      }
      if (!fileUri) { Alert.alert('Pick an image or PDF first'); return; }

      // Build Drive path + names from form
      const serviceDate = startDate || endDate || new Date().toISOString().slice(0, 10);
      const receipt = {
        id: crypto.randomUUID(),
        date: serviceDate,
        merchant: provider,
        amount: dollarsToCents(amount || '0'),
        currency,
      } as any;
      const baseName = buildFileName(receipt);
      const path = buildDrivePath(receipt);

      // Helper: run a Drive call with one re-auth retry on 401
      const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
        try {
          return await fn(token!);
        } catch (e: any) {
          const msg = String(e?.message || e || '');
          if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
            const t2 = await signIn();
            if (!t2) throw e;
            token = t2;
            return await fn(token!);
          }
          throw e;
        }
      };

      const folderId = await withAuthRetry((t) => ensureFolder(path.split('/'), t));

      if (fileExt === 'pdf') {
        const pdfBytes = await readUriToBytes(fileUri);
        const pdfName = `${baseName}.pdf`;
        const pdfId = await withAuthRetry((t) =>
          uploadEncryptedBlob({ folderId, name: pdfName, bytes: pdfBytes, token: t, originalExt: 'pdf', contentType: 'application/pdf' })
        );
        // Upload plain metadata JSON for dashboard
        const meta = {
          provider,
          patientName,
          amountCents: dollarsToCents(amount || '0'),
          currency,
          date,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          reimbursed,
          files: { pdfId },
        };
        const metaBytes = new TextEncoder().encode(JSON.stringify(meta, null, 2));
        await uploadEncryptedBlob({ folderId, name: `${baseName}.meta.json`, bytes: metaBytes, token, contentType: 'application/json' });
        setStatus('Upload complete');
        Alert.alert('Uploaded', `PDF uploaded. File ID: ${pdfId}`);
        return;
      }

      // Upload original image
      const uploads: string[] = [];
      const originalExt = (fileExt || 'jpg').toLowerCase();
      const originalName = `${baseName}.orig.${originalExt}`;
      const originalType = originalExt === 'png' ? 'image/png' : originalExt === 'jpg' || originalExt === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
      const originalBytes = await readUriToBytes(fileUri);
      const originalId = await withAuthRetry((t) =>
        uploadEncryptedBlob({ folderId, name: originalName, bytes: originalBytes, token: t, originalExt, contentType: originalType })
      );
      uploads.push(`Original: ${originalId}`);

      // Upload cleaned version if available
      if (cleanUri) {
        const cleanName = `${baseName}.clean.png`;
        const cleanBytes = await readUriToBytes(cleanUri);
        const cleanId = await withAuthRetry((t) =>
          uploadEncryptedBlob({ folderId, name: cleanName, bytes: cleanBytes, token: t, originalExt: 'png', contentType: 'image/png' })
        );
        uploads.push(`Clean: ${cleanId}`);
      }

      // Upload metadata JSON
      const meta = {
        provider,
        patientName,
        amountCents: dollarsToCents(amount || '0'),
        currency,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        reimbursed,
        files: { originalId, clean: cleanUri ? true : false },
      };
      const metaBytes = new TextEncoder().encode(JSON.stringify(meta, null, 2));
      await uploadEncryptedBlob({ folderId, name: `${baseName}.meta.json`, bytes: metaBytes, token, contentType: 'application/json' });
      setStatus('Upload complete');
      Alert.alert('Uploaded', uploads.join('\n'));
    } catch (e: any) {
      console.error('Upload failed', e);
      setStatus('Upload failed');
      Alert.alert('Upload failed', e?.message || 'Unknown error');
    } finally {
      setUploading(false);
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
          <Image source={{ uri: cleanUri }} resizeMode="contain" style={{ width: '100%', height: 200, backgroundColor: '#fafafa' }} />
        </>
      )}
      <View style={{ height: 12 }} />
      {!accessToken && (
        <>
          <Button title="Sign in with Google" onPress={signIn as any} />
          <View style={{ height: 12 }} />
        </>
      )}
      <Text>Start Date (YYYY-MM-DD)</Text>
      <TextInput value={startDate} onChangeText={setStartDate} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>End Date (optional)</Text>
      <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>Provider</Text>
      <TextInput value={provider} onChangeText={setProvider} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>Patient Name</Text>
      <TextInput value={patientName} onChangeText={setPatientName} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>Amount (e.g., 12.34)</Text>
      <TextInput value={amount} keyboardType="decimal-pad" onChangeText={setAmount} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <Text>Currency</Text>
      <TextInput value={currency} onChangeText={setCurrency} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
      <View style={{ height: 8 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Switch value={reimbursed} onValueChange={setReimbursed} />
        <Text>Reimbursed?</Text>
      </View>
      <View style={{ height: 12 }} />
      <Button title={uploading ? 'Uploading…' : 'Upload to Drive'} onPress={upload} disabled={uploading} />
      <View style={{ height: 8 }} />
      <Button title="Go to Dashboard" onPress={() => navigation.navigate('Dashboard')} />
      <Text style={{ color: '#666', marginTop: 6 }}>{status || (accessToken ? 'Signed in' : 'Not signed in — will prompt on upload')}</Text>
    </ScrollView>
  );
}

// Helpers: amounts and formatting
function dollarsToCents(input: string): number {
  const normalized = (input || '').replace(/[^0-9.]/g, '');
  if (!normalized) return 0;
  const value = parseFloat(normalized);
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}

function centsToDollars(centsStr: string): string {
  const cents = parseInt(centsStr || '0', 10) || 0;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `${sign}${dollars}.${minor}`;
}
