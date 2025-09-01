import React, { useMemo, useState } from 'react';
import { Alert, Button, ScrollView, Text, TextInput, View, Platform, Image, Switch, Modal } from 'react-native';
// Avoid static imports for native-only UI to prevent web bundling issues
import { useNavigation } from '@react-navigation/native';
// Removed separate ImagePicker button; using single DocumentPicker "Browse"
import * as DocumentPicker from 'expo-document-picker';
import { extractTextFromImage } from '../ocr/ocr';
import { extractTextFromPdf, renderPdfFirstPageDataUrl } from '../ocr/pdf';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { buildDrivePath, buildFileName } from '../../../src/core/naming';
import { ensureFolder, uploadEncryptedBlob } from '../google/drive';
import { findOrCreateSpreadsheet, ensureHeaders, listAllReceipts, appendReceiptRow } from '../google/sheets';
import { readUriToBytes, sha256Hex } from '../utils/bytes';
import { imageDataUrlToPdfBytes } from '../utils/pdf';
import { cleanupImage } from '../utils/imageCleanup';
import { parseReceiptFields } from '../utils/receiptParse';

type CaptureProps = { embedded?: boolean };
export default function CaptureScreen({ embedded }: CaptureProps) {
  const navigation = useNavigation<any>();
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [fileExt, setFileExt] = useState<string | null>(null);
  const [cleanUri, setCleanUri] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // No standalone Date field; use Start/End dates (End optional)
  const [provider, setProvider] = useState<string>('');
  const [patientName, setPatientName] = useState<string>('');
  const [amount, setAmount] = useState<string>(''); // dollars.cents
  const [currency, setCurrency] = useState<string>('USD');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [reimbursed, setReimbursed] = useState<boolean>(false);
  const [storeOriginal, setStoreOriginal] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [lastUploadSig, setLastUploadSig] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState<boolean>(false);
  const { accessToken, signIn } = useGoogleAuth();
  const serviceDate = useMemo(() => startDate || endDate || new Date().toISOString().slice(0, 10), [startDate, endDate]);
  const currentSig = useMemo(() => {
    const base = buildFileName({ id: '', date: serviceDate, merchant: provider, amount: dollarsToCents(amount || '0'), currency } as any);
    return JSON.stringify({ baseName: base, fileUri, hasClean: !!cleanUri, amount, currency, provider, patientName, startDate, endDate });
  }, [serviceDate, provider, amount, currency, patientName, startDate, endDate, fileUri, cleanUri]);
  const isDuplicate = !!lastUploadSig && lastUploadSig === currentSig;

  const browse = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] as any, multiple: false, copyToCacheDirectory: true });
    if (res.canceled) return;
    const asset = (res as any).assets?.[0] ?? res;
    const uri = String(asset.uri);
    const name = String((asset as any).name || uri.split('/').pop() || '');
    const ext = (name.split('.').pop() || '').toLowerCase();
    setFileUri(uri);
    setFileExt(ext);
    setCleanUri(null);
    setPreviewUri(null);
    setLastUploadSig(null);

    if (ext === 'pdf' || (asset.mimeType && String(asset.mimeType).includes('pdf'))) {
      setStatus('Extracting text from PDF…');
      try {
        const ocr = await extractTextFromPdf(uri);
        if (Platform.OS === 'web') {
          const thumb = await renderPdfFirstPageDataUrl(uri);
          if (thumb) setPreviewUri(thumb);
        }
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
      return;
    }

    // Image flow
    let ocrSource = uri;
    if (Platform.OS === 'web') {
      try {
        const cleaned = await cleanupImage(uri);
        setCleanUri(cleaned.uri);
        ocrSource = cleaned.uri;
        setPreviewUri(cleaned.uri);
      } catch {}
    }
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
  };
  const pickImage = undefined as any; // legacy removed
  const pickPdf = undefined as any; // legacy removed

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
      const receipt = {
        id: crypto.randomUUID(),
        date: serviceDate,
        merchant: provider,
        amount: dollarsToCents(amount || '0'),
        currency,
      } as any;
      const baseName = buildFileName(receipt);

      // Idempotency guard: prevent re-uploading the same receipt+file combo
      if (lastUploadSig && lastUploadSig === currentSig) {
        setStatus('Already uploaded — change details or Browse another file');
        Alert.alert('Already uploaded', 'This receipt appears to be already uploaded. Modify details or browse a different file.');
        return;
      }
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
      // Sheets registry setup
      const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
      await withAuthRetry((t) => ensureHeaders(t, spreadsheetId));

      if (fileExt === 'pdf') {
        const pdfBytes = await readUriToBytes(fileUri);
        const checksum = await sha256Hex(pdfBytes);
        const existing = await withAuthRetry((t) => listAllReceipts(t, spreadsheetId));
        if (existing.some((r) => r.checksum === checksum)) {
          setStatus('Already uploaded — matched checksum in registry');
          Alert.alert('Duplicate detected', 'A receipt with the same checksum already exists in the registry.');
          return;
        }
        const pdfName = `${baseName}.pdf`;
        const pdfId = await withAuthRetry((t) =>
          uploadEncryptedBlob({ folderId, name: pdfName, bytes: pdfBytes, token: t, originalExt: 'pdf', contentType: 'application/pdf' })
        );
        await withAuthRetry((t) => appendReceiptRow(t, spreadsheetId, {
          provider,
          patientName,
          amountCents: dollarsToCents(amount || '0'),
          currency,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          reimbursed,
          pdfFileId: pdfId,
          originalFileId: '',
          folderPath: path,
          checksum,
        }));
        setStatus('Upload complete');
        setLastUploadSig(currentSig);
        Alert.alert('Uploaded', `PDF uploaded. File ID: ${pdfId}`);
        return;
      }

      // Upload original image (optional)
      const uploads: string[] = [];
      const originalExt = (fileExt || 'jpg').toLowerCase();
      let originalId: string | undefined;
      let originalBytes: Uint8Array | undefined;
      if (storeOriginal) {
        const originalName = `${baseName}.orig.${originalExt}`;
        const originalType = originalExt === 'png' ? 'image/png' : originalExt === 'jpg' || originalExt === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
        originalBytes = await readUriToBytes(fileUri);
        originalId = await withAuthRetry((t) =>
          uploadEncryptedBlob({ folderId, name: originalName, bytes: originalBytes!, token: t, originalExt, contentType: originalType })
        );
        uploads.push(`Original: ${originalId}`);
      }

      // Convert cleaned image (preferred) or original to a single-page PDF and upload for consistent storage
      let pdfBytes: Uint8Array | null = null;
      try {
        let dataUrl = cleanUri || null;
        if (!dataUrl) {
          // Fetch original and convert to data URL
          const resp = await fetch(fileUri);
          const blob = await resp.blob();
          const reader = new FileReader();
          dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        pdfBytes = await imageDataUrlToPdfBytes(dataUrl!);
      } catch (e) {
        console.warn('Failed to build PDF from image', e);
      }
      if (pdfBytes) {
        const checksum = await sha256Hex(pdfBytes);
        const existing = await withAuthRetry((t) => listAllReceipts(t, spreadsheetId));
        if (existing.some((r) => r.checksum === checksum)) {
          setStatus('Already uploaded — matched checksum in registry');
          Alert.alert('Duplicate detected', 'A receipt with the same checksum already exists in the registry.');
          return;
        }
        const pdfName = `${baseName}.pdf`;
        const cleanPdfId = await withAuthRetry((t) => uploadEncryptedBlob({ folderId, name: pdfName, bytes: pdfBytes!, token: t, originalExt: 'pdf', contentType: 'application/pdf' }));
        uploads.push(`PDF: ${cleanPdfId}`);
        await withAuthRetry((t) => appendReceiptRow(t, spreadsheetId, {
          provider,
          patientName,
          amountCents: dollarsToCents(amount || '0'),
          currency,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          reimbursed,
          pdfFileId: cleanPdfId,
          originalFileId: originalId || '',
          folderPath: path,
          checksum,
        }));
      }
      setStatus('Upload complete');
      setLastUploadSig(currentSig);
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
      <Modal visible={zoomOpen} animationType="fade" onRequestClose={() => setZoomOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Image source={{ uri: previewUri || cleanUri || fileUri || undefined }} resizeMode="contain" style={{ width: '100%', height: '85%' as any }} />
          <View style={{ height: 12 }} />
          <Button title="Close" onPress={() => setZoomOpen(false)} />
        </View>
      </Modal>
      <Button title="Browse" onPress={browse} />
      {(previewUri || cleanUri) && (
        <>
          <View style={{ height: 12 }} />
          <Text style={{ fontWeight: '600' }}>File preview</Text>
          <Image source={{ uri: previewUri || cleanUri! }} resizeMode="contain" style={{ width: '100%', height: 240, backgroundColor: '#fafafa', borderRadius: 8 }} />
          <View style={{ height: 8 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Zoom" onPress={() => setZoomOpen(true)} />
            <Button title="Replace file" onPress={browse} />
          </View>
        </>
      )}
      <View style={{ height: 12 }} />
      {!accessToken && (
        <>
          <Button title="Sign in with Google" onPress={signIn as any} />
          <View style={{ height: 12 }} />
        </>
      )}
      <Text>Start Date</Text>
      <DateField value={startDate} onChange={setStartDate} />
      <View style={{ height: 8 }} />
      <Text>End Date (optional)</Text>
      <DateField value={endDate} onChange={setEndDate} />
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
      {Platform.OS === 'web' ? (
        // @ts-ignore web select
        <select
          value={currency}
          onChange={(e: any) => setCurrency(e.target.value)}
          style={{ border: '1px solid #ccc', padding: 8, borderRadius: 6, width: '100%' }}
        >
          <option value="USD">USD – US Dollar</option>
          <option value="EUR">EUR – Euro</option>
          <option value="GBP">GBP – British Pound</option>
          <option value="CAD">CAD – Canadian Dollar</option>
          <option value="INR">INR – Indian Rupee</option>
          <option value="SGD">SGD – Singapore Dollar</option>
          <option value="AED">AED – UAE Dirham</option>
        </select>
      ) : (
        <View style={{ borderWidth: 1, borderRadius: 6, overflow: 'hidden' }}>
          {(() => {
            const { Picker } = require('@react-native-picker/picker');
            return (
              <Picker selectedValue={currency} onValueChange={(v: any) => setCurrency(String(v))}>
                <Picker.Item label="USD – US Dollar" value="USD" />
                <Picker.Item label="EUR – Euro" value="EUR" />
                <Picker.Item label="GBP – British Pound" value="GBP" />
                <Picker.Item label="CAD – Canadian Dollar" value="CAD" />
                <Picker.Item label="INR – Indian Rupee" value="INR" />
                <Picker.Item label="SGD – Singapore Dollar" value="SGD" />
                <Picker.Item label="AED – UAE Dirham" value="AED" />
              </Picker>
            );
          })()}
        </View>
      )}
      <View style={{ height: 8 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Switch value={reimbursed} onValueChange={setReimbursed} />
        <Text>Reimbursed?</Text>
      </View>
      <View style={{ height: 8 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Switch value={storeOriginal} onValueChange={setStoreOriginal} />
        <Text>Store original image</Text>
      </View>
      <View style={{ height: 12 }} />
      <Button title={uploading ? 'Uploading…' : isDuplicate ? 'Already uploaded' : 'Upload to Drive'} onPress={upload} disabled={uploading || isDuplicate} />
      {!embedded && (
        <>
          <View style={{ height: 8 }} />
          <Button title="Go to Dashboard" onPress={() => navigation.navigate('Dashboard')} />
        </>
      )}
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

// Cross-platform date field: native picker on iOS/Android; text entry on web
function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = React.useState(false);
  const [tmpDate, setTmpDate] = React.useState<Date>(value ? new Date(value) : new Date());
  if (Platform.OS === 'web') {
    // Use native HTML date input on web for better UX
    return (
      // @ts-ignore react-native-web allows DOM elements
      <input
        type="date"
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        style={{ border: '1px solid #ccc', padding: 8, borderRadius: 6, width: '100%' }}
      />
    );
  }
  return (
    <View>
      <Button title={value || 'Pick date'} onPress={() => setShow(true)} />
      {show && (
        <DateTimePicker
          value={tmpDate}
          mode="date"
          display="default"
          onChange={(_, d) => {
            if (d) {
              setTmpDate(d);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const da = String(d.getDate()).padStart(2, '0');
              onChange(`${y}-${m}-${da}`);
            }
            setShow(false);
          }}
        />
      )}
    </View>
  );
}
