import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, Text, TextInput, View, RefreshControl } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
// Switch Dashboard data source to Google Sheets registry
import { findOrCreateSpreadsheet, listAllReceipts, updateReimbursedCell, deleteRow, type ReceiptRow } from '../google/sheets';
import { deleteFile } from '../google/drive';

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
    'provider' | 'patient' | 'amount' | 'currency' | 'start' | 'end' | 'reimbursed' | null
  >(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ReceiptMeta>>({});
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);

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

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} />}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        {isWeb ? (
          // @ts-ignore
          <>
            <button style={btn('primary')} onClick={() => reload()}>Refresh</button>
            <button style={btn('neutral')} onClick={() => setSortOrder((p) => (p === 'desc' ? 'asc' : 'desc'))}>{`Sort: ${sortOrder === 'desc' ? 'Newest' : 'Oldest'}`}</button>
          </>
        ) : (
          <>
            <Button title="Refresh" onPress={() => reload()} />
            <View style={{ width: 8 }} />
            {/* Native sort toggle retained */}
            <Button title={`Sort: ${sortOrder === 'desc' ? 'Newest' : 'Oldest'}`} onPress={() => setSortOrder((p) => (p === 'desc' ? 'asc' : 'desc'))} />
          </>
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
        <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1 }}>
            <Text>Search</Text>
            {/* @ts-ignore */}
            <input
              type="search"
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
              placeholder="Search provider, patient, date, currency, amount"
              style={{ width: '100%', padding: 10, border: '1px solid #e5e7eb', borderRadius: 8 }}
            />
          </View>
          {/* @ts-ignore */}
          <button style={btn('neutral')} onClick={() => setSearch('')}>Clear</button>
          {/* @ts-ignore */}
          <button style={btn('primary')} onClick={exportCsvWeb}>Export CSV</button>
        </View>
      ) : null}
      {authRequired ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: '#b00', marginBottom: 8 }}>
            {stopAutoReload ? 'Too many authorization failures. Please sign in to resume.' : 'Session expired. Please sign in to refresh.'}
          </Text>
          <Button title="Sign in with Google" onPress={async () => {
            const t = await signIn();
            if (t) {
              // reset auth failure state and reload
              setAuthRequired(false);
              setLoading(true);
              setAuthFailCount(0);
              setStopAutoReload(false);
              const s = startDate; const e = endDate;
              setStartDate(s);
              setEndDate(e);
              reload();
            }
          }} />
          {stopAutoReload ? (
            <View style={{ marginTop: 8 }}>
              <Button title="Try again" onPress={() => { setAuthFailCount(0); setStopAutoReload(false); reload(); }} />
            </View>
          ) : null}
        </View>
      ) : null}
      {errorMsg ? <Text style={{ color: '#b00', marginBottom: 12 }}>{errorMsg}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text>Status Filter:</Text>
        <Button title={`All${filterStatus === 'all' ? ' ✓' : ''}`} onPress={() => setFilterStatus('all')} />
        <Button title={`Reimbursed${filterStatus === 'reimbursed' ? ' ✓' : ''}`} onPress={() => setFilterStatus('reimbursed')} />
        <Button title={`Unreimbursed${filterStatus === 'unreimbursed' ? ' ✓' : ''}`} onPress={() => setFilterStatus('unreimbursed')} />
      </View>
      {isWeb ? (
        // Web table view with inline actions (datatable) — styled
        // @ts-ignore
        <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', background: 'white', paddingRight: 160 }}>
        {/* @ts-ignore */}
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 14, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {renderSortTh('Provider', 'provider', sortCol, sortDir, setSortCol, setSortDir, '20%')}
              {renderSortTh('Patient', 'patient', sortCol, sortDir, setSortCol, setSortDir, '15%')}
              {renderSortTh('Amount', 'amount', sortCol, sortDir, setSortCol, setSortDir, '10%')}
              {renderSortTh('Currency', 'currency', sortCol, sortDir, setSortCol, setSortDir, '8%')}
              {renderSortTh('Start', 'start', sortCol, sortDir, setSortCol, setSortDir, '12%')}
              {renderSortTh('End', 'end', sortCol, sortDir, setSortCol, setSortDir, '12%')}
              {renderSortTh('Reimbursed', 'reimbursed', sortCol, sortDir, setSortCol, setSortDir, '10%')}
              <th style={{ position: 'sticky', right: 0, top: 0, zIndex: 2, background: 'var(--bg, white)', textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 10, width: '13%' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it, idx) => (
              <tr key={it.id} id={`row-${it.id}`} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                {!editing[it.id] ? (
                  <>
                    <td style={{ padding: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.meta.provider || ''}</td>
                    <td style={{ padding: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.meta.patientName || ''}</td>
                    <td style={{ padding: 10, minWidth: 0 }}>{formatAmount(it.meta.amount)} </td>
                    <td style={{ padding: 10, minWidth: 0 }}>{it.meta.currency || ''}</td>
                    <td style={{ padding: 10, minWidth: 0 }}>{it.meta.startDate || (it.meta as any).date || ''}</td>
                    <td style={{ padding: 10, minWidth: 0 }}>{it.meta.endDate || ''}</td>
                    <td style={{ padding: 10, minWidth: 0 }}>{it.meta.reimbursed ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 10, position: 'sticky', right: 0, background: 'var(--bg, white)', minWidth: 190, borderLeft: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button style={btn('primary')} onClick={() => startWebEdit(it.id, it.meta)}>Edit</button>
                        <button style={btn(it.meta.reimbursed ? 'neutral' : 'success')} disabled={!!updating[it.id]} onClick={async () => {
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
                        }}>{it.meta.reimbursed ? 'Unmark' : 'Mark'}</button>
                        <button style={btn('danger')} disabled={!!updating[it.id]} onClick={async () => {
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
                        }}>Delete</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: 10 }}>
                      <input style={input()} value={drafts[it.id]?.provider || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], provider: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 10 }}>
                      <input style={input()} value={drafts[it.id]?.patientName || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], patientName: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 10 }}>
                      <input style={input()} type="number" step="0.01" value={draftDollarValue(drafts[it.id]?.amount)} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], amount: Number(e.target.value || '0') } }))} />
                    </td>
                    <td style={{ padding: 10 }}>
                      <input style={input()} value={drafts[it.id]?.currency || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], currency: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 10 }}>
                      <input style={input()} type="date" value={drafts[it.id]?.startDate || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], startDate: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 10 }}>
                      <input style={input()} type="date" value={drafts[it.id]?.endDate || ''} onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], endDate: e.target.value } }))} />
                    </td>
                    <td style={{ padding: 10 }}>{it.meta.reimbursed ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 10, position: 'sticky', right: 0, background: 'var(--bg, white)', minWidth: 190, borderLeft: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button style={btn('primary')} disabled={!!updating[it.id]} onClick={async () => {
                          if (!accessToken) return;
                          setUpdating((u) => ({ ...u, [it.id]: true }));
                          try {
                            const draft = drafts[it.id] || {};
                            const newMeta: ReceiptMeta & Record<string, any> = {
                              ...it.meta,
                              provider: draft.provider ?? it.meta.provider,
                              patientName: draft.patientName ?? it.meta.patientName,
                              startDate: draft.startDate ?? (it.meta as any).startDate,
                              endDate: draft.endDate ?? (it.meta as any).endDate,
                              amount: draft.amount ?? (it.meta as any).amount,
                              currency: draft.currency ?? it.meta.currency,
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
                              (newMeta as any).startDate ?? '',
                              (newMeta as any).endDate ?? '',
                            ];
                            const range = `Receipts!B${it.row.rowNumber}:G${it.row.rowNumber}`;
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
                        }}>Save</button>
                        <button style={btn('neutral')} onClick={() => setEditing((e) => ({ ...e, [it.id]: false }))}>Cancel</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        // Native fallback: existing card list
        <>
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
                  <Text>Who: {it.meta.patientName || '-'}</Text>
                  <Text>Amount: {formatAmount(it.meta.amount)} {it.meta.currency || ''}</Text>
                  <View style={{ height: 8 }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text>Reimbursed: {it.meta.reimbursed ? 'Yes' : 'No'}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button title="Edit" onPress={() => { setEditing((e) => ({ ...e, [it.id]: true })); setDrafts((d) => ({ ...d, [it.id]: { ...it.meta } })); }} />
                      <Button
                        title={updating[it.id] ? 'Saving…' : it.meta.reimbursed ? 'Mark Unreimbursed' : 'Mark Reimbursed'}
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
                        title="Delete"
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
                        const newMeta: ReceiptMeta & Record<string, any> = {
                          ...it.meta,
                          provider: draft.provider ?? it.meta.provider,
                          patientName: draft.patientName ?? it.meta.patientName,
                          startDate: draft.startDate ?? (it.meta as any).startDate,
                          endDate: draft.endDate ?? (it.meta as any).endDate,
                          amount: draft.amount ?? (it.meta as any).amount,
                          currency: draft.currency ?? it.meta.currency,
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
                          (newMeta as any).startDate ?? '',
                          (newMeta as any).endDate ?? '',
                        ];
                        const range = `Receipts!B${it.row.rowNumber}:G${it.row.rowNumber}`;
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
        </>
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

// Simple design tokens for web controls
function btn(kind: 'primary' | 'success' | 'danger' | 'neutral') {
  const base: any = {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    color: '#0f172a',
    cursor: 'pointer'
  };
  if (kind === 'primary') return { ...base, background: '#eef2ff', borderColor: '#c7d2fe' };
  if (kind === 'success') return { ...base, background: '#ecfccb', borderColor: '#bef264' };
  if (kind === 'danger') return { ...base, background: '#fee2e2', borderColor: '#fecaca' };
  return base; // neutral
}

function input() {
  return { padding: 8, border: '1px solid #e5e7eb', borderRadius: 8, width: '100%' } as any;
}
