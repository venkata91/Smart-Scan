import { Platform } from 'react-native';
import { readUriToBytes } from './bytes';

export type CleanImage = { uri: string; bytes: Uint8Array; ext: 'png' };

type CleanupOptions = {
  maxWidth?: number; // resize for performance
  gamma?: number; // pre-adjust luminance; <1 brightens, >1 darkens
  unsharpAmount?: number; // 0..2
  tileSize?: number; // adaptive threshold tile size in px
  tileOffset?: number; // constant subtracted from local mean (0..32)
  morphClose?: boolean; // apply dilation then erosion to close gaps
};

export async function cleanupImage(uri: string, opts: CleanupOptions = {}): Promise<CleanImage> {
  if (Platform.OS !== 'web') {
    // Native path: return original for now.
    const bytes = await readUriToBytes(uri);
    return { uri, bytes, ext: 'png' } as any;
  }

  const {
    maxWidth = 2000,
    gamma = 1.0,
    unsharpAmount = 0.6,
    tileSize = 32,
    tileOffset = 10,
    morphClose = true,
  } = opts;

  const img = await loadImage(uri);
  const scale = Math.min(1, maxWidth / Math.max(1, img.width));
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

  // 1) Grayscale to separate Y channel
  const Y = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (gamma !== 1) {
      // simple gamma adjustment in sRGB
      y = 255 * Math.pow(y / 255, gamma);
    }
    Y[p] = y | 0;
  }

  // 2) Unsharp mask to boost edges
  if (unsharpAmount > 0) {
    const blurred = gaussianBlurGray(Y, w, h);
    for (let i = 0; i < Y.length; i++) {
      const v = clamp255(Y[i] + unsharpAmount * (Y[i] - blurred[i]));
      Y[i] = v;
    }
  }

  // 3) Adaptive threshold (tile-based local mean)
  const bin = new Uint8ClampedArray(w * h);
  const ts = Math.max(8, Math.floor(tileSize));
  const tilesX = Math.ceil(w / ts);
  const tilesY = Math.ceil(h / ts);
  // Precompute tile means
  const tileMean = new Float32Array(tilesX * tilesY);
  for (let ty = 0; ty < tilesY; ty++) {
    const y0 = ty * ts;
    const y1 = Math.min(h, y0 + ts);
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * ts;
      const x1 = Math.min(w, x0 + ts);
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y++) {
        let idx = y * w + x0;
        for (let x = x0; x < x1; x++, idx++) { sum += Y[idx]; cnt++; }
      }
      tileMean[ty * tilesX + tx] = cnt ? sum / cnt : 127;
    }
  }
  // Threshold per pixel using its tile mean minus offset
  for (let y = 0; y < h; y++) {
    const ty = Math.min(tilesY - 1, (y / ts) | 0);
    for (let x = 0; x < w; x++) {
      const tx = Math.min(tilesX - 1, (x / ts) | 0);
      const m = tileMean[ty * tilesX + tx] - tileOffset;
      const v = Y[y * w + x] >= m ? 255 : 0;
      bin[y * w + x] = v;
    }
  }

  // 4) Morphological closing to fill small gaps
  if (morphClose) {
    const dil = dilate3x3(bin, w, h);
    const ero = erode3x3(dil, w, h);
    ero.forEach((v, i) => (bin[i] = v));
  }

  // 5) Write back to RGBA and export
  for (let i = 0, p = 0; p < bin.length; i += 4, p++) {
    const v = bin[p];
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');

  // Convert data URL to bytes
  const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
  const bytes = base64ToUint8Array(base64);
  return { uri: dataUrl, bytes, ext: 'png' };
}

function gaussianBlurGray(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  // Separable 5-tap kernel [1,4,6,4,1]/16
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const k = [1, 4, 6, 4, 1];
  const norm = 16;
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = clampInt(x + i, 0, w - 1);
        acc += k[i + 2] * src[y * w + xx];
      }
      tmp[y * w + x] = acc / norm;
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = clampInt(y + i, 0, h - 1);
        acc += k[i + 2] * tmp[yy * w + x];
      }
      out[y * w + x] = clamp255(acc / norm);
    }
  }
  return out;
}

function dilate3x3(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maxv = 0;
      for (let j = -1; j <= 1; j++) {
        const yy = clampInt(y + j, 0, h - 1);
        for (let i = -1; i <= 1; i++) {
          const xx = clampInt(x + i, 0, w - 1);
          const v = src[yy * w + xx];
          if (v > maxv) maxv = v;
        }
      }
      out[y * w + x] = maxv;
    }
  }
  return out;
}

function erode3x3(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minv = 255;
      for (let j = -1; j <= 1; j++) {
        const yy = clampInt(y + j, 0, h - 1);
        for (let i = -1; i <= 1; i++) {
          const xx = clampInt(x + i, 0, w - 1);
          const v = src[yy * w + xx];
          if (v < minv) minv = v;
        }
      }
      out[y * w + x] = minv;
    }
  }
  return out;
}

function clampInt(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
function clamp255(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

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
