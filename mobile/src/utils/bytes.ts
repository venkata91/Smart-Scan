import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

export async function readUriToBytes(uri: string): Promise<Uint8Array> {
  // Web: use fetch for blob:/http(s): URIs, decode data: URIs inline
  if (Platform.OS === 'web') {
    if (uri.startsWith('data:')) {
      const base64 = uri.substring(uri.indexOf(',') + 1);
      return base64ToUint8Array(base64);
    }
    const resp = await fetch(uri);
    if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  }
  // Native: use FileSystem for file:// URIs
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return base64ToUint8Array(base64);
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    // Node / Metro polyfill
    // @ts-ignore
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // @ts-ignore
  return btoa(binary);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return bufferToHex(new Uint8Array(digest));
  }
  try {
    // Lazy import expo-crypto if available
    const { digestStringAsync } = await import('expo-crypto');
    const b64 = bytesToBase64(bytes);
    const hex = await digestStringAsync('SHA-256' as any, b64, { encoding: (globalThis as any).CryptoEncoding?.BASE64 });
    return hex.toLowerCase();
  } catch {
    // Fallback: simple JS implementation (not optimized)
    const text = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
    const enc = new TextEncoder();
    const u8 = enc.encode(text);
    const digest = await (globalThis.crypto as any).subtle.digest('SHA-256', u8);
    return bufferToHex(new Uint8Array(digest));
  }
}

function bufferToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}
