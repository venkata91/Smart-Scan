// OCR implementation: uses Tesseract.js on web, stub on native.
// Native path can be swapped to ML Kit or Vision later.

import { Platform } from 'react-native';
import { recognize } from 'tesseract.js';

async function loadImageWeb(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = uri;
  });
}

export type OCRResult = { text: string };

export async function extractTextFromImage(uri: string): Promise<OCRResult> {
  try {
    if (Platform.OS === 'web') {
      // Prefer passing an HTMLImageElement to avoid blob/data fetch quirks
      const img = await loadImageWeb(uri);
      const { data } = await recognize(img, 'eng', {
        workerPath: 'https://unpkg.com/tesseract.js@5.0.5/dist/worker.min.js',
        corePath: 'https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
      } as any);
      const text: string = data?.text ?? '';
      return { text };
    }
  } catch (e) {
    console.warn('OCR failed:', e);
  }
  // Native stub for now
  return { text: '' };
}
