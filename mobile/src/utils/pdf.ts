export async function imageDataUrlToPdfBytes(dataUrl: string): Promise<Uint8Array> {
  // Dynamically import pdf-lib to avoid bundling issues on web (tslib interop)
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const isPng = dataUrl.startsWith('data:image/png');
  const bytes = dataUrlToBytes(dataUrl);
  const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  const page = pdfDoc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  const out = await pdfDoc.save();
  return out;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(idx + 1);
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
    return u8;
  }
  // @ts-ignore
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}
