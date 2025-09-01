// Lightweight web UI tokens for consistent minimalist styling
// Usage is conditional on Platform.OS === 'web'

export type BtnKind = 'primary' | 'success' | 'danger' | 'neutral';
export type BtnSize = 'sm' | 'md';

export function btn(kind: BtnKind = 'neutral', size: BtnSize = 'md'): any {
  const base: any = {
    padding: size === 'sm' ? '4px 8px' : '6px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    color: '#0f172a',
    cursor: 'pointer',
    lineHeight: 1.2,
    fontSize: size === 'sm' ? 12 : 14,
    whiteSpace: 'nowrap',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  };
  if (kind === 'primary') return { ...base, background: '#eef2ff', borderColor: '#c7d2fe' };
  if (kind === 'success') return { ...base, background: '#ecfccb', borderColor: '#bef264' };
  if (kind === 'danger') return { ...base, background: '#fee2e2', borderColor: '#fecaca' };
  return base; // neutral
}

export function input(): any {
  return {
    padding: 10,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    width: '100%',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    boxSizing: 'border-box',
    minHeight: 36,
  } as any;
}

export function chip(): any {
  return { padding: '2px 8px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f8fafc', cursor: 'pointer', fontSize: 12, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' } as any;
}

export function dropdown(): any {
  return {
    position: 'absolute',
    zIndex: 50,
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
    maxHeight: 220,
    overflowY: 'auto',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  } as any;
}

export function menuItem(): any {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #f1f5f9',
    cursor: 'pointer',
    fontSize: 14,
    fontFamily: 'inherit',
  } as any;
}
