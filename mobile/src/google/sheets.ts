// Google Sheets integration for receipts registry

const SHEET_TITLE = 'HSA Vault Receipts';
const TAB_NAME = 'Receipts';
const HEADERS = [
  'timestamp',
  'provider',
  'patientName',
  'amountCents',
  'currency',
  'startDate',
  'endDate',
  'reimbursed',
  'pdfFileId',
  'originalFileId',
  'folderPath',
  'checksum',
];

export type ReceiptRow = {
  rowNumber: number;
  provider?: string;
  patientName?: string;
  amountCents?: number;
  currency?: string;
  startDate?: string;
  endDate?: string;
  reimbursed?: boolean;
  pdfFileId?: string;
  originalFileId?: string;
  folderPath?: string;
  checksum?: string;
  timestamp?: string;
};

export async function findOrCreateSpreadsheet(token: string): Promise<string> {
  // Try to find by name via Drive search
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and name='" + SHEET_TITLE.replace(/'/g, "\\'") + "' and trashed=false");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.files?.length) return data.files[0].id as string;

  // Create new spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: SHEET_TITLE }, sheets: [{ properties: { title: TAB_NAME } }] }),
  });
  const created = await createRes.json();
  const spreadsheetId = created.spreadsheetId as string;
  await ensureHeaders(token, spreadsheetId);
  return spreadsheetId;
}

export async function ensureHeaders(token: string, spreadsheetId: string): Promise<void> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:Z1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  const row = json.values?.[0] || [];
  const same = Array.isArray(row) && row.length === HEADERS.length && row.every((v: string, i: number) => v === HEADERS[i]);
  if (same) return;
  // Put headers
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADERS] }),
  });
}

export async function appendReceiptRow(token: string, spreadsheetId: string, row: Omit<ReceiptRow, 'rowNumber'>): Promise<void> {
  const values = [[
    new Date().toISOString(),
    row.provider ?? '',
    row.patientName ?? '',
    row.amountCents ?? '',
    row.currency ?? '',
    row.startDate ?? '',
    row.endDate ?? '',
    row.reimbursed ? 'TRUE' : 'FALSE',
    row.pdfFileId ?? '',
    row.originalFileId ?? '',
    row.folderPath ?? '',
    row.checksum ?? '',
  ]];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
}

export async function listAllReceipts(token: string, spreadsheetId: string): Promise<ReceiptRow[]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A2:Z`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  const rows: any[] = json.values || [];
  return rows.map((r, idx) => toReceiptRow(r, idx + 2));
}

export async function updateReimbursedCell(token: string, spreadsheetId: string, rowNumber: number, value: boolean): Promise<void> {
  // reimbursed column is H (8th) => index 7
  const range = `${TAB_NAME}!H${rowNumber}:H${rowNumber}`;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[value ? 'TRUE' : 'FALSE']] }),
  });
}

function toReceiptRow(r: any[], rowNumber: number): ReceiptRow {
  const get = (i: number) => (r[i] ?? '').toString();
  const n = (s: string) => (s ? Number(s) : undefined);
  return {
    rowNumber,
    timestamp: get(0) || undefined,
    provider: get(1) || undefined,
    patientName: get(2) || undefined,
    amountCents: n(get(3)),
    currency: get(4) || undefined,
    startDate: get(5) || undefined,
    endDate: get(6) || undefined,
    reimbursed: (get(7) || '').toLowerCase() === 'true',
    pdfFileId: get(8) || undefined,
    originalFileId: get(9) || undefined,
    folderPath: get(10) || undefined,
    checksum: get(11) || undefined,
  };
}

