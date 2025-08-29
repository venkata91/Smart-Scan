export type ParsedReceipt = {
  date?: string; // YYYY-MM-DD
  merchant?: string;
  amountCents?: string; // string to keep TextInput happy
  currency?: string; // e.g., USD
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
  const dateMatch = dateRegexes
    .map((re) => re.exec(text))
    .find((m) => m);
  if (dateMatch) {
    if (dateMatch[1].length === 4) {
      // YYYY, M, D
      const yyyy = parseInt(dateMatch[1], 10);
      const mm = parseInt(dateMatch[2], 10);
      const dd = parseInt(dateMatch[3], 10);
      result.date = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
    } else if (dateMatch[3].length === 4) {
      // M,D,YYYY or D,M,YYYY — assume first is month if <=12
      const a = parseInt(dateMatch[1], 10);
      const b = parseInt(dateMatch[2], 10);
      const yyyy = parseInt(dateMatch[3], 10);
      const mm = a <= 12 ? a : b;
      const dd = a <= 12 ? b : a;
      result.date = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
    } else {
      // M,D,YY -> assume 20YY
      const a = parseInt(dateMatch[1], 10);
      const b = parseInt(dateMatch[2], 10);
      const yy = parseInt(dateMatch[3], 10);
      const yyyy = 2000 + yy;
      const mm = a <= 12 ? a : b;
      const dd = a <= 12 ? b : a;
      result.date = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
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

  // Merchant heuristic: first line that looks like a name (letters/spaces), avoid lines with $ or digits-heavy
  const nameLine = lines.find(
    (l) => /[A-Za-z]/.test(l) && !/\$/.test(l) && l.length >= 3 && l.split(' ').some((w) => /[A-Za-z]{2,}/.test(w))
  );
  if (nameLine) result.merchant = normalizeName(nameLine);

  return result;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function normalizeName(s: string) {
  // Remove obvious receipt words
  return s
    .replace(/receipt|invoice|total|amount|date|merchant|thank you/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
