import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, Text, TextInput, View, RefreshControl, Linking, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
// Switch Dashboard data source to Google Sheets registry
import { findOrCreateSpreadsheet, listAllReceipts, updateReimbursedCell, deleteRow, type ReceiptRow } from '../google/sheets';
import { deleteFile } from '../google/drive';
import { btn as webBtn, input as webInput, dropdown as webDropdown, menuItem as webMenuItem } from '../web/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

type ReceiptMeta = {
  provider?: string;
  patientName?: string;
  amount?: number;
  currency?: string;
  date?: string; // legacy; prefer startDate/endDate
  startDate?: string;
  endDate?: string;
  reimbursed?: boolean;
  expenseType?: string; // Medical, Dental, Pharmacy, Vision, Unknown
};

export default function DashboardScreen({ navigation }: Props) {
  const { accessToken, signIn } = useGoogleAuth();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; row: ReceiptRow; meta: ReceiptMeta }>>([]);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'reimbursed' | 'unreimbursed'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc'); // native default date sort
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<
    'provider' | 'patient' | 'amount' | 'currency' | 'type' | 'start' | 'end' | 'reimbursed' | null
  >(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ReceiptMeta>>({});
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showProvList, setShowProvList] = useState<string | null>(null);
  const [showPatList, setShowPatList] = useState<string | null>(null);
  // Web PDF preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const hasLoadedRef = React.useRef(false);
  useEffect(() => {
    if (!accessToken) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function reload() {
    setLoading(true);
    setAuthRequired(false);
    setErrorMsg(null);
    try {
      // throttle: ignore reloads within 10s
      const now = Date.now();
      if ((reload as any)._lastCall && now - (reload as any)._lastCall < 10000) {
        return;
      }
      (reload as any)._lastCall = now;

      let token = accessToken!;
      const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
        try {
          return await fn(token);
        } catch (e: any) {
          const msg = String(e?.message || e || '');
          if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
            const t2 = await signIn();
            if (!t2) {
              setAuthRequired(true);
              throw new Error('AUTH_REQUIRED');
            }
            token = t2;
            return await fn(token);
          }
          throw e;
        }
      };

      const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
      const all = await withAuthRetry((t) => listAllReceipts(t, spreadsheetId));
      // Build items from bottom (newest at end since we append); slice last 20
      const sliced = all.slice(-20).reverse();
      const results: Array<{ id: string; row: ReceiptRow; meta: ReceiptMeta }>= sliced.map((r) => ({ id: String(r.rowNumber), row: r, meta: {
        provider: r.provider,
        patientName: r.patientName,
        amount: r.amount,
        currency: r.currency,
        date: r.startDate,
        startDate: r.startDate,
        endDate: r.endDate,
        reimbursed: !!r.reimbursed,
      }}));
      setItems(results);
      setPageIndex(20);
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      if (msg !== 'AUTH_REQUIRED') setErrorMsg(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const s = startDate ? new Date(startDate) : null;
    const e = endDate ? new Date(endDate) : null;
    let arr = items.filter((it) => {
      const svc = it.meta.startDate || it.meta.date;
      if (!svc) return true;
      const d = new Date(svc);
      if (s && d < s) return false;
      if (e && d > e) return false;
      return true;
    });
    if (filterStatus !== 'all') arr = arr.filter((it) => !!it.meta.reimbursed === (filterStatus === 'reimbursed'));
    // Search filter (local)
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((it) => {
        const fields = [
          it.meta.provider,
          it.meta.patientName,
          it.meta.currency,
          it.meta.startDate || (it.meta as any).date,
          it.meta.endDate,
          it.meta.amount != null ? String(it.meta.amount) : undefined,
        ].filter(Boolean) as string[];
        return fields.some((f) => f.toLowerCase().includes(q));
      });
    }
    // Sorting
    if (sortCol) {
      const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);
      arr.sort((a, b) => {
        let va: any, vb: any;
        switch (sortCol) {
          case 'provider': va = a.meta.provider || ''; vb = b.meta.provider || ''; break;
          case 'patient': va = a.meta.patientName || ''; vb = b.meta.patientName || ''; break;
          case 'amount': va = a.meta.amount ?? 0; vb = b.meta.amount ?? 0; break;
          case 'currency': va = a.meta.currency || ''; vb = b.meta.currency || ''; break;
          case 'type': va = a.meta.expenseType || 'Unknown'; vb = b.meta.expenseType || 'Unknown'; break;
          case 'start': va = a.meta.startDate || a.meta.date || ''; vb = b.meta.startDate || b.meta.date || ''; break;
          case 'end': va = a.meta.endDate || ''; vb = b.meta.endDate || ''; break;
          case 'reimbursed': va = !!a.meta.reimbursed ? 1 : 0; vb = !!b.meta.reimbursed ? 1 : 0; break;
          default: va = 0; vb = 0;
        }
        const r = cmp(va, vb);
        return sortDir === 'asc' ? r : -r;
      });
    } else {
      // Default date sort for native/cards
      arr.sort((a, b) => {
        const da = a.meta.startDate || a.meta.date || '';
        const db = b.meta.startDate || b.meta.date || '';
        if (sortOrder === 'desc') return db < da ? -1 : 1;
        return da < db ? -1 : 1;
      });
    }
    return arr;
  }, [items, startDate, endDate, filterStatus, sortOrder, sortCol, sortDir, search]);

  // Web: start editing and keep action buttons in view
  const startWebEdit = (id: string, meta: ReceiptMeta) => {
    setEditing((e) => ({ ...e, [id]: true }));
    setDrafts((d) => ({ ...d, [id]: { ...meta } }));
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const el = document.getElementById(`row-${id}`);
        try { el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
        try { (document.getElementById(`edit-provider-${id}`) as any)?.focus?.(); } catch {}
      }, 0);
    }
  };

  // CSV export (web only)
  function exportCsvWeb() {
    if (typeof document === 'undefined') return;
    const header = ['rowNumber','provider','patientName','amount','amountCents','currency','startDate','endDate','reimbursed'];
    const rows = filtered.map((it) => {
      const amt = Number(it.meta.amount ?? 0);
      const cents = Math.round(amt * 100);
      return [
        String(it.row.rowNumber),
        it.meta.provider ?? '',
        it.meta.patientName ?? '',
        String(amt.toFixed(2)),
        String(cents),
        it.meta.currency ?? '',
        it.meta.startDate ?? (it.meta as any).date ?? '',
        it.meta.endDate ?? '',
        it.meta.reimbursed ? 'TRUE' : 'FALSE',
      ];
    });
    const esc = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipts_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const isWeb = typeof document !== 'undefined';

  const providerOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach(it => { if (it.meta.provider) s.add(it.meta.provider!); });
    return Array.from(s).sort();
  }, [items]);
  const patientOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach(it => { if (it.meta.patientName) s.add(it.meta.patientName!); });
    return Array.from(s).sort();
  }, [items]);

  async function openPdfPreview(fileId?: string | null) {
    if (!isWeb || !fileId) return;
    if (!accessToken) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      let token = accessToken;
      const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
        try { return await fn(token); } catch (e: any) {
          const msg = String(e?.message || e || '');
          if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
            const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
          }
          throw e;
        }
      };
      const blob = await withAuthRetry(async (t) => {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (!res.ok) throw new Error(`Preview fetch failed: ${res.status}`);
        return await res.blob();
      });
      if (previewUrl) try { URL.revokeObjectURL(previewUrl); } catch {}
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (e) {
      console.warn('Preview failed', e);
    } finally {
      setPreviewLoading(false);
    }
  }

  // (Reimburse feature removed)

  // Close preview with ESC on web
  React.useEffect(() => {
    if (!isWeb) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false);
    };
    if (previewOpen) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [previewOpen, isWeb]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} />}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        {isWeb ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={webBtn('primary')} onClick={() => reload()}>Refresh</button>
          </div>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Button title="Refresh" onPress={() => reload()} />
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text>Start Date</Text>
          {renderDateField(startDate, setStartDate)}
        </View>
        <View style={{ width: 12 }} />
        <View style={{ flex: 1 }}>
          <Text>End Date</Text>
          {renderDateField(endDate, setEndDate)}
        </View>
      </View>
      
      <View style={{ height: 12 }} />
      {loading ? <ActivityIndicator /> : null}
      {isWeb ? (
        <View style={{ marginBottom: 8 }}>
          {/* @ts-ignore */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              {/* @ts-ignore */}
              <input
                type="search"
                value={search}
                onChange={(e: any) => setSearch(e.target.value)}
                placeholder="Search provider, patient, date, currency, amount"
                style={webInput()}
              />
            </div>
            {/* @ts-ignore */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={webBtn('neutral')} onClick={() => setSearch('')}>Clear</button>
              <button style={webBtn('primary')} onClick={exportCsvWeb}>Export CSV</button>
            </div>
          </div>
        </View>
      ) : null}
      {/* Global Sign-in is handled in the app header; local prompt removed */}
      {errorMsg ? <Text style={{ color: '#b00', marginBottom: 12 }}>{errorMsg}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Text>Status Filter:</Text>
        {isWeb ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              style={webBtn(filterStatus === 'all' ? 'primary' : 'neutral', 'sm')}
              onClick={() => setFilterStatus('all')}
            >
              All{filterStatus === 'all' ? ' ✓' : ''}
            </button>
            <button
              style={webBtn(filterStatus === 'reimbursed' ? 'primary' : 'neutral', 'sm')}
              onClick={() => setFilterStatus('reimbursed')}
            >
              Reimbursed{filterStatus === 'reimbursed' ? ' ✓' : ''}
            </button>
            <button
              style={webBtn(filterStatus === 'unreimbursed' ? 'primary' : 'neutral', 'sm')}
              onClick={() => setFilterStatus('unreimbursed')}
            >
              Unreimbursed{filterStatus === 'unreimbursed' ? ' ✓' : ''}
            </button>
          </div>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={`All${filterStatus === 'all' ? ' ✓' : ''}`} onPress={() => setFilterStatus('all')} />
            <Button title={`Reimbursed${filterStatus === 'reimbursed' ? ' ✓' : ''}`} onPress={() => setFilterStatus('reimbursed')} />
            <Button title={`Unreimbursed${filterStatus === 'unreimbursed' ? ' ✓' : ''}`} onPress={() => setFilterStatus('unreimbursed')} />
          </View>
        )}
      </View>
      {isWeb ? (
        <div>
        {/* Web table view with inline actions (datatable) — styled */}
        <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', background: 'white', paddingRight: 320 }}>
        {/* @ts-ignore */}
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, tableLayout: 'fixed', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}>
          <thead>
            <tr>
              {renderSortTh('Provider', 'provider', sortCol, sortDir, setSortCol, setSortDir, '18%')}
              {renderSortTh('Patient', 'patient', sortCol, sortDir, setSortCol, setSortDir, '14%')}
              {renderSortTh('Amount', 'amount', sortCol, sortDir, setSortCol, setSortDir, '8%')}
              {renderSortTh('Currency', 'currency', sortCol, sortDir, setSortCol, setSortDir, '7%')}
              {renderSortTh('Type', 'type', sortCol, sortDir, setSortCol, setSortDir, '9%')}
              {renderSortTh('Start', 'start', sortCol, sortDir, setSortCol, setSortDir, '10%')}
              {renderSortTh('End', 'end', sortCol, sortDir, setSortCol, setSortDir, '10%')}
              {renderSortTh('Reimbursed', 'reimbursed', sortCol, sortDir, setSortCol, setSortDir, '8%')}
              <th style={{ position: 'sticky', right: 0, top: 0, zIndex: 5, background: 'var(--bg, white)', textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 6, width: '12%' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it, idx) => (
              <tr key={it.id} id={`row-${it.id}`} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                {!editing[it.id] ? (
                  <>
                    <td style={{ padding: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.row.pdfFileId ? (
                        <a href="#" onClick={(e: any) => { e.preventDefault(); openPdfPreview(it.row.pdfFileId); }}>
                          {it.meta.provider || ''}
                        </a>
                      ) : (
                        it.meta.provider || ''
                      )}
                    </td>
                    <td style={{ padding: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normalizeName(it.meta.patientName || '')}</td>
                    <td style={{ padding: 6, minWidth: 0, whiteSpace: 'nowrap' }}>{formatAmount(it.meta.amount)} </td>
                    <td style={{ padding: 6, minWidth: 0, whiteSpace: 'nowrap' }}>{it.meta.currency || ''}</td>
                    <td style={{ padding: 6, minWidth: 0, whiteSpace: 'nowrap' }}>{it.meta.expenseType || 'Unknown'}</td>
                    <td style={{ padding: 6, minWidth: 0, whiteSpace: 'nowrap' }}>{it.meta.startDate || (it.meta as any).date || ''}</td>
                    <td style={{ padding: 6, minWidth: 0, whiteSpace: 'nowrap' }}>{it.meta.endDate || ''}</td>
                    <td style={{ padding: 6, minWidth: 0, whiteSpace: 'nowrap' }}>{it.meta.reimbursed ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 6, position: 'sticky', right: 0, background: 'var(--bg, white)', minWidth: 200, borderLeft: '1px solid #e5e7eb', zIndex: 4 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <button style={webBtn('primary','sm')} title="Edit" onClick={() => startWebEdit(it.id, it.meta)}>✏️</button>
                        <button style={webBtn(it.meta.reimbursed ? 'neutral' : 'success','sm')} title={it.meta.reimbursed ? 'Unmark reimbursed' : 'Mark reimbursed'} disabled={!!updating[it.id]} onClick={async () => {
                          if (!accessToken) return;
                          setUpdating((u) => ({ ...u, [it.id]: true }));
                          try {
                            const newMeta = { ...it.meta, reimbursed: !it.meta.reimbursed } as ReceiptMeta & Record<string, any>;
                            let token = accessToken;
                            const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                              try { return await fn(token); } catch (e: any) {
                                const msg = String(e?.message || e || '');
                                if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                                  const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                                }
                                throw e;
                              }
                            };
                            const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                            await withAuthRetry((t) => updateReimbursedCell(t, spreadsheetId, it.row.rowNumber, !it.meta.reimbursed));
                            setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, meta: newMeta } : x)));
                          } catch (e: any) {
                            alert(e?.message || 'Update failed');
                          } finally {
                            setUpdating((u) => ({ ...u, [it.id]: false }));
                          }
                        }}>{it.meta.reimbursed ? '☐' : '☑'}</button>
                        <button style={webBtn('danger','sm')} title="Delete" disabled={!!updating[it.id]} onClick={async () => {
                          if (!accessToken) return;
                          if (!confirm('Delete this row from the ledger?')) return;
                          const alsoFiles = confirm('Also delete the associated files from Drive?');
                          setUpdating((u) => ({ ...u, [it.id]: true }));
                          try {
                            let token = accessToken;
                            const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                              try { return await fn(token); } catch (e: any) {
                                const msg = String(e?.message || e || '');
                                if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                                  const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                                }
                                throw e;
                              }
                            };
                            const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                            if (alsoFiles) {
                              if (it.row.pdfFileId) await withAuthRetry((t) => deleteFile(it.row.pdfFileId!, t));
                              if (it.row.originalFileId) await withAuthRetry((t) => deleteFile(it.row.originalFileId!, t));
                            }
                            await withAuthRetry((t) => deleteRow(t, spreadsheetId, 'Receipts', it.row.rowNumber));
                            // After delete, reload to get fresh row numbers
                            await reload();
                          } catch (e: any) {
                            alert(e?.message || 'Delete failed');
                          } finally {
                            setUpdating((u) => ({ ...u, [it.id]: false }));
                          }
                        }}>🗑️</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: 6 }}>
                      <div style={{ position: 'relative' }}>
                        <input
                          id={`edit-provider-${it.id}`}
                          style={webInput()}
                          value={drafts[it.id]?.provider || ''}
                          onFocus={() => setShowProvList(it.id)}
                          onBlur={() => setTimeout(() => setShowProvList(cur => (cur === it.id ? null : cur)), 120)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], provider: e.target.value } }))}
                        />
                        {showProvList === it.id ? (
                          // @ts-ignore
                          <div style={{ ...webDropdown(), zIndex: 5 }}>
                            {providerOptions
                              .filter(p => p.toLowerCase().includes(String(drafts[it.id]?.provider || '').toLowerCase()))
                              .slice(0, 8)
                              .map(p => (
                                // @ts-ignore
                                <button key={p} style={webMenuItem()} onMouseDown={(e: any) => e.preventDefault()} onClick={() => { setDrafts(d => ({ ...d, [it.id]: { ...d[it.id], provider: p } })); setShowProvList(null); }}>{p}</button>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: 6 }}>
                      <div style={{ position: 'relative' }}>
                        <input
                          id={`edit-patient-${it.id}`}
                          style={webInput()}
                          value={drafts[it.id]?.patientName || ''}
                          onFocus={() => setShowPatList(it.id)}
                          onBlur={() => setTimeout(() => setShowPatList(cur => (cur === it.id ? null : cur)), 120)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], patientName: normalizeName(e.target.value) } }))}
                        />
                        {showPatList === it.id ? (
                          // @ts-ignore
                          <div style={{ ...webDropdown(), zIndex: 5 }}>
                            {patientOptions
                              .filter(p => p.toLowerCase().includes(String(drafts[it.id]?.patientName || '').toLowerCase()))
                              .slice(0, 8)
                              .map(p => (
                                // @ts-ignore
                                <button key={p} style={webMenuItem()} onMouseDown={(e: any) => e.preventDefault()} onClick={() => { setDrafts(d => ({ ...d, [it.id]: { ...d[it.id], patientName: normalizeName(p) } })); setShowPatList(null); }}>{p}</button>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        style={webInput()}
                        inputMode="decimal"
                        type="text"
                        value={draftDollarValue(drafts[it.id]?.amount)}
                        onChange={(e) => {
                          const raw = (e.target.value || '').trim();
                          const sanitized = raw.replace(/[^0-9.]/g, '');
                          setDrafts((d) => ({
                            ...d,
                            [it.id]: {
                              ...d[it.id],
                              amount: raw === '' ? undefined : Number(sanitized || '0'),
                            },
                          }));
                        }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input style={webInput()} value={drafts[it.id]?.currency || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], currency: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 6 }}>
                      {/* @ts-ignore */}
                      <select style={webInput()} value={drafts[it.id]?.expenseType || it.meta.expenseType || 'Unknown'} onChange={(e: any) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], expenseType: e.target.value } }))}>
                        <option>Medical</option>
                        <option>Dental</option>
                        <option>Pharmacy</option>
                        <option>Vision</option>
                        <option>Unknown</option>
                      </select>
                    </td>
                    <td style={{ padding: 6 }}>
                      <input style={webInput()} type="date" value={drafts[it.id]?.startDate || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], startDate: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input style={webInput()} type="date" value={drafts[it.id]?.endDate || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], endDate: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 6 }}>{it.meta.reimbursed ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 6, position: 'sticky', right: 0, background: 'var(--bg, white)', minWidth: 200, borderLeft: '1px solid #e5e7eb', zIndex: 4 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <button style={webBtn('primary','sm')} title="Save" disabled={!!updating[it.id]} onClick={async () => {
                          if (!accessToken) return;
                          setUpdating((u) => ({ ...u, [it.id]: true }));
                          try {
                            const draft = drafts[it.id] || {};
                            const start = (draft.startDate && draft.startDate.trim()) ? draft.startDate : (it.meta as any).startDate;
                            const end = (draft.endDate && draft.endDate.trim()) ? draft.endDate : (it.meta as any).endDate;
                            const providerVal = (typeof draft.provider === 'string' && draft.provider.trim() !== '') ? draft.provider : (it.meta.provider || '');
                            const patientVal = (typeof draft.patientName === 'string' && draft.patientName.trim() !== '') ? normalizeName(draft.patientName) : (it.meta.patientName || '');
                            const amountProvided = (typeof draft.amount === 'number' && !Number.isNaN(draft.amount));
                            const amountVal = amountProvided ? draft.amount : (it.meta as any).amount;
                            const currencyVal = (typeof draft.currency === 'string' && draft.currency.trim() !== '') ? draft.currency : (it.meta.currency || '');
                            const typeVal = (typeof draft.expenseType === 'string' && draft.expenseType.trim() !== '') ? draft.expenseType : (it.meta.expenseType || 'Unknown');
                            const newMeta: ReceiptMeta & Record<string, any> = {
                              ...it.meta,
                              provider: providerVal,
                              patientName: patientVal,
                              expenseType: typeVal,
                              startDate: start,
                              endDate: end,
                              amount: amountVal,
                              currency: currencyVal,
                            } as any;
                            let token = accessToken;
                            const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                              try { return await fn(token); } catch (e: any) {
                                const msg = String(e?.message || e || '');
                                if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                                  const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                                }
                                throw e;
                              }
                            };
                            const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                    const rowValues = [
                      newMeta.provider ?? '',
                      newMeta.patientName ?? '',
                      newMeta.amount ?? '',
                      newMeta.currency ?? '',
                      newMeta.expenseType ?? 'Unknown',
                      (newMeta as any).startDate ?? '',
                      (newMeta as any).endDate ?? '',
                    ];
                    const range = `Receipts!B${it.row.rowNumber}:H${it.row.rowNumber}`;
                            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
                              method: 'PUT',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ values: [rowValues] }),
                            });
                            setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, meta: newMeta } : x)));
                            setEditing((e) => ({ ...e, [it.id]: false }));
                          } catch (e: any) {
                            alert(e?.message || 'Save failed');
                          } finally {
                            setUpdating((u) => ({ ...u, [it.id]: false }));
                          }
                        }}>💾</button>
                        <button style={webBtn('neutral','sm')} title="Cancel" onClick={() => setEditing((e) => ({ ...e, [it.id]: false }))}>✖</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {previewOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 9999 }} onClick={() => setPreviewOpen(false)}>
            <div style={{ width: '90%', height: '85%', background: 'white', borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', position: 'relative', zIndex: 10000 }} onClick={(e: any) => e.stopPropagation()}>
              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 8 }}>
                <button style={webBtn('neutral','sm')} onClick={() => { if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch {} } setPreviewUrl(null); setPreviewOpen(false); }}>Close</button>
              </div>
              {previewLoading ? (
                <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                  <span>Loading preview…</span>
                </div>
              ) : previewUrl ? (
                <iframe title="Receipt Preview" src={previewUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                  <span>Unable to load preview</span>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      ) : (
        // Native fallback: existing card list
        <View>
          {filtered.map((it) => (
            <View key={it.id} style={{ borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8 }}>
              {!editing[it.id] ? (
                <>
                      <Text style={{ fontWeight: '600' }}>{it.meta.provider || '(Provider)'}</Text>
                  <Text style={{ color: '#666' }}>
                    Service: {it.meta.startDate || it.meta.date || '-'}
                    {it.meta.endDate ? ` → ${it.meta.endDate}` : ''}
                  </Text>
                  <View style={{ height: 6 }} />
              <Text>Who: {normalizeName(it.meta.patientName || '-')}</Text>
                  <Text>Amount: {formatAmount(it.meta.amount)} {it.meta.currency || ''}</Text>
                  <View style={{ height: 8 }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text>Reimbursed: {it.meta.reimbursed ? 'Yes' : 'No'}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button title="✏️" onPress={() => { setEditing((e) => ({ ...e, [it.id]: true })); setDrafts((d) => ({ ...d, [it.id]: { ...it.meta } })); }} />
                      <Button
                        title={it.meta.reimbursed ? '☐' : '☑'}
                        disabled={!!updating[it.id]}
                        onPress={async () => {
                          if (!accessToken) return;
                          setUpdating((u) => ({ ...u, [it.id]: true }));
                          try {
                            const newMeta = { ...it.meta, reimbursed: !it.meta.reimbursed } as ReceiptMeta & Record<string, any>;
                            let token = accessToken;
                            const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                              try { return await fn(token); } catch (e: any) {
                                const msg = String(e?.message || e || '');
                                if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                                  const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                                }
                                throw e;
                              }
                            };
                            const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                            await withAuthRetry((t) => updateReimbursedCell(t, spreadsheetId, it.row.rowNumber, !it.meta.reimbursed));
                            setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, meta: newMeta } : x)));
                          } catch (e: any) {
                            console.error('Update reimbursed failed', e);
                            alert(e?.message || 'Update failed');
                          } finally {
                            setUpdating((u) => ({ ...u, [it.id]: false }));
                          }
                        }}
                      />
                      <Button
                        title="🗑️"
                        color="#b91c1c"
                        onPress={async () => {
                          if (!accessToken) return;
                          if (!confirm('Delete this row from the ledger?')) return;
                          const alsoFiles = confirm('Also delete associated files from Drive?');
                          setUpdating((u) => ({ ...u, [it.id]: true }));
                          try {
                            let token = accessToken;
                            const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                              try { return await fn(token); } catch (e: any) {
                                const msg = String(e?.message || e || '');
                                if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                                  const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                                }
                                throw e;
                              }
                            };
                            const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                            if (alsoFiles) {
                              if (it.row.pdfFileId) await withAuthRetry((t) => deleteFile(it.row.pdfFileId!, t));
                              if (it.row.originalFileId) await withAuthRetry((t) => deleteFile(it.row.originalFileId!, t));
                            }
                            await withAuthRetry((t) => deleteRow(t, spreadsheetId, 'Receipts', it.row.rowNumber));
                            await reload();
                          } finally {
                            setUpdating((u) => ({ ...u, [it.id]: false }));
                          }
                        }}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <Text>Provider</Text>
                  <TextInput value={drafts[it.id]?.provider || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], provider: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
                  <View style={{ height: 6 }} />
                  <Text>Patient Name</Text>
                  <TextInput value={drafts[it.id]?.patientName || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], patientName: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
                  <View style={{ height: 6 }} />
                  <Text>Start Date</Text>
                  <TextInput value={drafts[it.id]?.startDate || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], startDate: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
                  <View style={{ height: 6 }} />
                  <Text>End Date</Text>
                  <TextInput value={drafts[it.id]?.endDate || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], endDate: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
                  <View style={{ height: 6 }} />
                  <Text>Amount (e.g., 12.34)</Text>
                  <TextInput
                    value={draftDollarValue(drafts[it.id]?.amount)}
                    onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], amount: Number(v.replace(/[^0-9.]/g, '')) || 0 } }))}
                    keyboardType="decimal-pad"
                    style={{ borderWidth: 1, padding: 8, borderRadius: 6 }}
                  />
                  <View style={{ height: 6 }} />
                  <Text>Currency</Text>
                  <TextInput value={drafts[it.id]?.currency || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], currency: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
                  <View style={{ height: 8 }} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title={updating[it.id] ? 'Saving…' : 'Save'} disabled={!!updating[it.id]} onPress={async () => {
                      if (!accessToken) return;
                      setUpdating((u) => ({ ...u, [it.id]: true }));
                      try {
                        const draft = drafts[it.id] || {};
                        const start2 = (draft.startDate && draft.startDate.trim()) ? draft.startDate : (it.meta as any).startDate;
                        const end2 = (draft.endDate && draft.endDate.trim()) ? draft.endDate : (it.meta as any).endDate;
                        const providerVal2 = (typeof draft.provider === 'string' && draft.provider.trim() !== '') ? draft.provider : (it.meta.provider || '');
                        const patientVal2 = (typeof draft.patientName === 'string' && draft.patientName.trim() !== '') ? draft.patientName : (it.meta.patientName || '');
                        const amountProvided2 = (typeof draft.amount === 'number' && !Number.isNaN(draft.amount));
                        const amountVal2 = amountProvided2 ? draft.amount : (it.meta as any).amount;
                        const currencyVal2 = (typeof draft.currency === 'string' && draft.currency.trim() !== '') ? draft.currency : (it.meta.currency || '');
                        const newMeta: ReceiptMeta & Record<string, any> = {
                          ...it.meta,
                          provider: providerVal2,
                          patientName: patientVal2,
                          startDate: start2,
                          endDate: end2,
                          amount: amountVal2,
                          currency: currencyVal2,
                        } as any;
                        let token = accessToken;
                        const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                          try { return await fn(token); } catch (e: any) {
                            const msg = String(e?.message || e || '');
                            if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                              const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                            }
                            throw e;
                          }
                        };
                        const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                    const rowValues = [
                      newMeta.provider ?? '',
                      newMeta.patientName ?? '',
                      newMeta.amount ?? '',
                      newMeta.currency ?? '',
                      newMeta.expenseType ?? 'Unknown',
                      (newMeta as any).startDate ?? '',
                      (newMeta as any).endDate ?? '',
                    ];
                    const range = `Receipts!B${it.row.rowNumber}:H${it.row.rowNumber}`;
                        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
                          method: 'PUT',
                          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ values: [rowValues] }),
                        });
                        setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, meta: newMeta } : x)));
                        setEditing((e) => ({ ...e, [it.id]: false }));
                      } catch (e: any) {
                        console.error('Save edits failed', e);
                        alert(e?.message || 'Save failed');
                      } finally {
                        setUpdating((u) => ({ ...u, [it.id]: false }));
                      }
                    }} />
                    <Button title="Cancel" onPress={() => setEditing((e) => ({ ...e, [it.id]: false }))} />
                  </View>
                </>
              )}
            </View>
          ))}
        </View>
      )}
      {items.length >= pageIndex ? (
        <View style={{ marginTop: 8 }}>
          <Button title={loadingMore ? 'Loading…' : 'Show more'} disabled={loadingMore} onPress={async () => {
            if (!accessToken) return;
            setLoadingMore(true);
            try {
              let token = accessToken;
              const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                try { return await fn(token); } catch (e: any) {
                  const msg = String(e?.message || e || '');
                  if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                    const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                  }
                  throw e;
                }
              };
              const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
              const all = await withAuthRetry((t) => listAllReceipts(t, spreadsheetId));
              const start = all.length - (pageIndex + 20);
              const end = all.length - pageIndex;
              const slice = all.slice(Math.max(0, start), Math.max(0, end)).reverse();
              const newItems = slice.map((r) => ({ id: String(r.rowNumber), row: r, meta: {
                provider: r.provider,
                patientName: r.patientName,
                amount: r.amount,
                currency: r.currency,
                date: r.startDate,
                startDate: r.startDate,
                endDate: r.endDate,
                reimbursed: !!r.reimbursed,
              }}));
              setItems((prev) => [...prev, ...newItems]);
              setPageIndex(pageIndex + 20);
            } finally {
              setLoadingMore(false);
            }
          }} />
        </View>
      ) : null}
      <View style={{ height: 16 }} />
      {navigation && (navigation as any).navigate ? (
        <Button title="Scan Receipts" onPress={() => navigation.navigate('Scan')} />
      ) : null}
    </ScrollView>
  );
}

function formatAmount(amount?: number) {
  if (amount == null) return '-';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}$${abs.toFixed(2)}`;
}

function renderDateField(value: string, onChange: (v: string) => void) {
  if (typeof document !== 'undefined') {
    // web
    // @ts-ignore
    return (
      <input
        type="date"
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        style={{ border: '1px solid #ccc', padding: 8, borderRadius: 6, width: '100%' }}
      />
    );
  }
  // native
  return (
    <View>
      <Button title={value || 'Pick date'} onPress={() => (renderDateField as any)._show?.()} />
      {(() => {
        const React = require('react');
        const [show, setShow] = React.useState(false);
        (renderDateField as any)._show = () => setShow(true);
        const Picker = require('@react-native-community/datetimepicker').default;
        const d = value ? new Date(value) : new Date();
        return show ? (
          <Picker
            value={d}
            mode="date"
            display="default"
            onChange={(_: any, dd: Date | undefined) => {
              if (dd) {
                const y = dd.getFullYear();
                const m = String(dd.getMonth() + 1).padStart(2, '0');
                const da = String(dd.getDate()).padStart(2, '0');
                onChange(`${y}-${m}-${da}`);
              }
              setShow(false);
            }}
          />
        ) : null;
      })()}
    </View>
  );
}

function draftDollarValue(amount?: number) {
  if (typeof amount !== 'number') return '';
  return String(amount.toFixed(2));
}

// Component-scoped helpers (closure over accessToken/signIn via props isn't available here),
// so we attach them to the component via inline definitions above where they are used.

// Web helpers
function renderSortTh(
  label: string,
  key:
    | 'provider'
    | 'patient'
    | 'amount'
    | 'currency'
    | 'start'
    | 'end'
    | 'reimbursed',
  sortCol: any,
  sortDir: 'asc' | 'desc',
  setSortCol: (k: any) => void,
  setSortDir: (d: 'asc' | 'desc') => void,
  width?: string
) {
  const active = sortCol === key;
  const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const onClick = () => {
    if (!active) { setSortCol(key); setSortDir('asc'); }
    else { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }
  };
  // @ts-ignore
  return (
    <th
      onClick={onClick}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 10, background: 'var(--bg, white)', position: 'sticky', top: 0, zIndex: 1, width: width || undefined }}
    >
      {label}{arrow}
    </th>
  );
}

// Helper: normalize names for consistent casing in the UI and saves
function normalizeName(input: string): string {
  const s = String(input || '').toLowerCase();
  return s.replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).trim();
}
