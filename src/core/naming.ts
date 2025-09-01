import type { Receipt } from './types.js';

const SAFE = /[^A-Za-z0-9._-]+/g;

export function slug(input: string): string {
  const s = (input ?? '')
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(SAFE, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return s || 'receipt';
}

/** Build deterministic file base name, e.g., 2025-01-31_Mercury-Dental_123-45_USD */
export function buildFileName(receipt: Receipt): string {
  const d = receipt.date;
  const merchant = slug(receipt.merchant);
  const amtMajor = Math.trunc(receipt.amount / 100);
  const amtMinor = Math.abs(receipt.amount % 100).toString().padStart(2, '0');
  const amountStr = `${amtMajor}-${amtMinor}`;
  const currency = receipt.currency || 'USD';
  return `${d}_${merchant}_${amountStr}_${currency}`;
}

/** Build Drive folder path like: HSA Vault/2025/Mercury-Dental */
export function buildDrivePath(receipt: Receipt): string {
  const year = receipt.date?.slice(0, 4) || 'Unknown';
  // Store receipts directly under the year folder (no per-merchant subfolders)
  return `HSA Vault/${year}`;
}
