// Google Sheets integration for receipts registry

const SHEET_TITLE = 'Smart Scan Receipts';
const LEGACY_TITLES = ['HSA Vault Receipts'];
const TAB_NAME = 'Receipts';
const HEADERS = [
  'timestamp',
  'provider',
  'patientName',
  'amount',
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
  amount?: number;
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
  if (!token) throw new Error('Missing access token');
  // Try to find by name via Drive search (new + legacy)
  const searchByName = async (name: string) => {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and name='" + name.replace(/'/g, "\\'") + "' and trashed=false");
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null as any;
    const data = await res.json();
    return (data.files?.[0]?.id as string) || null;
  };

  let spreadsheetId: string | null = await searchByName(SHEET_TITLE);
  if (!spreadsheetId) {
    for (const legacy of LEGACY_TITLES) {
      spreadsheetId = await searchByName(legacy);
      if (spreadsheetId) break;
    }
  }
  if (spreadsheetId) return spreadsheetId;

  // Create new spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: SHEET_TITLE }, sheets: [{ properties: { title: TAB_NAME } }] }),
  });
  if (!createRes.ok) {
    const body = await safeText(createRes);
    throw new Error(`Create spreadsheet failed: ${createRes.status} ${body}`);
  }
  const created = await createRes.json();
  spreadsheetId = (created.spreadsheetId as string) || null;
  if (!spreadsheetId) throw new Error('Create spreadsheet did not return an id');
  await ensureHeaders(token, spreadsheetId);
  return spreadsheetId;
}

export async function ensureHeaders(token: string, spreadsheetId: string): Promise<void> {
  if (!spreadsheetId) throw new Error('Missing spreadsheetId');
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:Z1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await safeText(res);
    throw new Error(`Read headers failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  const row = json.values?.[0] || [];
  const same = Array.isArray(row) && row.length === HEADERS.length && row.every((v: string, i: number) => v === HEADERS[i]);
  if (same) return;
  // Put headers
  const put = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADERS] }),
  });
  if (!put.ok) {
    const body = await safeText(put);
    throw new Error(`Write headers failed: ${put.status} ${body}`);
  }
}

export async function appendReceiptRow(token: string, spreadsheetId: string, row: Omit<ReceiptRow, 'rowNumber'>): Promise<void> {
  const values = [[
    new Date().toISOString(),
    row.provider ?? '',
    row.patientName ?? '',
    row.amount ?? '',
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
  if (!res.ok) {
    const body = await safeText(res);
    throw new Error(`Read rows failed: ${res.status} ${body}`);
  }
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
    amount: n(get(3)),
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

export async function getSheetId(token: string, spreadsheetId: string, title: string): Promise<number> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  const sheet = (json.sheets || []).find((s: any) => s.properties?.title === title);
  if (!sheet) throw new Error(`Sheet '${title}' not found`);
  return sheet.properties.sheetId as number;
}

export async function deleteRow(token: string, spreadsheetId: string, title: string, rowNumber: number): Promise<void> {
  const sheetId = await getSheetId(token, spreadsheetId, title);
  const requestBody = {
    requests: [
      {
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1, // zero-based
            endIndex: rowNumber, // exclusive
          },
        },
      },
    ],
  };
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) throw new Error(`Sheets delete row failed: ${res.status}`);
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}
