import { Platform } from 'react-native';
import { readUriToBytes } from './bytes';

export type CleanImage = { uri: string; bytes: Uint8Array; ext: 'png' };

export async function cleanupImage(uri: string): Promise<CleanImage> {
  if (Platform.OS !== 'web') {
    // For native, return the original for now.
    const bytes = await readUriToBytes(uri);
    return { uri, bytes, ext: 'png' } as any;
  }

  const img = await loadImage(uri);
  const maxW = 2000;
  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 1) Grayscale, compute min/max
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    data[i] = data[i + 1] = data[i + 2] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }

  // 2) Contrast stretch
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const y = data[i];
    const y2 = Math.min(255, Math.max(0, Math.round(((y - min) * 255) / range)));
    data[i] = data[i + 1] = data[i + 2] = y2;
  }

  // 3) Simple threshold (Otsu-like heuristic with mean)
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) { sum += data[i]; count++; }
  const mean = sum / Math.max(1, count);
  const threshold = clamp(mean + 15, 0, 255); // bias towards white backgrounds
  for (let i = 0; i < data.length; i += 4) {
    const y = data[i];
    const v = y >= threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    // strengthen alpha
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');

  // Convert data URL to bytes
  const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
  const bytes = base64ToUint8Array(base64);
  return { uri: dataUrl, bytes, ext: 'png' };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = uri;
  });
}

