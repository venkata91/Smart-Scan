#!/usr/bin/env -S node --loader ts-node/esm
/**
 Demo (TypeScript):
 - Reads sample/receipts.json
 - Writes output/receipts.csv and output/summary.txt
 - Demonstrates encryption of a note string
 Note: If WebCrypto is unavailable (Node < 18), encryption demo is skipped.
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateReceipt } from '../src/core/models.js';
import { buildFileName, buildDrivePath } from '../src/core/naming.js';
import { toSheetRow, computeUnreimbursedTotal, formatCents } from '../src/core/sheets.js';
import * as cryptoUtil from '../src/core/crypto.js';
import type { Receipt } from '../src/core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJSON<T>(p: string): T {
  const buf = fs.readFileSync(p, 'utf8');
  return JSON.parse(buf) as T;
}

function writeCSV(p: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows]
    .map(r => r.map(v => String(v).includes(',') ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(','))
    .join('\n');
  fs.writeFileSync(p, csv + '\n');
}

async function main() {
  const samplePath = path.join(ROOT, 'sample', 'receipts.json');
  const receipts = readJSON<Receipt[]>(samplePath);
  const outDir = path.join(ROOT, 'output');
  ensureDir(outDir);

  const rows: (string | number)[][] = [];
  for (const r of receipts) {
    const v = validateReceipt(r);
    if (!v.ok) throw new Error(`Invalid receipt ${r.id}: ${v.errors.join('; ')}`);
    rows.push(toSheetRow({ reimbursed: false, ...r }));
  }

  const header = ['id', 'date', 'merchant', 'amount', 'currency', 'category', 'reimbursed', 'file_base', 'drive_path'];
  writeCSV(path.join(outDir, 'receipts.csv'), header, rows);

  const unreimbursed = computeUnreimbursedTotal(receipts);
  const lines: string[] = [];
  lines.push(`Unreimbursed total: $${formatCents(unreimbursed)} (across ${receipts.length} receipts)`);
  lines.push('');
  lines.push('Suggested paths:');
  for (const r of receipts) {
    lines.push(`- ${buildDrivePath(r)}/${buildFileName(r)}.pdf`);
  }

  lines.push('');
  const hasWebCrypto = Boolean((globalThis as any).crypto?.subtle);
  if (hasWebCrypto) {
    lines.push('[Encryption demo]');
    const dataKey = await cryptoUtil.generateKey();
    const secretText = 'Example note: RX discount applied';
    const { iv, ciphertext } = await cryptoUtil.encryptString(dataKey, secretText);
    const decrypted = await cryptoUtil.decryptToString(dataKey, iv, ciphertext);
    lines.push(`Encrypted bytes: ${ciphertext.byteLength}, round-trip ok: ${decrypted === secretText}`);

    const passphrase = 'correct horse battery staple';
    const wrapped = await cryptoUtil.wrapKeyWithPassphrase(dataKey, passphrase);
    const unwrapped = await cryptoUtil.unwrapKeyWithPassphrase(wrapped.salt, wrapped.iv, wrapped.wrapped, passphrase);
    const { ciphertext: ct2 } = await cryptoUtil.encryptString(unwrapped, secretText);
    lines.push(`Wrapped/unwrapped key works: ${ct2.byteLength > 0}`);
  } else {
    lines.push('[Encryption demo skipped: WebCrypto not available in this Node version]');
  }

  fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n'));

  console.log('Wrote output/receipts.csv and output/summary.txt');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
