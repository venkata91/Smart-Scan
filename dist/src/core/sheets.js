import { buildDrivePath, buildFileName } from './naming.js';
/** Map a receipt to a normalized row for Sheets/CSV. */
export function toSheetRow(r) {
    return [
        r.id,
        r.date,
        r.merchant,
        (r.amount / 100).toFixed(2),
        r.currency,
        r.category ?? '',
        r.reimbursed ? 'TRUE' : 'FALSE',
        buildFileName(r),
        buildDrivePath(r),
    ];
}
/** Compute the sum of unreimbursed amounts in minor units */
export function computeUnreimbursedTotal(receipts) {
    return receipts.reduce((sum, r) => sum + (r.reimbursed ? 0 : r.amount), 0);
}
/** Format cents to currency string like 12345 -> 123.45 */
export function formatCents(amount) {
    const sign = amount < 0 ? '-' : '';
    const abs = Math.abs(amount);
    const major = Math.floor(abs / 100);
    const minor = (abs % 100).toString().padStart(2, '0');
    return `${sign}${major}.${minor}`;
}
