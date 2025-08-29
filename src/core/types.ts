export type ValidationResult = { ok: true; errors: [] } | { ok: false; errors: string[] };

export interface Receipt {
  id: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  amount: number; // minor units (cents)
  currency: string; // ISO 4217, e.g., USD
  category?: string;
  notes?: string;
  reimbursed?: boolean;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

