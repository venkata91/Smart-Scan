// AES-GCM utilities using WebCrypto (Node 18+ or browser).
export const AES_GCM_TAG_BITS = 128;
function getSubtle() {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error('WebCrypto subtle not available. Use Node 18+ or a polyfill.');
    return subtle;
}
/** Generate a random 256-bit AES-GCM key */
export async function generateKey() {
    const s = getSubtle();
    return s.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
/** Derive a key from a passphrase using PBKDF2 (SHA-256). */
export async function deriveKeyFromPassphrase(passphrase, salt, iterations = 200000) {
    const s = getSubtle();
    const enc = new TextEncoder();
    const baseKey = await s.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export async function exportKeyRaw(key) {
    const s = getSubtle();
    return new Uint8Array(await s.exportKey('raw', key));
}
export async function importKeyRaw(raw) {
    const s = getSubtle();
    return s.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
export function randomBytes(length) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
}
/** Encrypt bytes with AES-GCM; returns { iv, ciphertext } */
export async function encryptBytes(key, bytes) {
    const s = getSubtle();
    const iv = randomBytes(12);
    const ct = await s.encrypt({ name: 'AES-GCM', iv: iv, tagLength: AES_GCM_TAG_BITS }, key, bytes);
    return { iv, ciphertext: new Uint8Array(ct) };
}
/** Decrypt bytes with AES-GCM */
export async function decryptBytes(key, iv, ciphertext) {
    const s = getSubtle();
    const pt = await s.decrypt({ name: 'AES-GCM', iv: iv, tagLength: AES_GCM_TAG_BITS }, key, ciphertext);
    return new Uint8Array(pt);
}
/** Convenience helpers for strings */
export async function encryptString(key, text) {
    const enc = new TextEncoder();
    return encryptBytes(key, enc.encode(text));
}
export async function decryptToString(key, iv, ciphertext) {
    const dec = new TextDecoder();
    const pt = await decryptBytes(key, iv, ciphertext);
    return dec.decode(pt);
}
/** Wrap a data key with a passphrase-derived key for export. */
export async function wrapKeyWithPassphrase(dataKey, passphrase) {
    const salt = randomBytes(16);
    const wrappingKey = await deriveKeyFromPassphrase(passphrase, salt);
    const rawDataKey = await exportKeyRaw(dataKey);
    const { iv, ciphertext } = await encryptBytes(wrappingKey, rawDataKey);
    return { salt, iv, wrapped: ciphertext };
}
/** Unwrap a data key with a passphrase-derived key */
export async function unwrapKeyWithPassphrase(salt, iv, wrapped, passphrase) {
    const wrappingKey = await deriveKeyFromPassphrase(passphrase, salt);
    const raw = await decryptBytes(wrappingKey, iv, wrapped);
    return importKeyRaw(raw);
}
