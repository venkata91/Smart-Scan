export function validateReceipt(obj) {
    const errors = [];
    if (!obj || typeof obj !== 'object')
        errors.push('not an object');
    if (!obj.id || typeof obj.id !== 'string')
        errors.push('id: required string');
    if (!obj.date || !/^\d{4}-\d{2}-\d{2}$/.test(obj.date))
        errors.push('date: YYYY-MM-DD');
    if (!obj.merchant || typeof obj.merchant !== 'string')
        errors.push('merchant: required string');
    if (typeof obj.amount !== 'number' || !Number.isFinite(obj.amount))
        errors.push('amount: required number');
    if (!obj.currency || typeof obj.currency !== 'string')
        errors.push('currency: required string');
    if (obj.reimbursed != null && typeof obj.reimbursed !== 'boolean')
        errors.push('reimbursed: boolean');
    return { ok: errors.length === 0, errors: errors };
}
