// AES-GCM utilities using WebCrypto (Node 18+ or browser).

export const AES_GCM_TAG_BITS = 128;

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis as any).crypto?.subtle as SubtleCrypto | undefined;
  if (!subtle) throw new Error('WebCrypto subtle not available. Use Node 18+ or a polyfill.');
  return subtle;
}

/** Generate a random 256-bit AES-GCM key */
export async function generateKey(): Promise<CryptoKey> {
  const s = getSubtle();
  return s.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Derive a key from a passphrase using PBKDF2 (SHA-256). */
export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array, iterations = 200_000): Promise<CryptoKey> {
  const s = getSubtle();
  const enc = new TextEncoder();
  const baseKey = await s.importKey('raw', enc.encode(passphrase) as any, 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations } as any,
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  const s = getSubtle();
  return new Uint8Array(await s.exportKey('raw', key));
}

export async function importKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  const s = getSubtle();
  return s.importKey('raw', raw as any, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

/** Encrypt bytes with AES-GCM; returns { iv, ciphertext } */
export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const s = getSubtle();
  const iv = randomBytes(12);
  const ct = await s.encrypt({ name: 'AES-GCM', iv: iv as any, tagLength: AES_GCM_TAG_BITS }, key, bytes as any);
  return { iv, ciphertext: new Uint8Array(ct) };
}

/** Decrypt bytes with AES-GCM */
export async function decryptBytes(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  const s = getSubtle();
  const pt = await s.decrypt({ name: 'AES-GCM', iv: iv as any, tagLength: AES_GCM_TAG_BITS }, key, ciphertext as any);
  return new Uint8Array(pt);
}

/** Convenience helpers for strings */
export async function encryptString(key: CryptoKey, text: string) {
  const enc = new TextEncoder();
  return encryptBytes(key, enc.encode(text));
}

export async function decryptToString(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<string> {
  const dec = new TextDecoder();
  const pt = await decryptBytes(key, iv, ciphertext);
  return dec.decode(pt);
}

/** Wrap a data key with a passphrase-derived key for export. */
export async function wrapKeyWithPassphrase(dataKey: CryptoKey, passphrase: string): Promise<{ salt: Uint8Array; iv: Uint8Array; wrapped: Uint8Array }>{
  const salt = randomBytes(16);
  const wrappingKey = await deriveKeyFromPassphrase(passphrase, salt);
  const rawDataKey = await exportKeyRaw(dataKey);
  const { iv, ciphertext } = await encryptBytes(wrappingKey, rawDataKey);
  return { salt, iv, wrapped: ciphertext };
}

/** Unwrap a data key with a passphrase-derived key */
export async function unwrapKeyWithPassphrase(salt: Uint8Array, iv: Uint8Array, wrapped: Uint8Array, passphrase: string): Promise<CryptoKey> {
  const wrappingKey = await deriveKeyFromPassphrase(passphrase, salt);
  const raw = await decryptBytes(wrappingKey, iv, wrapped);
  return importKeyRaw(raw);
}
