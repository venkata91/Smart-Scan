export type ParsedReceipt = {
  date?: string; // YYYY-MM-DD
  merchant?: string;
  amountCents?: string; // string to keep TextInput happy
  currency?: string; // e.g., USD
  patientName?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  reimbursed?: boolean;
};

export function parseReceiptFields(text: string): ParsedReceipt {
  const result: ParsedReceipt = {};
  const lines = text
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Currency detection
  const lc = text.toLowerCase();
  if (lc.includes(' usd') || text.includes('$')) result.currency = 'USD';
  else if (lc.includes(' eur') || text.includes('€')) result.currency = 'EUR';
  else if (lc.includes(' gbp') || text.includes('£')) result.currency = 'GBP';

  // Date detection
  // Formats: YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY, M-D-YY, etc.
  const dateRegexes: RegExp[] = [
    /(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/, // YYYY-MM-DD
    /(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/, // MM-DD-YYYY or DD-MM-YYYY
    /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})/, // M-D-YY
  ];
  const allDates: string[] = [];
  for (const re of dateRegexes) {
    let m: RegExpExecArray | null;
    const clone = new RegExp(re.source, 'g');
    while ((m = clone.exec(text)) !== null) {
      let y: number, mo: number, d: number;
      if (m[1].length === 4) {
        y = parseInt(m[1], 10); mo = parseInt(m[2], 10); d = parseInt(m[3], 10);
      } else if (m[3].length === 4) {
        const a = parseInt(m[1], 10); const b = parseInt(m[2], 10);
        y = parseInt(m[3], 10); mo = a <= 12 ? a : b; d = a <= 12 ? b : a;
      } else {
        const a = parseInt(m[1], 10); const b = parseInt(m[2], 10); const yy = parseInt(m[3], 10);
        y = 2000 + yy; mo = a <= 12 ? a : b; d = a <= 12 ? b : a;
      }
      allDates.push(`${y}-${pad2(mo)}-${pad2(d)}`);
    }
  }
  if (allDates.length) {
    const sorted = Array.from(new Set(allDates)).sort();
    result.date = sorted[0];
    if (sorted.length >= 2) {
      result.startDate = sorted[0];
      result.endDate = sorted[sorted.length - 1];
    }
  }

  // Amount detection: prefer lines with 'total' or 'amount'
  const moneyPattern = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.|,)([0-9]{2})/g;
  let chosen: number | null = null;
  for (const line of lines) {
    const lcl = line.toLowerCase();
    if (lcl.includes('total') || lcl.includes('amount') || lcl.includes('balance')) {
      let m;
      while ((m = moneyPattern.exec(line))) {
        const major = parseInt(m[1].replace(/,/g, ''), 10);
        const minor = parseInt(m[2], 10);
        chosen = major * 100 + minor;
      }
    }
  }
  if (chosen == null) {
    // fallback: last money-like number in the text
    let m;
    while ((m = moneyPattern.exec(text))) {
      const major = parseInt(m[1].replace(/,/g, ''), 10);
      const minor = parseInt(m[2], 10);
      chosen = major * 100 + minor;
    }
  }
  if (chosen != null) result.amountCents = String(chosen);

  // Provider (merchant) heuristic:
  // 1) Look for explicit labels like Provider/Doctor/Clinic/Hospital/Pharmacy
  let provider: string | undefined;
  const labelRe = /(provider|doctor|physician|clinic|hospital|dental|dentist|pharmacy|optometrist|therap(?:y|ist)|urgent care)\s*[:\-]\s*(.+)/i;
  for (const l of lines.slice(0, 15)) {
    const m = l.match(labelRe);
    if (m && m[2]) { provider = m[2].trim(); break; }
  }
  // 2) Otherwise take the first uppercase-heavy line without currency/amounts
  if (!provider) {
    provider = lines.find((l) => /[A-Za-z]/.test(l) && !/[\$€£]/.test(l) && !/\d{3,}/.test(l) && isLikelyName(l));
  }
  if (provider) result.merchant = normalizeName(provider);

  // Patient name: look for explicit labels
  const patientLine = lines.find((l) => /(patient|member|dependent|name)\s*[:\-]/i.test(l));
  if (patientLine) {
    const m = patientLine.match(/(patient|member|dependent|name)\s*[:\-]\s*(.+)/i);
    if (m && m[2]) result.patientName = m[2].trim();
  }

  // Reimbursed status: detect phrases indicating fully paid
  if (/reimbursed|paid in full|payment received/i.test(text)) {
    result.reimbursed = true;
  }

  return result;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function normalizeName(s: string) {
  // Remove obvious receipt words
  return s
    .replace(/receipt|invoice|total|amount|date|merchant|thank you|statement|account|no\.?|number|qty|balance/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isLikelyName(line: string) {
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const letters = line.replace(/[^A-Za-z]/g, '').length;
  const ratio = letters / Math.max(1, line.length);
  return ratio > 0.5 && words.some((w) => /[A-Za-z]{3,}/.test(w));
}
