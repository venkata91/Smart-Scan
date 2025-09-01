import { recognize } from 'tesseract.js';
// Use static import so Metro bundles pdf.js rather than creating a dynamic chunk
// Use legacy build to avoid modern syntax (static class blocks) in Metro/Babel
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
// Ensure fake worker (no real Web Worker) has WorkerMessageHandler available
import 'pdfjs-dist/build/pdf.worker';

export type OCRResult = { text: string };

export async function extractTextFromPdf(uri: string): Promise<OCRResult> {

  const resp = await fetch(uri);
  if (!resp.ok) throw new Error(`Failed to fetch PDF: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  // Run without a Web Worker to avoid CORS and cross-origin isolation in dev
  const loadingTask = (pdfjsLib as any).getDocument({ data: buf, disableWorker: true });
  const pdf = await loadingTask.promise;

  const texts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport0 = page.getViewport({ scale: 1 });
    const targetWidth = 1600;
    const scale = Math.max(1, targetWidth / viewport0.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx as any, viewport }).promise;

    const { data } = await recognize(canvas as any, 'eng', {
      workerPath: 'https://unpkg.com/tesseract.js@5.0.5/dist/worker.min.js',
      corePath: 'https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
    } as any);
    const t = data?.text || '';
    if (t.trim()) texts.push(t.trim());
  }

  return { text: texts.join('\n\n') };
}

// Render first page of a PDF to a PNG data URL (web only)
export async function renderPdfFirstPageDataUrl(uri: string): Promise<string | null> {
  try {
    const resp = await fetch(uri);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const loadingTask = (pdfjsLib as any).getDocument({ data: buf, disableWorker: true });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport0 = page.getViewport({ scale: 1 });
    const targetWidth = 800;
    const scale = Math.max(1, targetWidth / viewport0.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
