import * as FileSystem from 'expo-file-system';

export async function readUriToBytes(uri: string): Promise<Uint8Array> {
  // Prefer FileSystem to support file:// URIs on native and web
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return base64ToUint8Array(base64);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

